/**
 * Turnkey policy DSL definitions + facilitator allowlist.
 *
 * Phase 33 Wave 0: stub exports only. Plan 33-01a fleshes out the three
 * baseline DENY policies per RESEARCH.md Pattern 2 (lines 301-364) and
 * CONTEXT.md Resolution #2 (Base USDC + Tempo USDC addresses, no extra).
 *
 * Constraints:
 *   - `FACILITATOR_ALLOWLIST` is frozen at build time; no runtime mutation.
 *   - `BASELINE_POLICIES.length === 3` (Turnkey DSL: one rule per policyName).
 *   - All three policies use `effect: "EFFECT_DENY"` and empty `consensus`
 *     to avoid the CONSENSUS_NEEDED pitfall called out in RESEARCH Pitfall 7.
 */
export const FACILITATOR_ALLOWLIST: readonly string[] = [];

export type BaselinePolicy = {
  readonly policyName: string;
  readonly effect: "EFFECT_DENY";
  readonly condition: string;
  readonly notes: string;
};

export const BASELINE_POLICIES: readonly BaselinePolicy[] = [];
