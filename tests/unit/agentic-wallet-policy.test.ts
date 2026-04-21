/**
 * Wave 0 RED scaffold for lib/agentic-wallet/policy.ts.
 *
 * Contract anchor: 33-RESEARCH.md Pattern 2 (lines 301-364) and
 * 33-CONTEXT.md Resolution #2 (lines 126-127).
 *
 * The three baseline Turnkey policies are non-negotiable per GUARD-06 and
 * must be applied at provision time. This scaffold pins the literal policy
 * names, condition substrings, effect = "EFFECT_DENY", and the Base + Tempo
 * USDC addresses into the allowlist so Wave 1+ cannot silently water them
 * down. Baseline: every assertion fails because BASELINE_POLICIES is an
 * empty stub array. Plan 33-01a flips this suite GREEN.
 */
import { describe, expect, it } from "vitest";
import {
  BASELINE_POLICIES,
  FACILITATOR_ALLOWLIST,
} from "@/lib/agentic-wallet/policy";

describe("BASELINE_POLICIES", () => {
  it("contains exactly 3 entries (Turnkey DSL: one rule per policyName)", () => {
    expect(BASELINE_POLICIES.length).toBe(3);
  });

  it("entry 0 blocks unlimited ERC-20 approvals (selector 0x095ea7b3)", () => {
    const p = BASELINE_POLICIES[0];
    expect(p).toBeDefined();
    expect(p?.policyName).toBe("block-erc20-unlimited-approve");
    expect(p?.effect).toBe("EFFECT_DENY");
    // Condition string must name the approve selector and the 2^32 threshold.
    expect(p?.condition).toContain("0x095ea7b3");
    expect(p?.condition).toContain("4294967296");
  });

  it("entry 1 caps transfer / transferFrom at 100 USDC (6 decimals)", () => {
    const p = BASELINE_POLICIES[1];
    expect(p).toBeDefined();
    // 0xa9059cbb = transfer(address,uint256); 0x23b872dd = transferFrom
    expect(p?.condition).toContain("0xa9059cbb");
    expect(p?.condition).toContain("0x23b872dd");
    // 100 USDC in 6 decimals = 100_000_000.
    expect(p?.condition).toContain("100000000");
    expect(p?.effect).toBe("EFFECT_DENY");
  });

  it("entry 2 enforces the outbound contract allowlist", () => {
    const p = BASELINE_POLICIES[2];
    expect(p).toBeDefined();
    // The Turnkey DSL uses `x in [...]` for membership; the inverse is
    // the deny rule. Either substring is acceptable.
    const cond = p?.condition ?? "";
    const hasAllowlistClause =
      cond.includes("eth.tx.to in [") || cond.includes("!(eth.tx.to in [");
    expect(hasAllowlistClause).toBe(true);
    // References at least one address from FACILITATOR_ALLOWLIST.
    const anyKnown = FACILITATOR_ALLOWLIST.some((addr) =>
      cond.toLowerCase().includes(addr.toLowerCase())
    );
    expect(anyKnown).toBe(true);
    expect(p?.effect).toBe("EFFECT_DENY");
  });

  it("every policy has empty-or-absent consensus (no CONSENSUS_NEEDED surprise)", () => {
    for (const p of BASELINE_POLICIES) {
      const consensus =
        (p as unknown as { consensus?: string }).consensus ?? "";
      expect(consensus).toBe("");
    }
  });

  it("all three policy names are unique (Turnkey enforces uniqueness)", () => {
    const names = new Set(BASELINE_POLICIES.map((p) => p.policyName));
    expect(names.size).toBe(3);
  });
});

describe("FACILITATOR_ALLOWLIST", () => {
  it("includes the Base USDC contract (CONTEXT Resolution #2)", () => {
    expect(FACILITATOR_ALLOWLIST).toContain(
      "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    );
  });

  it("includes the Tempo USDC contract (CONTEXT Resolution #2)", () => {
    expect(FACILITATOR_ALLOWLIST).toContain(
      "0x20c000000000000000000000b9537d11c60e8b50"
    );
  });

  it("is exported as a readonly array (compile-time const-assertion check)", () => {
    // A `readonly string[]` still supports `.includes` / `.length` checks.
    expect(Array.isArray(FACILITATOR_ALLOWLIST)).toBe(true);
    expect(FACILITATOR_ALLOWLIST.length).toBeGreaterThanOrEqual(2);
  });
});
