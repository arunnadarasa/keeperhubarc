/**
 * POST /api/agentic-wallet/sign
 *
 * HMAC-authenticated signing proxy. The agent client signs raw bytes with its
 * per-sub-org HMAC secret; the server resolves the sub-org, classifies the
 * operation risk, and either (a) creates an approval-request row (ask), (b)
 * returns 403 (block), or (c) proxies a Turnkey signRawPayload call and
 * returns the 65-byte EIP-3009 / MPP proof signature.
 *
 * Satisfies PAY-04 (all Turnkey signing server-side; agents never hold the
 * Turnkey API key).
 *
 * Request body: { chain: "base" | "tempo", paymentChallenge: {...} }
 * Auto-tier response: 200 { signature }
 * Ask-tier response:  202 { approvalRequestId }
 * Block responses:    403 { error, code: "RISK_BLOCKED" | "POLICY_BLOCKED" }
 * Upstream errors:    502 { error, code: "TURNKEY_UPSTREAM" }
 *
 * T-33-sign-spoofwallet mitigation: the wallet address used for signing is
 * resolved from the DB keyed on the HMAC-verified sub-org id. The request
 * body is NEVER trusted for the wallet address; that prevents a caller from
 * signing on behalf of a different sub-org.
 *
 * T-33-02 mitigation: logSystemError metadata carries only endpoint + sub-org
 * id -- never the raw body, the signature, or the HMAC secret.
 */
import { eq } from "drizzle-orm";
import { verifyHmacRequest } from "@/lib/agentic-wallet/hmac";
import { createApprovalRequest } from "@/lib/agentic-wallet/approval";
import { classifyRisk } from "@/lib/agentic-wallet/risk";
import {
  PolicyBlockedError,
  TurnkeyUpstreamError,
  signMppProof,
  signX402Challenge,
} from "@/lib/agentic-wallet/sign";
import { db } from "@/lib/db";
import { agenticWallets } from "@/lib/db/schema";
import { ErrorCategory, logSystemError } from "@/lib/logging";

export const dynamic = "force-dynamic";

// Tempo mainnet chain id. signMppProof accepts the chainId via the challenge
// so the same route can extend to Tempo testnet without a signature change.
const TEMPO_CHAIN_ID = 4217;

type SignRequestBody = {
  chain?: unknown;
  paymentChallenge?: unknown;
};

type Chain = "base" | "tempo";

function isChain(value: unknown): value is Chain {
  return value === "base" || value === "tempo";
}

// REVIEW HI-01 + ME-01: maximum validity window for an EIP-3009 x402
// authorization minted by /sign. 10 minutes is generous for any x402
// facilitator's settlement loop while capping replay exposure on a stolen
// HMAC secret.
const MAX_VALIDITY_SECONDS = 10 * 60;
// Small slack on validAfter to tolerate clock skew between agent and server.
const VALID_AFTER_FUTURE_SLACK_SECONDS = 60;

function isNonNegativeSafeInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

function validateX402Validity(
  validAfterRaw: unknown,
  validBeforeRaw: unknown
): string | null {
  if (!isNonNegativeSafeInt(validAfterRaw)) {
    return "validAfter must be a non-negative integer";
  }
  if (!isNonNegativeSafeInt(validBeforeRaw)) {
    return "validBefore must be a non-negative integer";
  }
  const now = Math.floor(Date.now() / 1000);
  const validAfter = validAfterRaw;
  const validBefore = validBeforeRaw;
  if (validAfter > now + VALID_AFTER_FUTURE_SLACK_SECONDS) {
    return "validAfter must not be more than 60s in the future";
  }
  if (validBefore <= now) {
    return "validBefore must be in the future";
  }
  if (validBefore > now + MAX_VALIDITY_SECONDS) {
    return "validBefore must be within 10 minutes of now";
  }
  if (validBefore - validAfter > MAX_VALIDITY_SECONDS) {
    return "validity window (validBefore - validAfter) must be <= 600s";
  }
  return null;
}

