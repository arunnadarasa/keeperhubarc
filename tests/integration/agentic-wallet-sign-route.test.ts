/**
 * Integration tests for POST /api/agentic-wallet/sign.
 *
 * The CRITICAL acceptance criterion for PAY-04 is the ecrecover round-trip:
 *
 *   1. Generate an ephemeral secp256k1 key with viem. This is ONLY a test
 *      fixture -- production signing keys stay inside Turnkey.
 *   2. Use that key to sign the canonical TransferWithAuthorization typed-data
 *      locally and split into {r, s, v}. Mock Turnkey signRawPayload to return
 *      those canonical r/s/v values (no 0x prefix, Turnkey-shape v as "00"/"01").
 *   3. Mock the agentic_wallets row so walletAddressBase equals the account's
 *      address. Mock lookupHmacSecret so HMAC verify passes.
 *   4. Build a valid HMAC-signed POST request, call the route handler, and
 *      assert:
 *        - recoverTypedDataAddress returns the wallet address (Assertion A).
 *        - extractPayerAddress from lib/x402/payment-gate.ts returns the
 *          wallet address after wrapping the signature in a canonical
 *          base64 PAYMENT-SIGNATURE header (Assertion B).
 *
 * Additional scenarios: HMAC-missing 401, unknown chain 400, Turnkey
 * CONSENSUS_NEEDED -> 403 POLICY_BLOCKED, risk=ask -> 202 approvalRequestId,
 * risk=block -> 403 RISK_BLOCKED.
 */
import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { extractPayerAddress } from "@/lib/x402/payment-gate";

const TEST_PRIVATE_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";
const TEST_HMAC_SECRET =
  "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
const account = privateKeyToAccount(TEST_PRIVATE_KEY);

