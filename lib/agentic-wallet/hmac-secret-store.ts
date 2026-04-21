/**
 * HMAC secret store stub (Phase 33 Wave 0 placeholder).
 *
 * Plan 33-01a wires this up against the `agentic_wallets.hmac_secret` column.
 * Wave 0 ships only the named export so `lib/agentic-wallet/hmac.ts` can compile
 * and the matching test file can mock it via `vi.mock`.
 */
export function lookupHmacSecret(_subOrgId: string): Promise<string | null> {
  throw new Error("lookupHmacSecret: not yet implemented (Phase 33 plan 01a)");
}
