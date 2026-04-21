/**
 * POST /api/agentic-wallet/approval-request
 *
 * HMAC-authenticated creation of a pending wallet approval request. The agent
 * client signs the raw body with its per-sub-org HMAC secret; the server maps
 * the signature back to the sub-org and inserts a pending row so the user can
 * approve or reject via the session-authenticated /:id/approve route.
 *
 * Request body: { riskLevel: "ask" | "block", operationPayload: object }
 * Response: 201 { id: string }
 *
 * T-33-02 (Information Disclosure): logSystemError metadata carries only
 * endpoint + subOrgId -- never the raw body or the HMAC secret.
 */
import { createApprovalRequest } from "@/lib/agentic-wallet/approval";
import { verifyHmacRequest } from "@/lib/agentic-wallet/hmac";
import { ErrorCategory, logSystemError } from "@/lib/logging";

export const dynamic = "force-dynamic";

type CreateRequestBody = {
  riskLevel?: unknown;
  operationPayload?: unknown;
};

export async function POST(request: Request): Promise<Response> {
  const rawBody = await request.text();
  const auth = await verifyHmacRequest(request, rawBody);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  let body: CreateRequestBody;
  try {
    body = JSON.parse(rawBody) as CreateRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.riskLevel !== "ask" && body.riskLevel !== "block") {
    return Response.json(
      { error: "riskLevel must be 'ask' or 'block'" },
      { status: 400 }
    );
  }
  if (
    !body.operationPayload ||
    typeof body.operationPayload !== "object" ||
    Array.isArray(body.operationPayload)
  ) {
    return Response.json(
      { error: "operationPayload must be an object" },
      { status: 400 }
    );
  }

  try {
    const { id } = await createApprovalRequest({
      subOrgId: auth.subOrgId,
      riskLevel: body.riskLevel,
      operationPayload: body.operationPayload as Record<string, unknown>,
    });
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    logSystemError(
      ErrorCategory.DATABASE,
      "[Agentic] /approval-request create failed",
      error,
      {
        endpoint: "/api/agentic-wallet/approval-request",
        subOrgId: auth.subOrgId,
      }
    );
    return Response.json(
      { error: "Failed to create approval request" },
      { status: 500 }
    );
  }
}
