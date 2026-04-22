/**
 * Integration tests for POST /api/agentic-wallet/provision.
 *
 * Coverage:
 *   - 200 happy-path response shape + ONBOARD-01 10s wall-clock SLO
 *   - Anonymous Turnkey sub-org flags (all 4 disable* true, no userEmail)
 *   - GUARD-06 baseline policies applied for all entries
 *   - DB inserts into agentic_wallets + agentic_wallet_credits
 *   - IP rate limit returns 429 on the 6th call within the hour window
 *   - Turnkey 5xx surfaces as 502 with code="TURNKEY_UPSTREAM"
 *
 * NOTE: the in-memory rate limiter in lib/mcp/rate-limit is shared across
 * tests in this file. Each scenario uses a UNIQUE x-forwarded-for value so
 * the 5/hour budget doesn't leak between tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Named function expression so `new Turnkey(...)` inside the factory treats
// the mock as a constructor (vitest 4 does not auto-wrap arrow fns with
// [[Construct]]). Matches the pattern used in the provision unit test.
const {
  mockCreateSubOrg,
  mockCreatePolicy,
  mockGetPolicies,
  mockDeletePolicy,
  mockDbInsert,
  mockDbValues,
  mockDbTransaction,
  mockInsertHmacSecret,
} = vi.hoisted(() => {
  const createSubOrg = vi.fn();
  const createPolicy = vi.fn();
  const getPolicies = vi.fn();
  const deletePolicy = vi.fn();
  const dbValues = vi.fn();
  const dbInsert = vi.fn(() => ({ values: dbValues }));
  // Phase 37 Wave 4 Task 19: the provision path now calls
  // db.transaction(async (tx) => { tx.insert(...).values(...) x2 }). The
  // mock transaction invokes the callback with a tx handle that routes
  // back through mockDbInsert/mockDbValues, so the existing assertions on
  // values() continue to fire. insertHmacSecret is mocked separately so
  // the route does not need AGENTIC_WALLET_HMAC_KMS_KEY.
  const dbTransaction = vi.fn(
    async (
      cb: (tx: { insert: typeof dbInsert }) => Promise<void>
    ): Promise<void> => {
      await cb({ insert: dbInsert });
    }
  );
  const insertHmacSecret = vi.fn().mockResolvedValue(undefined);
  return {
    mockCreateSubOrg: createSubOrg,
    mockCreatePolicy: createPolicy,
    mockGetPolicies: getPolicies,
    mockDeletePolicy: deletePolicy,
    mockDbInsert: dbInsert,
    mockDbValues: dbValues,
    mockDbTransaction: dbTransaction,
    mockInsertHmacSecret: insertHmacSecret,
  };
});

// Stand-in classes for the Turnkey SDK error types. The production route uses
// `instanceof` against the real exports from @turnkey/sdk-server, but tests
// mock the whole module -- exposing lightweight Error subclasses here lets the
// name-based fallback path exercise the TURNKEY_UPSTREAM branch while keeping
// the mock self-contained.
class TurnkeyRequestErrorMock extends Error {
  override name = "TurnkeyRequestError";
}
class TurnkeyActivityErrorMock extends Error {
  override name = "TurnkeyActivityError";
}

vi.mock("@turnkey/sdk-server", () => ({
  Turnkey: vi.fn(function TurnkeyMock(this: unknown): {
    apiClient: () => {
      createSubOrganization: typeof mockCreateSubOrg;
      createPolicy: typeof mockCreatePolicy;
      getPolicies: typeof mockGetPolicies;
      deletePolicy: typeof mockDeletePolicy;
    };
  } {
    return {
      apiClient: () => ({
        createSubOrganization: mockCreateSubOrg,
        createPolicy: mockCreatePolicy,
        getPolicies: mockGetPolicies,
        deletePolicy: mockDeletePolicy,
      }),
    };
  }),
  TurnkeyRequestError: TurnkeyRequestErrorMock,
  TurnkeyActivityError: TurnkeyActivityErrorMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: mockDbInsert,
    transaction: mockDbTransaction,
  },
}));

// Phase 37 Wave 4 Task 19: provisionAgenticWallet now calls
// insertHmacSecret after the wallet/credit txn commits. Mock the whole
// hmac-secret-store module so the route doesn't try to read
// AGENTIC_WALLET_HMAC_KMS_KEY during the integration test run. Note that
// the sign-route/credit-route/link-route tests mock only lookupHmacSecret
// from this module — those paths don't touch insertHmacSecret, so keeping
// the mock shape narrow to exactly what each test uses is fine.
vi.mock("@/lib/agentic-wallet/hmac-secret-store", () => ({
  insertHmacSecret: mockInsertHmacSecret,
}));

// Turnkey env must be set before route import (provisionAgenticWallet reads
// these at call time; getTurnkeyParentClient reads them at factory time).
process.env.TURNKEY_API_PUBLIC_KEY = "test-pub";
process.env.TURNKEY_API_PRIVATE_KEY = "test-priv";
process.env.TURNKEY_ORGANIZATION_ID = "org_test";

const { POST } = await import("@/app/api/agentic-wallet/provision/route");
const { BASELINE_POLICIES } = await import("@/lib/agentic-wallet/policy");

function makeRequest(ip: string): Request {
  return new Request("http://localhost:3000/api/agentic-wallet/provision", {
    method: "POST",
    headers: {
      "x-forwarded-for": ip,
      "Content-Type": "application/json",
    },
  });
}

describe("POST /api/agentic-wallet/provision", () => {
  beforeEach(() => {
    mockCreateSubOrg.mockReset();
    mockCreatePolicy.mockReset();
    mockGetPolicies.mockReset();
    mockDeletePolicy.mockReset();
    mockDbValues.mockReset();
    mockDbInsert.mockClear();
    mockDbTransaction.mockClear();
    mockInsertHmacSecret.mockClear();
    mockInsertHmacSecret.mockResolvedValue(undefined);
    mockDbValues.mockResolvedValue(undefined);
    mockCreateSubOrg.mockResolvedValue({
      subOrganizationId: "subOrg_test_123",
      wallet: { addresses: ["0xabc0000000000000000000000000000000dead01"] },
    });
    // createPolicy returns { policyId } per v1CreatePolicyResult.
    let policyCounter = 0;
    mockCreatePolicy.mockImplementation(async () => {
      policyCounter += 1;
      return {
        activity: {
          id: `act_${policyCounter}`,
          status: "ACTIVITY_STATUS_COMPLETED",
        },
        policyId: `policy_${policyCounter}`,
      };
    });
    // REVIEW HI-04: getPolicies post-condition verify -- return all
    // baseline policy names on the happy path.
    mockGetPolicies.mockResolvedValue({
      policies: BASELINE_POLICIES.map((p) => ({
        policyName: p.policyName,
        effect: p.effect,
      })),
    });
    mockDeletePolicy.mockResolvedValue({});
  });

  it("returns 200 with subOrgId, walletAddress, hmacSecret under the 10s SLO", async () => {
    const start = Date.now();
    const res = await POST(makeRequest("203.0.113.10"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      subOrgId: string;
      walletAddress: string;
      hmacSecret: string;
    };
    expect(body.subOrgId).toBe("subOrg_test_123");
    expect(body.walletAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(body.hmacSecret).toMatch(/^[0-9a-f]{64}$/);
    // ONBOARD-01 wall-clock SLO: <10s end-to-end.
    expect(Date.now() - start).toBeLessThan(10_000);
  });

  it("sends anonymous disable* flags and no userEmail to Turnkey", async () => {
    await POST(makeRequest("203.0.113.11"));
    const args = mockCreateSubOrg.mock.calls[0]?.[0] as {
      disableEmailAuth: boolean;
      disableEmailRecovery: boolean;
      disableSmsAuth: boolean;
      disableOtpEmailAuth: boolean;
      rootQuorumThreshold: number;
      rootUsers: Array<{ userEmail?: string }>;
      wallet: { accounts: Array<{ path: string }> };
    };
    expect(args.disableEmailAuth).toBe(true);
    expect(args.disableEmailRecovery).toBe(true);
    expect(args.disableSmsAuth).toBe(true);
    expect(args.disableOtpEmailAuth).toBe(true);
    expect(args.rootQuorumThreshold).toBe(1);
    expect(args.rootUsers[0]?.userEmail).toBeUndefined();
    expect(args.wallet.accounts[0]?.path).toBe("m/44'/60'/0'/0/0");
  });

  it("applies all baseline Turnkey policies", async () => {
    await POST(makeRequest("203.0.113.12"));
    expect(mockCreatePolicy).toHaveBeenCalledTimes(BASELINE_POLICIES.length);
    const policyNames = mockCreatePolicy.mock.calls
      .map((c) => (c[0] as { policyName: string }).policyName)
      .sort();
    const expectedNames = BASELINE_POLICIES.map((p) => p.policyName).sort();
    expect(policyNames).toEqual(expectedNames);
  });

  it("inserts rows into agentic_wallets and agentic_wallet_credits inside a single db.transaction (Phase 37 Wave 4 Task 19)", async () => {
    await POST(makeRequest("203.0.113.13"));
    // Task 19: wallet + credit inserts land atomically inside one
    // db.transaction. The tx mock invokes the callback with tx.insert ==
    // the same mockDbInsert fn, so mockDbInsert still fires twice inside
    // the single mockDbTransaction call.
    expect(mockDbTransaction).toHaveBeenCalledTimes(1);
    expect(mockDbInsert.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Assert the credit grant carried the ONBOARD-03 $0.50 amount.
    const creditValuesCall = mockDbValues.mock.calls.find(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        "amountUsdcCents" in (call[0] as Record<string, unknown>)
    );
    expect(creditValuesCall).toBeDefined();
    expect(
      (creditValuesCall?.[0] as { amountUsdcCents: number }).amountUsdcCents
    ).toBe(50);
    // Legacy hmac_secret column is no longer written (Task 19 drop column
    // deferred per SPEC.md line 117).
    const walletValuesCall = mockDbValues.mock.calls.find(
      (call) =>
        typeof call[0] === "object" &&
        call[0] !== null &&
        "walletAddressBase" in (call[0] as Record<string, unknown>)
    );
    expect(walletValuesCall).toBeDefined();
    expect(
      "hmacSecret" in (walletValuesCall?.[0] as Record<string, unknown>)
    ).toBe(false);
  });

  it("writes the HMAC secret to the hmac_secrets table at keyVersion=1 after the txn commits", async () => {
    const res = await POST(makeRequest("203.0.113.14"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subOrgId: string; hmacSecret: string };
    expect(mockInsertHmacSecret).toHaveBeenCalledTimes(1);
    const [subOrg, keyVersion, plaintext] =
      mockInsertHmacSecret.mock.calls[0] ?? [];
    expect(subOrg).toBe(body.subOrgId);
    expect(keyVersion).toBe(1);
    // The plaintext handed to the store must equal the one returned to the
    // caller — the return value is the only channel for the secret.
    expect(plaintext).toBe(body.hmacSecret);
  });

  it("rate-limits the 6th request from the same IP within the hour", async () => {
    const ip = "203.0.113.99";
    for (let i = 0; i < 5; i++) {
      const r = await POST(makeRequest(ip));
      expect(r.status).toBe(200);
    }
    const sixth = await POST(makeRequest(ip));
    expect(sixth.status).toBe(429);
    expect(sixth.headers.get("Retry-After")).toMatch(/^\d+$/);
    const body = (await sixth.json()) as { error: string; retryAfter: number };
    expect(body.error).toMatch(/rate limit/i);
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it("returns 502 TURNKEY_UPSTREAM with opaque message when Turnkey throws a typed error (HI-03)", async () => {
    // Simulate the shape of TurnkeyRequestError (error.name is the detector
    // in the provision route -- instanceof works for same-class but tests
    // mock the SDK; name-based fallback is the observable contract).
    const turnkeyErr = new Error(
      "Turnkey error 500: detailed upstream response body with secret-ish details"
    );
    turnkeyErr.name = "TurnkeyRequestError";
    mockCreateSubOrg.mockRejectedValueOnce(turnkeyErr);
    const r = await POST(makeRequest("203.0.113.20"));
    expect(r.status).toBe(502);
    const body = (await r.json()) as { code: string; error: string };
    expect(body.code).toBe("TURNKEY_UPSTREAM");
    // REVIEW HI-03: the raw upstream detail must not leak to unauthenticated
    // clients. The fixed opaque string is returned instead.
    expect(body.error).toBe("Upstream signer error");
    expect(body.error).not.toContain("detailed upstream response body");
  });

  it("returns 502 TURNKEY_UPSTREAM for Turnkey network/activity errors not matching a regex (HI-03)", async () => {
    // Previously, an error whose .message did not contain 'turnkey' or
    // 'sub-org' was misclassified as INTERNAL/500. With typed detection,
    // name='TurnkeyActivityError' is enough to trigger the 502 path.
    const activityErr = new Error("API request failed: network timeout");
    activityErr.name = "TurnkeyActivityError";
    mockCreateSubOrg.mockRejectedValueOnce(activityErr);
    const r = await POST(makeRequest("203.0.113.21"));
    expect(r.status).toBe(502);
    const body = (await r.json()) as { code: string; error: string };
    expect(body.code).toBe("TURNKEY_UPSTREAM");
    expect(body.error).toBe("Upstream signer error");
  });

  it("returns 500 INTERNAL with opaque message for untagged errors", async () => {
    mockCreateSubOrg.mockRejectedValueOnce(
      new Error("some secret-ish db path detail")
    );
    const r = await POST(makeRequest("203.0.113.22"));
    expect(r.status).toBe(500);
    const body = (await r.json()) as { code: string; error: string };
    expect(body.code).toBe("INTERNAL");
    expect(body.error).toBe("Provision failed");
    expect(body.error).not.toContain("secret-ish");
  });
});
