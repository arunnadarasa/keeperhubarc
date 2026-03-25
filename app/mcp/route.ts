import "server-only";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { type ApiKeyAuthResult, authenticateApiKey } from "@/lib/api-key-auth";
import { logMcpEvent } from "@/lib/mcp/logging";
import { authenticateOAuthToken } from "@/lib/mcp/oauth-auth";
import { checkMcpRateLimit } from "@/lib/mcp/rate-limit";
import { createMcpServer } from "@/lib/mcp/server";
import {
  deleteSession,
  getSession,
  setSession,
  startCleanupInterval,
  touchSession,
} from "@/lib/mcp/sessions";

export const dynamic = "force-dynamic";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
} as const;

// Start the session cleanup interval once per process lifetime
startCleanupInterval();

function getBaseUrl(request: Request): string {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

async function authenticate(request: Request): Promise<ApiKeyAuthResult> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : "";

  if (token.startsWith("kh_")) {
    return await authenticateApiKey(request);
  }

  const oauthResult = authenticateOAuthToken(request);
  if (oauthResult.authenticated) {
    return {
      authenticated: true,
      organizationId: oauthResult.organizationId,
      userId: oauthResult.userId,
      apiKeyId: `oauth:${oauthResult.userId ?? "unknown"}`,
    };
  }

  // Fall back to API key auth to get a consistent error format for non-OAuth tokens
  return await authenticateApiKey(request);
}

function isInitializeRequestBody(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some((item) => isInitializeRequest(item));
  }
  return isInitializeRequest(body);
}

function rateLimitResponse(retryAfter: number): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32_029, message: "Rate limit exceeded" },
      id: null,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
        ...CORS_HEADERS,
      },
    }
  );
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function handleExistingSession(
  request: Request,
  sessionId: string,
  organizationId: string
): Response | Promise<Response> {
  const session = getSession(sessionId);
  if (!session || session.organizationId !== organizationId) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  touchSession(sessionId);
  return session.transport.handleRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (!auth.authenticated) {
    logMcpEvent("mcp.auth.failed", { reason: auth.error ?? "Unauthorized" });
    return new Response(
      JSON.stringify({ error: auth.error ?? "Unauthorized" }),
      {
        status: auth.statusCode ?? 401,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }

  const organizationId = auth.organizationId ?? "";

  const rateLimit = checkMcpRateLimit(organizationId);
  if (!rateLimit.allowed) {
    logMcpEvent("mcp.rate.limited", { orgId: organizationId });
    return rateLimitResponse(rateLimit.retryAfter);
  }

  const sessionId = request.headers.get("mcp-session-id");

  if (sessionId) {
    return handleExistingSession(request, sessionId, organizationId);
  }

  // No session ID - must be an initialize request.
  // Pre-parse the body here because request.json() consumes the stream.
  // We pass parsedBody to handleRequest so the SDK doesn't re-read it.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  if (!isInitializeRequestBody(body)) {
    return new Response(
      JSON.stringify({
        error: "Missing mcp-session-id header for non-initialize requests",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }

  if (!(auth.organizationId && auth.apiKeyId)) {
    return new Response(
      JSON.stringify({ error: "API key missing organization context" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }

  const apiKeyId = auth.apiKeyId;

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (sid) => {
      setSession(sid, {
        transport,
        server,
        organizationId,
        apiKeyId,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      });
    },
    onsessionclosed: (sid) => {
      deleteSession(sid);
    },
    enableJsonResponse: true,
  });

  // Auth header is captured once and reused for all tool calls in this session.
  // If the API key is revoked mid-session, it remains valid until session expiry.
  const baseUrl = getBaseUrl(request);
  const authHeader = request.headers.get("authorization") ?? "";
  const server = createMcpServer(baseUrl, authHeader);

  await server.connect(transport);

  return transport.handleRequest(request, { parsedBody: body });
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (!auth.authenticated) {
    logMcpEvent("mcp.auth.failed", { reason: auth.error ?? "Unauthorized" });
    return new Response(
      JSON.stringify({ error: auth.error ?? "Unauthorized" }),
      {
        status: auth.statusCode ?? 401,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }

  const sessionId = request.headers.get("mcp-session-id");
  if (!sessionId) {
    return new Response(
      JSON.stringify({ error: "Missing mcp-session-id header" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }

  const session = getSession(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  if (session.organizationId !== auth.organizationId) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  touchSession(sessionId);
  return session.transport.handleRequest(request);
}

export async function DELETE(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (!auth.authenticated) {
    logMcpEvent("mcp.auth.failed", { reason: auth.error ?? "Unauthorized" });
    return new Response(
      JSON.stringify({ error: auth.error ?? "Unauthorized" }),
      {
        status: auth.statusCode ?? 401,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }

  const sessionId = request.headers.get("mcp-session-id");
  if (!sessionId) {
    return new Response(
      JSON.stringify({ error: "Missing mcp-session-id header" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS },
      }
    );
  }

  const session = getSession(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }
  if (session.organizationId !== auth.organizationId) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  await session.server.close();
  await session.transport.close();
  deleteSession(sessionId);

  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
