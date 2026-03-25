import "server-only";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { authenticateApiKey } from "@/lib/api-key-auth";
import { createMcpServer } from "@/lib/mcp/server";
import {
  deleteSession,
  getSession,
  setSession,
  startCleanupInterval,
  touchSession,
} from "@/lib/mcp/sessions";

export const dynamic = "force-dynamic";

// Start the session cleanup interval once per process lifetime
startCleanupInterval();

function deriveBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function isInitializeRequestBody(body: unknown): boolean {
  if (Array.isArray(body)) {
    return body.some((item) => isInitializeRequest(item));
  }
  return isInitializeRequest(body);
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if (!auth.authenticated) {
    return new Response(
      JSON.stringify({ error: auth.error ?? "Unauthorized" }),
      {
        status: auth.statusCode ?? 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const sessionId = request.headers.get("mcp-session-id");

  if (sessionId) {
    const session = getSession(sessionId);
    if (!session) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (session.organizationId !== auth.organizationId) {
      return new Response(JSON.stringify({ error: "Session not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    touchSession(sessionId);
    return session.transport.handleRequest(request);
  }

  // No session ID - must be an initialize request
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!isInitializeRequestBody(body)) {
    return new Response(
      JSON.stringify({
        error: "Missing mcp-session-id header for non-initialize requests",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const organizationId = auth.organizationId ?? "";
  const apiKeyId = auth.apiKeyId ?? "";

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

  const baseUrl = deriveBaseUrl(request);
  const authHeader = request.headers.get("authorization") ?? "";
  const server = createMcpServer(baseUrl, authHeader);

  await server.connect(transport);

  return transport.handleRequest(request, { parsedBody: body });
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if (!auth.authenticated) {
    return new Response(
      JSON.stringify({ error: auth.error ?? "Unauthorized" }),
      {
        status: auth.statusCode ?? 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const sessionId = request.headers.get("mcp-session-id");
  if (!sessionId) {
    return new Response(
      JSON.stringify({ error: "Missing mcp-session-id header" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const session = getSession(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (session.organizationId !== auth.organizationId) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  touchSession(sessionId);
  return session.transport.handleRequest(request);
}

export async function DELETE(request: Request): Promise<Response> {
  const auth = await authenticateApiKey(request);
  if (!auth.authenticated) {
    return new Response(
      JSON.stringify({ error: auth.error ?? "Unauthorized" }),
      {
        status: auth.statusCode ?? 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const sessionId = request.headers.get("mcp-session-id");
  if (!sessionId) {
    return new Response(
      JSON.stringify({ error: "Missing mcp-session-id header" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const session = getSession(sessionId);
  if (!session) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (session.organizationId !== auth.organizationId) {
    return new Response(JSON.stringify({ error: "Session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  await session.transport.close();
  deleteSession(sessionId);

  return new Response(null, { status: 204 });
}