export async function POST(request: Request): Promise<Response> {
  // HMAC signs raw bytes -- read text FIRST, never reach request.json().
  const rawBody = await request.text();
  const auth = await verifyHmacRequest(request, rawBody);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  let body: SignRequestBody;
  try {
    body = JSON.parse(rawBody) as SignRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isChain(body.chain)) {
    return Response.json(
      { error: "chain must be 'base' or 'tempo'" },
      { status: 400 }
    );
  }
  if (
    !body.paymentChallenge ||
    typeof body.paymentChallenge !== "object" ||
    Array.isArray(body.paymentChallenge)
  ) {
    return Response.json(
      { error: "paymentChallenge required" },
      { status: 400 }
    );
  }

  const chain: Chain = body.chain;
  const challenge = body.paymentChallenge as Record<string, unknown>;

  // REVIEW HI-01 + ME-01: bound the EIP-3009 validity window on the Base
  // (x402) path so a compromised HMAC secret cannot mint open-ended
  // authorizations. Also guards against NaN / non-integer inputs that
  // Turnkey would sign verbatim and x402 facilitators would later reject.
  // Rejecting (not capping) surfaces client bugs rather than silently
  // overwriting caller intent.
  //
  //   validAfter  must be a non-negative integer <= now
  //   validBefore must be a non-negative integer in (now, now + 600]
  //   total window (validBefore - validAfter) must be <= 600 seconds
  if (chain === "base") {
    const validityError = validateX402Validity(
      challenge.validAfter,
      challenge.validBefore
    );
    if (validityError) {
      return Response.json(
        { error: validityError, code: "INVALID_VALIDITY_WINDOW" },
        { status: 400 }
      );
    }
  }

  // Wallet address resolution from DB -- NEVER trust any caller-supplied
  // wallet value (T-33-sign-spoofwallet).
  const rows = await db
    .select({
      walletAddressBase: agenticWallets.walletAddressBase,
      walletAddressTempo: agenticWallets.walletAddressTempo,
    })
    .from(agenticWallets)
    .where(eq(agenticWallets.subOrgId, auth.subOrgId))
    .limit(1);
  if (rows.length === 0) {
    return Response.json({ error: "Sub-org not found" }, { status: 404 });
  }
  const walletAddress =
    chain === "base" ? rows[0].walletAddressBase : rows[0].walletAddressTempo;

  // Risk classification runs BEFORE the Turnkey round-trip so blocked / asked
  // operations never touch the signer.
  const risk = classifyRisk({
    chain,
    challenge: {
      amount: String(challenge.amount ?? challenge.value ?? "0"),
      payTo: String(challenge.payTo ?? ""),
      selector:
        typeof challenge.selector === "string" ? challenge.selector : undefined,
    },
  });

  if (risk === "block") {
    return Response.json(
      { error: "Operation blocked by risk classification", code: "RISK_BLOCKED" },
      { status: 403 }
    );
  }

  if (risk === "ask") {
    try {
      const ar = await createApprovalRequest({
        subOrgId: auth.subOrgId,
        riskLevel: "ask",
        operationPayload: { chain, paymentChallenge: challenge },
      });
      return Response.json(
        { approvalRequestId: ar.id, status: "pending" },
        { status: 202 }
      );
    } catch (error) {
      logSystemError(
        ErrorCategory.DATABASE,
        "[Agentic] /sign ask-tier approval-request creation failed",
        error,
        {
          endpoint: "/api/agentic-wallet/sign",
          operation: "sign",
          subOrgId: auth.subOrgId,
        }
      );
      return Response.json(
        { error: "Failed to create approval request", code: "INTERNAL" },
        { status: 500 }
      );
    }
  }

  // risk === "auto": proxy to Turnkey.
  try {
    let signature: string;
    if (chain === "base") {
      signature = await signX402Challenge(auth.subOrgId, walletAddress, {
        payTo: String(challenge.payTo ?? ""),
        amount: String(challenge.amount ?? challenge.value ?? "0"),
        validAfter: Number(challenge.validAfter ?? 0),
        validBefore: Number(challenge.validBefore ?? 0),
        nonce: String(challenge.nonce ?? ""),
      });
    } else {
      signature = await signMppProof(auth.subOrgId, walletAddress, {
        chainId:
          typeof challenge.chainId === "number"
            ? challenge.chainId
            : TEMPO_CHAIN_ID,
        challengeId: String(challenge.challengeId ?? ""),
      });
    }
    return Response.json({ signature }, { status: 200 });
  } catch (error) {
    if (error instanceof PolicyBlockedError) {
      // REVIEW HI-02: the error.message ("POLICY_BLOCKED: ...") is controlled
      // server-side today, but returning a fixed string guards against future
      // authors stuffing upstream detail into .message. Internal log still
      // carries the full error via logSystemError for debugging.
      logSystemError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[Agentic] /sign policy blocked",
        error,
        {
          endpoint: "/api/agentic-wallet/sign",
          operation: "sign",
          subOrgId: auth.subOrgId,
        }
      );
      return Response.json(
        { error: "Policy blocked", code: "POLICY_BLOCKED" },
        { status: 403 }
      );
    }
    if (error instanceof TurnkeyUpstreamError) {
      logSystemError(
        ErrorCategory.EXTERNAL_SERVICE,
        "[Agentic] /sign upstream failure",
        error,
        {
          endpoint: "/api/agentic-wallet/sign",
          operation: "sign",
          subOrgId: auth.subOrgId,
        }
      );
      // REVIEW HI-02: do not forward upstream error text to HMAC callers.
      return Response.json(
        { error: "Upstream signer error", code: "TURNKEY_UPSTREAM" },
        { status: 502 }
      );
    }
    logSystemError(
      ErrorCategory.EXTERNAL_SERVICE,
      "[Agentic] /sign internal error",
      error,
      {
        endpoint: "/api/agentic-wallet/sign",
        operation: "sign",
        subOrgId: auth.subOrgId,
      }
    );
    return Response.json(
      { error: "Sign failed", code: "INTERNAL" },
      { status: 500 }
    );
  }
}
