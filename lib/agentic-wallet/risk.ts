/**
 * Risk tier classifier for agentic-wallet signing requests.
 *
 * Phase 33 Wave 0: stub only. Plan 33-01a implements the tiered rules
 * anchored to RESEARCH.md Pattern 6 (lines 542-566):
 *   - block:  amount > 100 USDC OR selector is unlimited approve (0x095ea7b3)
 *   - ask:    amount in [50, 100] USDC OR unknown selector
 *   - auto:   everything else (paid workflow calls under $5)
 */
export type RiskLevel = "auto" | "ask" | "block";

export type RiskPayload = {
  chain: "base" | "tempo";
  challenge: { amount: string; payTo: string; selector?: string };
};

export function classifyRisk(_payload: RiskPayload): RiskLevel {
  throw new Error("classifyRisk: not yet implemented (Phase 33 plan 01a)");
}
