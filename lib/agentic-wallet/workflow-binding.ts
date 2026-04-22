/**
 * Server-derived payTo + amount verification for /sign.
 *
 * Phase 37 fix #2: closes the HMAC-compromise drain by reading the
 * recipient and amount from the workflows registry instead of trusting
 * the caller-supplied paymentChallenge. The wallet client (v0.1.5+)
 * forwards the workflowSlug extracted from the x402 resource.url.
 *
 * Lookup chain mirrors lib/x402/payment-gate.ts:resolveCreatorWallet.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationWallets, workflows } from "@/lib/db/schema";

export type BindingFailure = {
  ok: false;
  status: number;
  code:
    | "WORKFLOW_SLUG_REQUIRED"
    | "UNKNOWN_WORKFLOW"
    | "WORKFLOW_NOT_PAYABLE"
    | "PAYTO_MISMATCH"
    | "AMOUNT_MISMATCH";
  error: string;
};

export type BindingOk = {
  ok: true;
  expectedPayTo: string;
  expectedAmountMicro: string;
  workflowId: string;
};

export type BindingResult = BindingOk | BindingFailure;

const USDC_DECIMALS = 6;

function priceToMicro(
  priceUsdcPerCall: string | null | undefined
): bigint | null {
  if (!priceUsdcPerCall) {
    return null;
  }
  const n = Number(priceUsdcPerCall);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return BigInt(Math.round(n * 10 ** USDC_DECIMALS));
}

export async function verifyWorkflowBinding(
  slug: string | undefined | null,
  payTo: string,
  amountMicro: string
): Promise<BindingResult> {
  if (!slug) {
    return {
      ok: false,
      status: 400,
      code: "WORKFLOW_SLUG_REQUIRED",
      error: "workflowSlug is required",
    };
  }

  const rows = await db
    .select({
      id: workflows.id,
      organizationId: workflows.organizationId,
      priceUsdcPerCall: workflows.priceUsdcPerCall,
    })
    .from(workflows)
    .where(and(eq(workflows.listedSlug, slug), eq(workflows.isListed, true)))
    .limit(1);

  const wf = rows[0];
  if (!wf) {
    return {
      ok: false,
      status: 403,
      code: "UNKNOWN_WORKFLOW",
      error: "Workflow not found or not listed",
    };
  }

  const orgId = wf.organizationId;
  if (!orgId) {
    return {
      ok: false,
      status: 403,
      code: "WORKFLOW_NOT_PAYABLE",
      error: "Workflow has no organization",
    };
  }

  const walletRows = await db
    .select({ walletAddress: organizationWallets.walletAddress })
    .from(organizationWallets)
    .where(
      and(
        eq(organizationWallets.organizationId, orgId),
        eq(organizationWallets.isActive, true)
      )
    )
    .limit(1);
  const expectedPayTo = walletRows[0]?.walletAddress;

  const expectedMicro = priceToMicro(wf.priceUsdcPerCall);
  if (!expectedPayTo || expectedMicro === null) {
    return {
      ok: false,
      status: 403,
      code: "WORKFLOW_NOT_PAYABLE",
      error: "Workflow has no active wallet or price",
    };
  }

  if (payTo.toLowerCase() !== expectedPayTo.toLowerCase()) {
    return {
      ok: false,
      status: 403,
      code: "PAYTO_MISMATCH",
      error: "payTo does not match workflow creator wallet",
    };
  }

  let actualMicro: bigint;
  try {
    actualMicro = BigInt(amountMicro);
  } catch {
    return {
      ok: false,
      status: 403,
      code: "AMOUNT_MISMATCH",
      error: "amount is not a valid integer",
    };
  }
  if (actualMicro !== expectedMicro) {
    return {
      ok: false,
      status: 403,
      code: "AMOUNT_MISMATCH",
      error: "amount does not match workflow priceUsdcPerCall",
    };
  }

  return {
    ok: true,
    expectedPayTo,
    expectedAmountMicro: expectedMicro.toString(),
    workflowId: wf.id,
  };
}