const BASE_USDC_DOMAIN = {
  name: "USD Coin",
  version: "2",
  chainId: 8453,
  verifyingContract:
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`,
} as const;

// recoverTypedDataAddress only needs the non-domain types; omitting
// EIP712Domain here is intentional (viem derives it from the domain object).
const AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

type MockResolveLimit = ReturnType<typeof vi.fn>;
type MockSignRawPayload = ReturnType<typeof vi.fn>;
type MockLookupSecret = ReturnType<typeof vi.fn>;
type MockClassifyRisk = ReturnType<typeof vi.fn>;
type MockCreateApproval = ReturnType<typeof vi.fn>;
type MockVerifyWorkflowBinding = ReturnType<typeof vi.fn>;

const {
  mockSignRawPayload,
  mockLookupSecret,
  mockDbSelectLimit,
  mockClassifyRisk,
  mockCreateApprovalRequest,
  mockVerifyWorkflowBinding,
} = vi.hoisted(
  (): {
    mockSignRawPayload: MockSignRawPayload;
    mockLookupSecret: MockLookupSecret;
    mockDbSelectLimit: MockResolveLimit;
    mockClassifyRisk: MockClassifyRisk;
    mockCreateApprovalRequest: MockCreateApproval;
    mockVerifyWorkflowBinding: MockVerifyWorkflowBinding;
  } => ({
    mockSignRawPayload: vi.fn(),
    mockLookupSecret: vi.fn(),
    mockDbSelectLimit: vi.fn(),
    mockClassifyRisk: vi.fn(),
    mockCreateApprovalRequest: vi.fn(),
    mockVerifyWorkflowBinding: vi.fn(),
  })
);

vi.mock("@turnkey/sdk-server", () => ({
  // Named function expression so `new Turnkey(...)` is constructable under
  // vitest 4.x. Arrow fns lack [[Construct]] and throw "is not a constructor".
  Turnkey: vi.fn(function TurnkeyMock(this: unknown): {
    apiClient: () => { signRawPayload: typeof mockSignRawPayload };
  } {
    return {
      apiClient: (): { signRawPayload: typeof mockSignRawPayload } => ({
        signRawPayload: mockSignRawPayload,
      }),
    };
  }),
}));

vi.mock("@/lib/agentic-wallet/hmac-secret-store", () => ({
  lookupHmacSecret: mockLookupSecret,
}));

vi.mock("@/lib/agentic-wallet/risk", () => ({
  classifyRisk: mockClassifyRisk,
}));

vi.mock("@/lib/agentic-wallet/approval", () => ({
  createApprovalRequest: mockCreateApprovalRequest,
}));

vi.mock("@/lib/agentic-wallet/workflow-binding", () => ({
  verifyWorkflowBinding: mockVerifyWorkflowBinding,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: (): {
      from: () => { where: () => { limit: typeof mockDbSelectLimit } };
    } => ({
      from: () => ({
        where: () => ({
          limit: mockDbSelectLimit,
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/logging", () => ({
  ErrorCategory: {
    DATABASE: "database",
    EXTERNAL_SERVICE: "external_service",
  },
  logSystemError: vi.fn(),
}));

process.env.TURNKEY_API_PUBLIC_KEY = "test-pub";
process.env.TURNKEY_API_PRIVATE_KEY = "test-priv";
process.env.TURNKEY_ORGANIZATION_ID = "org_test";

const { POST } = await import("@/app/api/agentic-wallet/sign/route");

function buildHmacHeaders(
  subOrgId: string,
  method: string,
  path: string,
  body: string
): Record<string, string> {
  const ts = Math.floor(Date.now() / 1000).toString();
  const digest = createHash("sha256").update(body).digest("hex");
  // REVIEW HI-05: subOrgId is bound into the signed string.
  const sig = createHmac("sha256", TEST_HMAC_SECRET)
    .update(`${method}\n${path}\n${subOrgId}\n${digest}\n${ts}`)
    .digest("hex");
  return {
    "Content-Type": "application/json",
    "X-KH-Sub-Org": subOrgId,
    "X-KH-Timestamp": ts,
    "X-KH-Signature": sig,
  };
}

beforeEach(() => {
  mockSignRawPayload.mockReset();
  mockLookupSecret.mockReset();
  mockDbSelectLimit.mockReset();
  mockClassifyRisk.mockReset();
  mockCreateApprovalRequest.mockReset();
  mockVerifyWorkflowBinding.mockReset();

  mockLookupSecret.mockResolvedValue(TEST_HMAC_SECRET);
  mockClassifyRisk.mockReturnValue("auto");
  mockDbSelectLimit.mockResolvedValue([
    {
      walletAddressBase: account.address,
      walletAddressTempo: account.address,
    },
  ]);
  // Default to ok so existing tests stay green; binding-specific tests
  // override this per-case.
  mockVerifyWorkflowBinding.mockResolvedValue({
    ok: true,
    expectedPayTo: "0x0000000000000000000000000000000000000000",
    expectedAmountMicro: "0",
    workflowId: "wf_test",
  });
});

describe("POST /api/agentic-wallet/sign -- EIP-3009 ecrecover round-trip", () => {
  it("returns a signature that ecrecovers to the wallet address (PAY-04 acceptance)", async () => {
    const nowTs = Math.floor(Date.now() / 1000);
    const challenge = {
      payTo: "0xdeadbeef00000000000000000000000000000000",
      amount: "1000000", // 1 USDC (6 decimals)
      // REVIEW HI-01: tight window within the 600s cap enforced by /sign.
      validAfter: nowTs,
      validBefore: nowTs + 300,
      nonce: `0x${"11".repeat(32)}`,
    };
    const message = {
      from: account.address,
      to: challenge.payTo as `0x${string}`,
      value: BigInt(challenge.amount),
      validAfter: BigInt(challenge.validAfter),
      validBefore: BigInt(challenge.validBefore),
      nonce: challenge.nonce as `0x${string}`,
    };

    // Sign locally with the test private key -- this produces the exact
    // {r, s, v} Turnkey would return if it held this key.
    const canonicalSig = await account.signTypedData({
      domain: BASE_USDC_DOMAIN,
      types: AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message,
    });
    const r = canonicalSig.slice(2, 66);
    const s = canonicalSig.slice(66, 130);
    const vByte = Number.parseInt(canonicalSig.slice(130, 132), 16);
    // Turnkey returns v as "00" or "01"; serializeSignature adds +27. Reverse
    // that here so the mock hands the signer Turnkey-shape v.
    const v = (vByte >= 27 ? vByte - 27 : vByte)
      .toString(16)
      .padStart(2, "0");

    mockSignRawPayload.mockResolvedValue({
      activity: {
        status: "ACTIVITY_STATUS_COMPLETED",
        result: { signRawPayloadResult: { r, s, v } },
      },
    });

    const body = JSON.stringify({
      chain: "base",
      workflowSlug: "test-slug",
      paymentChallenge: challenge,
    });
    const path = "/api/agentic-wallet/sign";
    const res = await POST(
      new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers: buildHmacHeaders("subOrg_test", "POST", path, body),
        body,
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { signature: string };
    expect(json.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);

    // Assertion A: direct ecrecover via viem
    const recovered = await recoverTypedDataAddress({
      domain: BASE_USDC_DOMAIN,
      types: AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message,
      signature: json.signature as `0x${string}`,
    });
    expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());

    // Assertion B: extractPayerAddress round-trip via a canonical x402
    // PAYMENT-SIGNATURE header (base64 JSON).
    const paymentHeader = Buffer.from(
      JSON.stringify({
        payload: {
          authorization: {
            from: account.address,
            to: challenge.payTo,
            value: challenge.amount,
            validAfter: challenge.validAfter,
            validBefore: challenge.validBefore,
            nonce: challenge.nonce,
          },
          signature: json.signature,
        },
      })
    ).toString("base64");
    expect(extractPayerAddress(paymentHeader)).toBe(account.address);
  });

  it("returns 401 when HMAC headers are missing", async () => {
    const body = JSON.stringify({ chain: "base", paymentChallenge: {} });
    const res = await POST(
      new Request("http://localhost:3000/api/agentic-wallet/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for unknown chain", async () => {
    const body = JSON.stringify({ chain: "solana", paymentChallenge: {} });
    const path = "/api/agentic-wallet/sign";
    const res = await POST(
      new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers: buildHmacHeaders("subOrg_test", "POST", path, body),
        body,
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 POLICY_BLOCKED when Turnkey responds CONSENSUS_NEEDED", async () => {
    mockSignRawPayload.mockResolvedValue({
      activity: { status: "ACTIVITY_STATUS_CONSENSUS_NEEDED" },
    });
    const nowTs = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      chain: "base",
      workflowSlug: "test-slug",
      paymentChallenge: {
        payTo: "0x0000000000000000000000000000000000000000",
        amount: "1000000",
        validAfter: nowTs,
        validBefore: nowTs + 300,
        nonce: `0x${"00".repeat(32)}`,
      },
    });
    const path = "/api/agentic-wallet/sign";
    const res = await POST(
      new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers: buildHmacHeaders("subOrg_test", "POST", path, body),
        body,
      })
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("POLICY_BLOCKED");
  });

  it("returns 400 INVALID_VALIDITY_WINDOW when validBefore is too far in the future (HI-01)", async () => {
    const body = JSON.stringify({
      chain: "base",
      workflowSlug: "test-slug",
      paymentChallenge: {
        payTo: "0x0000000000000000000000000000000000000000",
        amount: "1000000",
        validAfter: 0,
        // 300 years in the future -- the original over-wide window.
        validBefore: 9_999_999_999,
        nonce: `0x${"00".repeat(32)}`,
      },
    });
    const path = "/api/agentic-wallet/sign";
    const res = await POST(
      new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers: buildHmacHeaders("subOrg_test", "POST", path, body),
        body,
      })
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("INVALID_VALIDITY_WINDOW");
    // Route MUST short-circuit before reaching Turnkey on validity failure.
    expect(mockSignRawPayload).not.toHaveBeenCalled();
  });

  it("returns 400 INVALID_VALIDITY_WINDOW when validAfter is not an integer (ME-01)", async () => {
    const nowTs = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      chain: "base",
      workflowSlug: "test-slug",
      paymentChallenge: {
        payTo: "0x0000000000000000000000000000000000000000",
        amount: "1000000",
        // NaN path: string "abc" is neither a number nor a non-negative int.
        validAfter: "abc",
        validBefore: nowTs + 300,
        nonce: `0x${"00".repeat(32)}`,
      },
    });
    const path = "/api/agentic-wallet/sign";
    const res = await POST(
      new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers: buildHmacHeaders("subOrg_test", "POST", path, body),
        body,
      })
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("INVALID_VALIDITY_WINDOW");
  });

  it("returns 202 approvalRequestId when risk=ask", async () => {
    mockClassifyRisk.mockReturnValue("ask");
    mockCreateApprovalRequest.mockResolvedValue({ id: "ar_test" });
    const nowTs = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      chain: "base",
      workflowSlug: "test-slug",
      paymentChallenge: {
        payTo: "0x0000000000000000000000000000000000000000",
        amount: "60000000", // 60 USDC -- ask tier
        validAfter: nowTs,
        validBefore: nowTs + 300,
        nonce: `0x${"00".repeat(32)}`,
      },
    });
    const path = "/api/agentic-wallet/sign";
    const res = await POST(
      new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers: buildHmacHeaders("subOrg_test", "POST", path, body),
        body,
      })
    );
    expect(res.status).toBe(202);
    const json = (await res.json()) as {
      approvalRequestId: string;
      status: string;
    };
    expect(json.approvalRequestId).toBe("ar_test");
    expect(json.status).toBe("pending");
    expect(mockCreateApprovalRequest).toHaveBeenCalledTimes(1);
  });

  it("returns 403 RISK_BLOCKED when risk=block", async () => {
    mockClassifyRisk.mockReturnValue("block");
    const nowTs = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      chain: "base",
      workflowSlug: "test-slug",
      paymentChallenge: {
        payTo: "0x0000000000000000000000000000000000000000",
        amount: "200000000", // 200 USDC -- block tier
        validAfter: nowTs,
        validBefore: nowTs + 300,
        nonce: `0x${"00".repeat(32)}`,
      },
    });
    const path = "/api/agentic-wallet/sign";
    const res = await POST(
      new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers: buildHmacHeaders("subOrg_test", "POST", path, body),
        body,
      })
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("RISK_BLOCKED");
    // Block branch short-circuits BEFORE Turnkey is reached.
    expect(mockSignRawPayload).not.toHaveBeenCalled();
  });
});

describe("POST /api/agentic-wallet/sign -- workflow-slug binding (Phase 37 fix #2)", () => {
  const REGISTRY_PAYTO = "0x1111111111111111111111111111111111111111";
  const REGISTRY_AMOUNT = "50000"; // 0.05 USDC in micros
  const ATTACKER_PAYTO = "0x2222222222222222222222222222222222222222";

  function buildBaseChallenge(opts?: {
    payTo?: string;
    amount?: string;
  }): Record<string, unknown> {
    const nowTs = Math.floor(Date.now() / 1000);
    return {
      payTo: opts?.payTo ?? REGISTRY_PAYTO,
      amount: opts?.amount ?? REGISTRY_AMOUNT,
      validAfter: nowTs,
      validBefore: nowTs + 300,
      nonce: `0x${"22".repeat(32)}`,
    };
  }

  it("rejects /sign without workflowSlug with 400 WORKFLOW_SLUG_REQUIRED", async () => {
    const body = JSON.stringify({
      chain: "base",
      paymentChallenge: buildBaseChallenge(),
    });
    const path = "/api/agentic-wallet/sign";
    const res = await POST(
      new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers: buildHmacHeaders("subOrg_test", "POST", path, body),
        body,
      })
    );
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("WORKFLOW_SLUG_REQUIRED");
    expect(mockVerifyWorkflowBinding).not.toHaveBeenCalled();
    expect(mockSignRawPayload).not.toHaveBeenCalled();
  });

  it("rejects /sign when payTo differs from workflow creator wallet (403 PAYTO_MISMATCH)", async () => {
    mockVerifyWorkflowBinding.mockResolvedValue({
      ok: false,
      status: 403,
      code: "PAYTO_MISMATCH",
      error: "payTo does not match workflow creator wallet",
    });
    const body = JSON.stringify({
      chain: "base",
      workflowSlug: "test-slug",
      paymentChallenge: buildBaseChallenge({ payTo: ATTACKER_PAYTO }),
    });
    const path = "/api/agentic-wallet/sign";
    const res = await POST(
      new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers: buildHmacHeaders("subOrg_test", "POST", path, body),
        body,
      })
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("PAYTO_MISMATCH");
    // Binding rejection short-circuits before Turnkey.
    expect(mockSignRawPayload).not.toHaveBeenCalled();
    // Binding check sees the attacker's payTo and the slug from the body.
    expect(mockVerifyWorkflowBinding).toHaveBeenCalledWith(
      "test-slug",
      ATTACKER_PAYTO,
      REGISTRY_AMOUNT
    );
  });

  it("rejects /sign when amount differs from priceUsdcPerCall (403 AMOUNT_MISMATCH)", async () => {
    mockVerifyWorkflowBinding.mockResolvedValue({
      ok: false,
      status: 403,
      code: "AMOUNT_MISMATCH",
      error: "amount does not match workflow priceUsdcPerCall",
    });
    const wrongAmount = "999999";
    const body = JSON.stringify({
      chain: "base",
      workflowSlug: "test-slug",
      paymentChallenge: buildBaseChallenge({ amount: wrongAmount }),
    });
    const path = "/api/agentic-wallet/sign";
    const res = await POST(
      new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers: buildHmacHeaders("subOrg_test", "POST", path, body),
        body,
      })
    );
    expect(res.status).toBe(403);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("AMOUNT_MISMATCH");
    expect(mockSignRawPayload).not.toHaveBeenCalled();
    expect(mockVerifyWorkflowBinding).toHaveBeenCalledWith(
      "test-slug",
      REGISTRY_PAYTO,
      wrongAmount
    );
  });

  it("accepts /sign when slug + payTo + amount all match registry (binding ok -> reaches signer)", async () => {
    // The binding check is the gate this test exercises — once it passes the
    // route hands off to Turnkey. We use a canonical signature locally so
    // serializeSignature succeeds and the route returns 200, mirroring the
    // PAY-04 round-trip fixture above.
    mockVerifyWorkflowBinding.mockResolvedValue({
      ok: true,
      expectedPayTo: account.address,
      expectedAmountMicro: REGISTRY_AMOUNT,
      workflowId: "wf_test",
    });

    const challenge = buildBaseChallenge({ payTo: account.address });
    const message = {
      from: account.address,
      to: challenge.payTo as `0x${string}`,
      value: BigInt(challenge.amount as string),
      validAfter: BigInt(challenge.validAfter as number),
      validBefore: BigInt(challenge.validBefore as number),
      nonce: challenge.nonce as `0x${string}`,
    };
    const canonicalSig = await account.signTypedData({
      domain: BASE_USDC_DOMAIN,
      types: AUTHORIZATION_TYPES,
      primaryType: "TransferWithAuthorization",
      message,
    });
    const r = canonicalSig.slice(2, 66);
    const s = canonicalSig.slice(66, 130);
    const vByte = Number.parseInt(canonicalSig.slice(130, 132), 16);
    const v = (vByte >= 27 ? vByte - 27 : vByte)
      .toString(16)
      .padStart(2, "0");
    mockSignRawPayload.mockResolvedValue({
      activity: {
        status: "ACTIVITY_STATUS_COMPLETED",
        result: { signRawPayloadResult: { r, s, v } },
      },
    });

    const body = JSON.stringify({
      chain: "base",
      workflowSlug: "test-slug",
      paymentChallenge: challenge,
    });
    const path = "/api/agentic-wallet/sign";
    const res = await POST(
      new Request(`http://localhost:3000${path}`, {
        method: "POST",
        headers: buildHmacHeaders("subOrg_test", "POST", path, body),
        body,
      })
    );
    expect(res.status).toBe(200);
    expect(mockVerifyWorkflowBinding).toHaveBeenCalledWith(
      "test-slug",
      account.address,
      REGISTRY_AMOUNT
    );
    expect(mockSignRawPayload).toHaveBeenCalledTimes(1);
  });
});
