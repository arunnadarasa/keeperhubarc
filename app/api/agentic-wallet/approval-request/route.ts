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
import {
  USDC_BASE_ADDRESS,
  USDC_TEMPO_ADDRESS,
} from "@/lib/agentic-wallet/constants";
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

  // Phase 37 fix B1: extract + validate the binding fields from
  // operationPayload. The server writes these to dedicated bound_* columns so
  // /approve can refuse to resolve a row whose payload was mutated after
  // create.
  const op = body.operationPayload as Record<string, unknown>;
  const chain = op.chain;
  const challenge =
    op.paymentChallenge && typeof op.paymentChallenge === "object"
      ? (op.paymentChallenge as Record<string, unknown>)
      : undefined;
  if ((chain !== "base" && chain !== "tempo") || !challenge) {
    return Response.json(
      {
        error: "operationPayload missing chain + paymentChallenge",
        code: "BINDING_REQUIRED",
      },
      { status: 422 }
    );
  }
  const recipient =
    chain === "base"
      ? String(challenge.payTo ?? "")
      : String(challenge.payTo ?? challenge.recipient ?? "");
  const amountMicro = String(challenge.amount ?? "0");
  const contract = chain === "base" ? USDC_BASE_ADDRESS : USDC_TEMPO_ADDRESS;
  if (!recipient || amountMicro === "0") {
    return Response.json(
      {
        error: "operationPayload missing recipient or amount",
        code: "BINDING_REQUIRED",
      },
      { status: 422 }
    );
  }

  // Phase 37 fix B3: payload size cap. The per-sub-org pending-row count cap
  // lands in Task 14.
  if (JSON.stringify(body.operationPayload).length > 8 * 1024) {
    return Response.json(
      {
        error: "operationPayload too large (>8 KiB)",
        code: "PAYLOAD_TOO_LARGE",
      },
      { status: 413 }
    );
  }

  try {
    const { id } = await createApprovalRequest({
      subOrgId: auth.subOrgId,
      riskLevel: body.riskLevel,
      operationPayload: body.operationPayload as Record<string, unknown>,
      binding: { recipient, amountMicro, chain, contract },
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
