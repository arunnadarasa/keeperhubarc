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
import { describe, expect, it, vi } from "vitest";
import {
  applyBaselinePolicies,
  BASELINE_POLICIES,
  FACILITATOR_ALLOWLIST,
  PolicyIncompleteError,
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

  it("BaselinePolicy type does not carry a consensus field (set at createPolicy call site)", () => {
    for (const p of BASELINE_POLICIES) {
      const hasConsensus = "consensus" in (p as Record<string, unknown>);
      expect(hasConsensus).toBe(false);
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

// ---------------------------------------------------------------------------
// REVIEW HI-04: applyBaselinePolicies partial-failure + post-condition tests.
// These lock the GUARD-06 invariant "Turnkey policy is the ONLY hard limit"
// by proving that ANY incomplete application rolls back and throws
// PolicyIncompleteError, and that listPolicies is consulted as a
// post-condition.
// ---------------------------------------------------------------------------

type PolicyCreateInput = {
  organizationId: string;
  policyName: string;
  effect: string;
  condition: string;
  consensus: string;
  notes: string;
};

type PolicyCreateResult = {
  activity: { id: string; status: string };
  policyId: string;
};

type PolicyDeleteInput = {
  organizationId: string;
  policyId: string;
};

type PolicyListResult = {
  policies: { policyName: string; effect: string }[];
};

type StubClient = {
  createPolicy: ReturnType<typeof vi.fn>;
  deletePolicy: ReturnType<typeof vi.fn>;
  getPolicies: ReturnType<typeof vi.fn>;
};

function makeClient(): StubClient {
  return {
    createPolicy: vi.fn(),
    deletePolicy: vi.fn(),
    getPolicies: vi.fn(),
  };
}

describe("applyBaselinePolicies (HI-04)", () => {
  const SUB_ORG = "subOrg_policy_test";

  it("happy path: creates all 3 policies then verifies via getPolicies", async () => {
    const client = makeClient();
    let counter = 0;
    client.createPolicy.mockImplementation(
      async (_input: PolicyCreateInput): Promise<PolicyCreateResult> => {
        counter += 1;
        return {
          activity: { id: `act_${counter}`, status: "ACTIVITY_STATUS_COMPLETED" },
          policyId: `policy_${counter}`,
        };
      }
    );
    client.getPolicies.mockResolvedValue({
      policies: BASELINE_POLICIES.map((p) => ({
        policyName: p.policyName,
        effect: p.effect,
      })),
    } satisfies PolicyListResult);

    // Cast to the concrete ApiClient shape -- the helper only touches the
    // three methods the stub provides.
    await applyBaselinePolicies(
      client as unknown as Parameters<typeof applyBaselinePolicies>[0],
      SUB_ORG
    );

    expect(client.createPolicy).toHaveBeenCalledTimes(3);
    expect(client.getPolicies).toHaveBeenCalledTimes(1);
    expect(client.deletePolicy).not.toHaveBeenCalled();
  });

  it("rolls back partial successes and throws PolicyIncompleteError on any failure", async () => {
    const client = makeClient();
    // First two succeed, third rejects.
    const created: string[] = [];
    client.createPolicy.mockImplementation(
      async (input: PolicyCreateInput): Promise<PolicyCreateResult> => {
        if (input.policyName === BASELINE_POLICIES[2].policyName) {
          throw new Error("Turnkey 5xx");
        }
        const id = `policy_${created.length + 1}`;
        created.push(id);
        return {
          activity: { id: `act_${id}`, status: "ACTIVITY_STATUS_COMPLETED" },
          policyId: id,
        };
      }
    );

    await expect(
      applyBaselinePolicies(
        client as unknown as Parameters<typeof applyBaselinePolicies>[0],
        SUB_ORG
      )
    ).rejects.toBeInstanceOf(PolicyIncompleteError);

    // getPolicies MUST NOT be queried on the failure path -- we fail fast.
    expect(client.getPolicies).not.toHaveBeenCalled();

    // Two successful creates -> two rollback delete calls.
    expect(client.deletePolicy).toHaveBeenCalledTimes(2);
    const deleteCalls = client.deletePolicy.mock.calls as unknown as Array<
      [PolicyDeleteInput]
    >;
    const deletedIds = deleteCalls.map((c) => c[0].policyId).sort();
    expect(deletedIds).toEqual(["policy_1", "policy_2"]);
  });

  it("PolicyIncompleteError carries the list of failing policyNames", async () => {
    const client = makeClient();
    client.createPolicy.mockImplementation(
      async (input: PolicyCreateInput): Promise<PolicyCreateResult> => {
        if (input.policyName === BASELINE_POLICIES[1].policyName) {
          throw new Error("network timeout");
        }
        return {
          activity: { id: "act", status: "ACTIVITY_STATUS_COMPLETED" },
          policyId: `policy_${input.policyName}`,
        };
      }
    );

    try {
      await applyBaselinePolicies(
        client as unknown as Parameters<typeof applyBaselinePolicies>[0],
        SUB_ORG
      );
      throw new Error("expected PolicyIncompleteError");
    } catch (err) {
      expect(err).toBeInstanceOf(PolicyIncompleteError);
      const pie = err as PolicyIncompleteError;
      expect(pie.subOrgId).toBe(SUB_ORG);
      expect(pie.failures).toEqual([BASELINE_POLICIES[1].policyName]);
    }
  });

  it("post-condition: throws PolicyIncompleteError if getPolicies is missing a baseline policy", async () => {
    const client = makeClient();
    let counter = 0;
    client.createPolicy.mockImplementation(
      async (_input: PolicyCreateInput): Promise<PolicyCreateResult> => {
        counter += 1;
        return {
          activity: { id: `act_${counter}`, status: "ACTIVITY_STATUS_COMPLETED" },
          policyId: `policy_${counter}`,
        };
      }
    );
    // getPolicies reports only 2 of the 3 baseline rules.
    client.getPolicies.mockResolvedValue({
      policies: [
        {
          policyName: BASELINE_POLICIES[0].policyName,
          effect: BASELINE_POLICIES[0].effect,
        },
        {
          policyName: BASELINE_POLICIES[1].policyName,
          effect: BASELINE_POLICIES[1].effect,
        },
      ],
    } satisfies PolicyListResult);

    await expect(
      applyBaselinePolicies(
        client as unknown as Parameters<typeof applyBaselinePolicies>[0],
        SUB_ORG
      )
    ).rejects.toBeInstanceOf(PolicyIncompleteError);

    // Post-condition failure ALSO rolls back the successful creates so the
    // sub-org ends up unprotected (no partial coverage).
    expect(client.deletePolicy).toHaveBeenCalledTimes(3);
  });
});
