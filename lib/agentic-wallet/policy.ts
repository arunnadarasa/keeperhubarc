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
// Single source of truth lives in ./constants.
import {
  USDC_BASE_ADDRESS,
  USDC_BASE_LC,
  USDC_TEMPO_ADDRESS,
  USDC_TEMPO_LC,
} from "./constants";

export const FACILITATOR_ALLOWLIST: readonly string[] = [
  USDC_BASE_ADDRESS,
  USDC_TEMPO_ADDRESS,
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
 * Thrown when baseline policies could not be applied completely to a
 * freshly-created sub-org. The provisioning flow catches this and treats
 * the sub-org as unusable (the caller must NOT return an hmacSecret since
 * GUARD-06 says Turnkey policy is the ONLY hard limit -- a sub-org with
 * partial policy coverage is dangerous).
 *
 * REVIEW HI-04: prefer this typed error over generic Error so the
 * provisioning path can react deterministically without substring-matching
 * on .message. The instance still inherits from Error for log fidelity.
 */
export class PolicyIncompleteError extends Error {
  override readonly name = "PolicyIncompleteError";
  readonly failures: readonly string[];
  readonly subOrgId: string;
  constructor(subOrgId: string, failures: readonly string[]) {
    super(
      `Baseline policies incomplete for sub-org ${subOrgId}: ${failures.join(", ")}`
    );
    this.subOrgId = subOrgId;
    this.failures = failures;
  }
}

/**
 * Apply all three baseline DENY policies to a freshly-created sub-org.
 *
 * REVIEW HI-04 (Partial policy coverage): previously the helper used
 * Promise.all, so a single createPolicy rejection rejected the whole
 * batch but the already-issued createPolicy calls remained on Turnkey's
 * side. That left the sub-org with 1 or 2 of the 3 baseline DENY rules,
 * violating GUARD-06 ("Turnkey policy is the ONLY hard limit"). The new
 * flow uses Promise.allSettled to observe every outcome, then on ANY
 * failure:
 *
 *   1. Best-effort deletes policies that DID succeed so the sub-org is
 *      left fully unprotected (no partial coverage that looks safe but
 *      isn't). We prefer "no policy at all" over "2 out of 3 policies"
 *      because the sub-org is going to be abandoned either way.
 *   2. Throws PolicyIncompleteError with the list of failing policy
 *      names so the provisioning caller can fail the whole transaction
 *      deterministically.
 *
 * After success, the helper queries listPolicies and verifies all three
 * baseline policy names are present -- a defence against Turnkey silently
 * accepting a createPolicy request that later doesn't materialise.
 */
export async function applyBaselinePolicies(
  client: ApiClient,
  subOrgId: string
): Promise<void> {
  const settled = await Promise.allSettled(
    BASELINE_POLICIES.map((p) =>
      client.createPolicy({
        organizationId: subOrgId,
        policyName: p.policyName,
        effect: p.effect,
        condition: p.condition,
        // Turnkey v5.3.0 requires a valid expression for consensus even on
        // EFFECT_DENY policies; the empty-string shortcut noted in the original
        // 33-RESEARCH.md Pitfall 7 was incorrect. "true" means "consensus is
        // always satisfied" — combined with EFFECT_DENY this unconditionally
        // denies the operation whenever the condition matches, which is the
        // intended GUARD-06 behaviour.
        consensus: "true",
        notes: p.notes,
      })
    )
  );

  const failures: string[] = [];
  const successes: { policyId: string; policyName: string }[] = [];
  const pairs = settled.map((result, idx) => ({
    result,
    policy: BASELINE_POLICIES[idx],
  }));
  for (const { result, policy } of pairs) {
    if (!policy) {
      continue;
    }
    if (result.status === "rejected") {
      failures.push(policy.policyName);
    } else {
      // createPolicy returns { activity: {...}, policyId: string }.
      const res = result.value as unknown as { policyId?: string };
      if (res?.policyId) {
        successes.push({
          policyId: res.policyId,
          policyName: policy.policyName,
        });
      }
    }
  }

  if (failures.length > 0) {
    // Best-effort rollback of any partial successes. Failures here are
    // non-fatal -- we are about to throw anyway, and the provisioning flow
    // must treat the sub-org as abandoned.
    await Promise.allSettled(
      successes.map((s) =>
        client.deletePolicy({
          organizationId: subOrgId,
          policyId: s.policyId,
        })
      )
    );
    throw new PolicyIncompleteError(subOrgId, failures);
  }

  // Post-condition: verify all three baseline policies are actually visible
  // on Turnkey's side. This catches the (rare but documented) case where
  // createPolicy succeeds but the policy is not yet queryable, and any
  // future regression where a silent failure would leave a gap.
  const listed = (await client.getPolicies({
    organizationId: subOrgId,
  })) as { policies?: { policyName: string; effect: string }[] };
  const presentNames = new Set(
    (listed.policies ?? []).map((p) => p.policyName)
  );
  const missing = BASELINE_POLICIES.filter(
    (p) => !presentNames.has(p.policyName)
  ).map((p) => p.policyName);
  if (missing.length > 0) {
    // Best-effort rollback then throw -- same semantics as the batch-failure
    // path above.
    await Promise.allSettled(
      successes.map((s) =>
        client.deletePolicy({
          organizationId: subOrgId,
          policyId: s.policyId,
        })
      )
    );
    throw new PolicyIncompleteError(subOrgId, missing);
  }
}
