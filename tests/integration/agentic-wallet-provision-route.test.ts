/**
 * Integration tests for POST /api/agentic-wallet/provision.
 *
 * Coverage:
 *   - 200 happy-path response shape + ONBOARD-01 10s wall-clock SLO
 *   - Anonymous Turnkey sub-org flags (all 4 disable* true, no userEmail)
 *   - GUARD-06 baseline policies applied exactly 3 times
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
const { mockCreateSubOrg, mockCreatePolicy, mockDbInsert, mockDbValues } =
  vi.hoisted(() => {
    const createSubOrg = vi.fn();
    const createPolicy = vi.fn();
    const dbValues = vi.fn();
    const dbInsert = vi.fn(() => ({ values: dbValues }));
    return {
      mockCreateSubOrg: createSubOrg,
      mockCreatePolicy: createPolicy,
      mockDbInsert: dbInsert,
      mockDbValues: dbValues,
    };
  });

vi.mock("@turnkey/sdk-server", () => ({
  Turnkey: vi.fn(function TurnkeyMock(this: unknown): {
    apiClient: () => {
      createSubOrganization: typeof mockCreateSubOrg;
      createPolicy: typeof mockCreatePolicy;
    };
  } {
    return {
      apiClient: () => ({
        createSubOrganization: mockCreateSubOrg,
        createPolicy: mockCreatePolicy,
      }),
    };
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: mockDbInsert,
  },
}));

// Turnkey env must be set before route import (provisionAgenticWallet reads
// these at call time; getTurnkeyParentClient reads them at factory time).
process.env.TURNKEY_API_PUBLIC_KEY = "test-pub";
process.env.TURNKEY_API_PRIVATE_KEY = "test-priv";
process.env.TURNKEY_ORGANIZATION_ID = "org_test";

const { POST } = await import("@/app/api/agentic-wallet/provision/route");

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
    mockDbValues.mockReset();
    mockDbInsert.mockClear();
    mockDbValues.mockResolvedValue(undefined);
    mockCreateSubOrg.mockResolvedValue({
      subOrganizationId: "subOrg_test_123",
      wallet: { addresses: ["0xabc0000000000000000000000000000000dead01"] },
    });
    mockCreatePolicy.mockResolvedValue({});
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

  it("applies exactly 3 baseline Turnkey policies", async () => {
    await POST(makeRequest("203.0.113.12"));
    expect(mockCreatePolicy).toHaveBeenCalledTimes(3);
    const policyNames = mockCreatePolicy.mock.calls
      .map((c) => (c[0] as { policyName: string }).policyName)
      .sort();
    expect(policyNames).toEqual([
      "allowlist-outbound-contracts",
      "block-erc20-transfer-over-100usdc",
      "block-erc20-unlimited-approve",
    ]);
  });

  it("inserts rows into agentic_wallets and agentic_wallet_credits", async () => {
    await POST(makeRequest("203.0.113.13"));
    // provisionAgenticWallet() performs two independent inserts in parallel:
    // one into agentic_wallets (with hmac_secret), one into
    // agentic_wallet_credits via grantInitialCredit.
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

  it("returns 502 TURNKEY_UPSTREAM when Turnkey sub-org creation throws", async () => {
    mockCreateSubOrg.mockRejectedValueOnce(new Error("turnkey down"));
    const r = await POST(makeRequest("203.0.113.20"));
    expect(r.status).toBe(502);
    const body = (await r.json()) as { code: string; error: string };
    expect(body.code).toBe("TURNKEY_UPSTREAM");
  });
});
