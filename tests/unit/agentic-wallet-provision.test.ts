/**
 * Wave 0 RED scaffold for lib/agentic-wallet/provision.ts.
 *
 * Contract anchors:
 *   - 33-CONTEXT.md Resolution #1 (single EVM derivation path m/44'/60'/0'/0/0)
 *   - 33-RESEARCH.md Pattern 1 (lines 225-297) -- createSubOrganization shape
 *   - 33-RESEARCH.md Pattern 2 (3 x createPolicy, EFFECT_DENY, empty consensus)
 *
 * Baseline: every case throws because provisionAgenticWallet is a stub.
 * Plan 33-01b flips this suite GREEN.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateSubOrg,
  mockCreatePolicy,
  mockGetPolicies,
  mockDeletePolicy,
  mockInsertAgenticWallets,
  mockInsertCredits,
  mockInsertValues,
  mockInsertReturning,
} = vi.hoisted(() => {
  const insertValues = vi.fn();
  const insertReturning = vi.fn();
  const createSubOrg = vi.fn();
  const createPolicy = vi.fn();
  const getPolicies = vi.fn();
  const deletePolicy = vi.fn();
  const insertAgenticWallets = vi.fn();
  const insertCredits = vi.fn();
  return {
    mockCreateSubOrg: createSubOrg,
    mockCreatePolicy: createPolicy,
    mockGetPolicies: getPolicies,
    mockDeletePolicy: deletePolicy,
    mockInsertAgenticWallets: insertAgenticWallets,
    mockInsertCredits: insertCredits,
    mockInsertValues: insertValues,
    mockInsertReturning: insertReturning,
  };
});

// Use a function expression (not arrow) so `new Turnkey(...)` inside
// lib/turnkey/agentic-wallet.ts treats the mock as a constructor. vitest 4
// does not auto-wrap arrow-function mock implementations with [[Construct]].
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
}));

// Route DB inserts through table-keyed dispatchers so tests can assert on which
// table received what payload. The stub helper imports `db` from "@/lib/db".
type DbInsertTarget = { _tableName?: string };

vi.mock("@/lib/db", () => ({
  db: {
    insert: (table: DbInsertTarget): unknown => {
      const name = table?._tableName ?? "unknown";
      const inserter =
        name === "agentic_wallets"
          ? mockInsertAgenticWallets
          : mockInsertCredits;
      return {
        values: (payload: unknown): unknown => {
          inserter(payload);
          mockInsertValues(name, payload);
          return {
            returning: mockInsertReturning,
          };
        },
      };
    },
  },
}));

vi.mock("@/lib/db/schema", () => ({
  agenticWallets: { _tableName: "agentic_wallets" },
  agenticWalletCredits: { _tableName: "agentic_wallet_credits" },
}));

const { provisionAgenticWallet } = await import(
  "@/lib/agentic-wallet/provision"
);

const MOCK_SUB_ORG_ID = "subOrg_123";
const MOCK_WALLET_ADDRESS = "0xabc000000000000000000000000000000000dead";
const EVM_PATH = "m/44'/60'/0'/0/0";

describe("provisionAgenticWallet", () => {
  beforeEach(() => {
    process.env.TURNKEY_API_PUBLIC_KEY = "test-pub";
    process.env.TURNKEY_API_PRIVATE_KEY = "test-priv";
    process.env.TURNKEY_ORGANIZATION_ID = "org_test";
    mockCreateSubOrg.mockReset();
    mockCreatePolicy.mockReset();
    mockGetPolicies.mockReset();
    mockDeletePolicy.mockReset();
    mockInsertAgenticWallets.mockReset();
    mockInsertCredits.mockReset();
    mockInsertValues.mockReset();
    mockInsertReturning.mockReset();

    mockCreateSubOrg.mockResolvedValue({
      subOrganizationId: MOCK_SUB_ORG_ID,
      wallet: {
        walletId: "wallet_123",
        addresses: [MOCK_WALLET_ADDRESS],
      },
    });
    // REVIEW HI-04: createPolicy returns a policyId; getPolicies supplies
    // the post-condition list with all 3 baseline policy names.
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
    mockGetPolicies.mockResolvedValue({
      policies: [
        { policyName: "block-erc20-unlimited-approve", effect: "EFFECT_DENY" },
        {
          policyName: "block-erc20-transfer-over-100usdc",
          effect: "EFFECT_DENY",
        },
        { policyName: "allowlist-outbound-contracts", effect: "EFFECT_DENY" },
      ],
    });
    mockDeletePolicy.mockResolvedValue({});
    mockInsertReturning.mockResolvedValue([{ id: "wallet-row-id" }]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("calls createSubOrganization exactly once with the anonymous-operator shape", async () => {
    await provisionAgenticWallet();
    expect(mockCreateSubOrg).toHaveBeenCalledTimes(1);
    const args = mockCreateSubOrg.mock.calls[0]?.[0];
    expect(args.rootQuorumThreshold).toBe(1);
    expect(args.rootUsers?.[0]?.userName).toBe("keeperhub-operator");
    expect(args.rootUsers?.[0]?.userEmail).toBeUndefined();
    expect(args.disableEmailAuth).toBe(true);
    expect(args.disableEmailRecovery).toBe(true);
    expect(args.disableSmsAuth).toBe(true);
    expect(args.disableOtpEmailAuth).toBe(true);
  });

  it("uses the single EVM derivation path m/44'/60'/0'/0/0 (CONTEXT Resolution #1)", async () => {
    await provisionAgenticWallet();
    const args = mockCreateSubOrg.mock.calls[0]?.[0];
    expect(args.wallet?.accounts?.[0]?.path).toBe(EVM_PATH);
    expect(args.wallet?.accounts?.[0]?.addressFormat).toBe(
      "ADDRESS_FORMAT_ETHEREUM"
    );
  });

  it("applies exactly 3 baseline policies, each EFFECT_DENY with empty consensus", async () => {
    await provisionAgenticWallet();
    expect(mockCreatePolicy).toHaveBeenCalledTimes(3);
    for (const call of mockCreatePolicy.mock.calls) {
      const arg = call[0];
      expect(arg.organizationId).toBe(MOCK_SUB_ORG_ID);
      expect(arg.effect).toBe("EFFECT_DENY");
      expect(arg.consensus ?? "").toBe("");
    }
  });

  it("inserts an agentic_wallets row with subOrgId, both addresses, and a 64-char hmac_secret", async () => {
    await provisionAgenticWallet();
    expect(mockInsertAgenticWallets).toHaveBeenCalledTimes(1);
    const payload = mockInsertAgenticWallets.mock.calls[0]?.[0];
    expect(payload.subOrgId).toBe(MOCK_SUB_ORG_ID);
    // Per CONTEXT Resolution #1 the single EVM address is mirrored onto
    // both Base and Tempo columns. Both must equal MOCK_WALLET_ADDRESS.
    expect(payload.walletAddressBase).toBe(MOCK_WALLET_ADDRESS);
    expect(payload.walletAddressTempo).toBe(MOCK_WALLET_ADDRESS);
    expect(typeof payload.hmacSecret).toBe("string");
    expect(payload.hmacSecret.length).toBe(64);
    expect(payload.hmacSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("inserts an agentic_wallet_credits row for 50 USDC cents ($0.50 seed credit)", async () => {
    await provisionAgenticWallet();
    expect(mockInsertCredits).toHaveBeenCalledTimes(1);
    const payload = mockInsertCredits.mock.calls[0]?.[0];
    expect(payload.subOrgId).toBe(MOCK_SUB_ORG_ID);
    expect(payload.amountUsdcCents).toBe(50);
  });

  it("returns { subOrgId, walletAddress, hmacSecret } on success (single walletAddress per CONTEXT Resolution #1)", async () => {
    const result = await provisionAgenticWallet();
    expect(result.subOrgId).toBe(MOCK_SUB_ORG_ID);
    expect(result.walletAddress).toBe(MOCK_WALLET_ADDRESS);
    expect(typeof result.hmacSecret).toBe("string");
    expect(result.hmacSecret.length).toBe(64);
  });

  it("re-throws when createSubOrganization fails and does not write to agentic_wallets", async () => {
    mockCreateSubOrg.mockRejectedValueOnce(new Error("TURNKEY_UPSTREAM: 5xx"));
    await expect(provisionAgenticWallet()).rejects.toThrow("TURNKEY_UPSTREAM");
    expect(mockInsertAgenticWallets).not.toHaveBeenCalled();
  });

  it("re-throws when the first createPolicy fails", async () => {
    mockCreatePolicy.mockRejectedValueOnce(new Error("policy: bad DSL"));
    await expect(provisionAgenticWallet()).rejects.toThrow();
  });
});
