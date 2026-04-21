/**
 * POST /api/agentic-wallet/provision
 *
 * ONBOARD-01 public entry point for agentic-wallet creation.
 *
 * - No auth headers. IP rate-limited (5 / hour / IP) via
 *   lib/mcp/rate-limit::checkIpRateLimit to bound unauthenticated abuse
 *   (T-33-01).
 * - Delegates the Turnkey + DB pipeline to provisionAgenticWallet()
 *   (Plan 33-01a).
 * - 200 response body: { subOrgId, walletAddress, hmacSecret }. The 10s
 *   wall-clock SLO is enforced by the integration test.
 * - Error mapping: Turnkey 5xx -> 502 with code="TURNKEY_UPSTREAM"; any
 *   other failure -> 500 with code="INTERNAL" and a generic message.
 * - T-33-02 (Information Disclosure): NEVER include the request body or
 *   hmacSecret in logSystemError metadata.
 */
import { provisionAgenticWallet } from "@/lib/agentic-wallet/provision";
import { ErrorCategory, logSystemError } from "@/lib/logging";
import { checkIpRateLimit, getClientIp } from "@/lib/mcp/rate-limit";

export const dynamic = "force-dynamic";

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request): Promise<Response> {
  const ip = getClientIp(request);
  const rate = checkIpRateLimit(ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rate.allowed) {
    return Response.json(
      { error: "Rate limit exceeded", retryAfter: rate.retryAfter },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfter) },
      }
    );
  }

  try {
    const result = await provisionAgenticWallet();
    return Response.json(result, { status: 200 });
  } catch (error) {
    const isTurnkey =
      error instanceof Error && /turnkey|sub-org/i.test(error.message);
    logSystemError(
      ErrorCategory.EXTERNAL_SERVICE,
      "[Agentic] /provision failed",
      error,
      {
        // T-33-02: do NOT include the request body or hmacSecret in meta.
        endpoint: "/api/agentic-wallet/provision",
        operation: "provision",
      }
    );
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Provision failed",
        code: isTurnkey ? "TURNKEY_UPSTREAM" : "INTERNAL",
      },
      { status: isTurnkey ? 502 : 500 }
    );
  }
}
