/**
 * Turnkey policy DSL definitions + facilitator allowlist.
 *
 * GUARD-06 baseline policies applied ONCE at sub-org creation time.
 * Plan 33-02 (/sign) must NOT call createPolicy or updatePolicy —
 * Turnkey enforces these rules at signRawPayload regardless of caller.
 *
 * References:
 *   - 33-RESEARCH.md Pattern 2 (lines 301-364) — exact DSL strings
 *   - 33-CONTEXT.md Resolution #2 — two USDC addresses (no HTTP facilitators)
 *   - RESEARCH.md Pitfall 7 — empty consensus avoids CONSENSUS_NEEDED
 */
import type { Turnkey } from "@turnkey/sdk-server";

// USDC contract addresses — CONTEXT Resolution #2 (locked 2026-04-21).
// Base USDC source: lib/x402/reconcile.ts:4
// Tempo USDC source: lib/mpp/server.ts:3
export const USDC_BASE =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const USDC_TEMPO =
  "0x20c000000000000000000000b9537d11c60e8b50" as const;

// Lowercase copies for Turnkey DSL `eth.tx.to in [...]` membership comparisons.
// Turnkey normalizes `eth.tx.to` to lowercase hex; allowlist entries MUST match.
const USDC_BASE_LC = USDC_BASE.toLowerCase();
const USDC_TEMPO_LC = USDC_TEMPO.toLowerCase();

export const FACILITATOR_ALLOWLIST: readonly string[] = [
  USDC_BASE,
  USDC_TEMPO,
] as const;

export type BaselinePolicy = {
  readonly policyName: string;
  readonly effect: "EFFECT_DENY";
  readonly condition: string;
  readonly notes: string;
};

// Baseline Turnkey policies (GUARD-06) — applied once at sub-org creation.
// /sign MUST NOT update or remove these (T-33-03 mitigation).
export const BASELINE_POLICIES: readonly BaselinePolicy[] = [
  {
    policyName: "block-erc20-unlimited-approve",
    effect: "EFFECT_DENY",
    condition:
      "eth.tx.function_signature == '0x095ea7b3' && eth.tx.contract_call_args['value'] >= 4294967296",
    notes: "GUARD-06: block unlimited ERC-20 approvals (amount >= 2^32)",
  },
  {
    policyName: "block-erc20-transfer-over-100usdc",
    effect: "EFFECT_DENY",
    condition:
      "(eth.tx.function_signature == '0xa9059cbb' && eth.tx.contract_call_args['value'] > 100000000) || (eth.tx.function_signature == '0x23b872dd' && eth.tx.contract_call_args['value'] > 100000000)",
    notes: "GUARD-06: block ERC-20 transfers above 100 USDC (6-decimal cap)",
  },
  {
    policyName: "allowlist-outbound-contracts",
    effect: "EFFECT_DENY",
    condition: `!(eth.tx.to in ['${USDC_BASE_LC}', '${USDC_TEMPO_LC}'])`,
    notes: "GUARD-06: only permit outbound calls to allowlisted USDC contracts",
  },
] as const;

type ApiClient = ReturnType<Turnkey["apiClient"]>;

/**
 * Apply all three baseline DENY policies to a freshly-created sub-org.
 * Parallelized via Promise.all to keep /provision latency under the
 * 10-second ONBOARD-01 SLO (RESEARCH Pitfall 1).
 *
 * Any single createPolicy rejection rejects the whole Promise.all; the
 * caller (provisionAgenticWallet) surfaces the error and logs it. The
 * sub-org is left with partial policies — a follow-up retry must use
 * idempotent policyNames (Turnkey enforces name-uniqueness per sub-org).
 */
export async function applyBaselinePolicies(
  client: ApiClient,
  subOrgId: string
): Promise<void> {
  await Promise.all(
    BASELINE_POLICIES.map((p) =>
      client.createPolicy({
        organizationId: subOrgId,
        policyName: p.policyName,
        effect: p.effect,
        condition: p.condition,
        consensus: "",
        notes: p.notes,
      })
    )
  );
}
