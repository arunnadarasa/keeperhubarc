/**
 * Integration tests for the full wallet approval-request lifecycle across
 * four routes:
 *
 *   - POST /api/agentic-wallet/approval-request         (HMAC)
 *   - GET  /api/agentic-wallet/approval-request/[id]    (HMAC)
 *   - POST /api/agentic-wallet/[id]/approve             (session)
 *   - POST /api/agentic-wallet/[id]/reject              (session)
 *
 * Strategy (PLAN Task 5): mock @/lib/agentic-wallet/approval directly with an
 * in-memory Map rather than stubbing the drizzle chain. This keeps the test
 * focused on the HTTP-level contract and the session-vs-HMAC auth split.
 *
 * Scenarios (8 total, >=7 required by plan):
 *   1. HMAC POST /approval-request with 'ask' -> 201 {id}, then HMAC GET
 *      returns {status:'pending'}.
 *   2. Session POST /[id]/approve transitions to approved; subsequent HMAC
 *      GET returns {status:'approved', resolvedByUserId}.
 *   3. A second POST /[id]/approve returns 409 {error:'Already resolved'}.
 *   4. A different owner (different session) approving someone else's
 *      request returns 403.
 *   5. Unauthenticated POST /[id]/approve returns 401.
 *   6. POST /approval-request with riskLevel:'auto' returns 400.
 *   7. GET /approval-request/[id] with HMAC for a different sub-org returns
 *      404 (no existence leak, T-33-06b).
 *   8. Session POST /[id]/reject transitions a pending row to rejected.
 */
import { createHash, createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks. The approval-store Map survives across a single test file
// run but is reset between `it` blocks via beforeEach.
// ---------------------------------------------------------------------------

type ApprovalRow = {
  id: string;
  subOrgId: string;
  riskLevel: "ask" | "block";
  operationPayload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "expired";
  createdAt: Date;
  // Phase 37 fix B2: hard TTL. Seeded rows default to 15 minutes ahead so
  // the existing happy-path tests never trip the expiry branch.
  expiresAt: Date;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  boundRecipient: string;
  boundAmountMicro: string;
  boundChain: string;
  boundContract: string;
};

// Phase 37 fix B1: canonical binding fixture used by the seed helpers below.
// The USDC Base address mirrors lib/agentic-wallet/constants.ts so direct
// seed inserts match what the /approval-request route would write.
const BOUND_RECIPIENT_FIXTURE = "0x1111111111111111111111111111111111111111";
const BOUND_AMOUNT_FIXTURE = "50000000";
const BOUND_CONTRACT_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function bindingFixture(): {
  recipient: string;
  amountMicro: string;
  chain: string;
  contract: string;
} {
  return {
    recipient: BOUND_RECIPIENT_FIXTURE,
    amountMicro: BOUND_AMOUNT_FIXTURE,
    chain: "base",
    contract: BOUND_CONTRACT_BASE,
  };
}

function baseOperationPayload(): Record<string, unknown> {
  return {
    chain: "base",
    paymentChallenge: {
      payTo: BOUND_RECIPIENT_FIXTURE,
      amount: BOUND_AMOUNT_FIXTURE,
    },
  };
}

const HMAC_SECRET = "a".repeat(64); // 64 hex chars -- matches the provision output shape
const OTHER_HMAC_SECRET = "b".repeat(64);

const {
  approvalStore,
  mockGetSession,
  mockLookupHmacSecret,
  mockDbSelectLimit,
  mockCreateApprovalRequest,
  mockGetApprovalRequest,
  mockResolveApprovalRequest,
  mockCheckApprovalForResolve,
} = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    approvalStore: store,
    mockGetSession: vi.fn(),
    mockLookupHmacSecret: vi.fn(),
    mockDbSelectLimit: vi.fn(),
    mockCreateApprovalRequest: vi.fn(),
    mockGetApprovalRequest: vi.fn(),
    mockResolveApprovalRequest: vi.fn(),
    mockCheckApprovalForResolve: vi.fn(),
  };
});

// deriveApprovalBinding is a pure helper -- re-export the real implementation
// so routes that import it alongside the mocked DB helpers still get the
// production derivation rules.
vi.mock("@/lib/agentic-wallet/approval", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/agentic-wallet/approval")>();
  return {
    ...actual,
    createApprovalRequest: mockCreateApprovalRequest,
    getApprovalRequest: mockGetApprovalRequest,
    resolveApprovalRequest: mockResolveApprovalRequest,
    checkApprovalForResolve: mockCheckApprovalForResolve,
  };
});

vi.mock("@/lib/agentic-wallet/hmac-secret-store", () => ({
  lookupHmacSecret: mockLookupHmacSecret,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
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

vi.mock("@/lib/db/schema", () => ({
  agenticWallets: {
    subOrgId: "sub_org_id",
    linkedUserId: "linked_user_id",
  },
  walletApprovalRequests: {
    id: "id",
    subOrgId: "sub_org_id",
    status: "status",
  },
}));

vi.mock("@/lib/logging", () => ({
  ErrorCategory: { DATABASE: "DATABASE" },
  logSystemError: vi.fn(),
}));

const { POST: postApprovalRequest } = await import(
  "@/app/api/agentic-wallet/approval-request/route"
);
const { GET: getApprovalRequestRoute } = await import(
  "@/app/api/agentic-wallet/approval-request/[id]/route"
);
const { POST: postApprove } = await import(
  "@/app/api/agentic-wallet/[id]/approve/route"
);
const { POST: postReject } = await import(
  "@/app/api/agentic-wallet/[id]/reject/route"
);

// ---------------------------------------------------------------------------
// HMAC helper: matches the signing string shape in lib/agentic-wallet/hmac.ts
//   sig = hex(hmac_sha256(secret, `${method}\n${path}\n${sha256_hex(body)}\n${ts}`))
// ---------------------------------------------------------------------------

function buildHmacHeaders(
  secret: string,
  method: string,
  path: string,
  body: string,
  subOrgId: string
): Record<string, string> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyDigest = createHash("sha256").update(body).digest("hex");
  // REVIEW HI-05: subOrgId is bound into the signed string.
  const signingString = `${method}\n${path}\n${subOrgId}\n${bodyDigest}\n${timestamp}`;
  const signature = createHmac("sha256", secret)
    .update(signingString)
    .digest("hex");
  return {
    "X-KH-Sub-Org": subOrgId,
    "X-KH-Timestamp": timestamp,
    "X-KH-Signature": signature,
    "Content-Type": "application/json",
  };
}

function makeHmacRequest(
  method: "GET" | "POST",
  path: string,
  body: string,
  subOrgId: string,
  secret: string
): Request {
  const url = `http://localhost:3000${path}`;
  const headers = buildHmacHeaders(secret, method, path, body, subOrgId);
  const init: RequestInit = { method, headers };
  if (method === "POST") {
    init.body = body;
  }
  return new Request(url, init);
}

function makeSessionRequest(path: string): Request {
  return new Request(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

function paramCtx(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

// ---------------------------------------------------------------------------
// In-memory approval store wiring. Each `it` starts with a fresh store.
// ---------------------------------------------------------------------------

function wireApprovalStore(): void {
  approvalStore.clear();

  mockCreateApprovalRequest.mockImplementation(
    async (args: {
      subOrgId: string;
      riskLevel: "ask" | "block";
      operationPayload: Record<string, unknown>;
      binding: {
        recipient: string;
        amountMicro: string;
        chain: string;
        contract: string;
      };
    }) => {
      if ((args.riskLevel as string) === "auto") {
        throw new Error("createApprovalRequest: riskLevel 'auto' rejected");
      }
      const id = `ar_${approvalStore.size + 1}`;
      const row: ApprovalRow = {
        id,
        subOrgId: args.subOrgId,
        riskLevel: args.riskLevel,
        operationPayload: args.operationPayload,
        status: "pending",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        resolvedAt: null,
        resolvedByUserId: null,
        boundRecipient: args.binding.recipient,
        boundAmountMicro: args.binding.amountMicro,
        boundChain: args.binding.chain,
        boundContract: args.binding.contract,
      };
      approvalStore.set(id, row);
      return { id };
    }
  );

  mockGetApprovalRequest.mockImplementation(async (id: string) => {
    return (approvalStore.get(id) as ApprovalRow | undefined) ?? null;
  });

  mockResolveApprovalRequest.mockImplementation(
    async (id: string, userId: string, decision: "approved" | "rejected") => {
      const row = approvalStore.get(id) as ApprovalRow | undefined;
      if (!row || row.status !== "pending") {
        return null;
      }
      row.status = decision;
      row.resolvedAt = new Date();
      row.resolvedByUserId = userId;
      approvalStore.set(id, row);
      return row;
    }
  );

  // Phase 37 fix B2: mirror the real checkApprovalForResolve lifecycle gate
  // so route handlers see the same not-found / already-resolved / expired /
  // binding-mismatch outcomes the production helper produces.
  mockCheckApprovalForResolve.mockImplementation(async (id: string) => {
    const row = approvalStore.get(id) as ApprovalRow | undefined;
    if (!row) {
      return { ok: false, reason: "not-found" };
    }
    if (row.status !== "pending") {
      return { ok: false, reason: "already-resolved" };
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      row.status = "expired";
      row.resolvedAt = new Date();
      approvalStore.set(id, row);
      return { ok: false, reason: "expired" };
    }
    // Re-derive binding from the current operationPayload.
    const op = row.operationPayload as {
      chain?: unknown;
      paymentChallenge?: {
        payTo?: unknown;
        recipient?: unknown;
        amount?: unknown;
      };
    };
    const challenge = op.paymentChallenge;
    const currentRecipient =
      op.chain === "base"
        ? String(challenge?.payTo ?? "")
        : String(challenge?.payTo ?? challenge?.recipient ?? "");
    const currentAmount = String(challenge?.amount ?? "");
    const currentChain = String(op.chain ?? "");
    if (
      currentRecipient !== row.boundRecipient ||
      currentAmount !== row.boundAmountMicro ||
      currentChain !== row.boundChain
    ) {
      return { ok: false, reason: "binding-mismatch" };
    }
    return { ok: true, row };
  });
}

const SUB_ORG = "subOrg_test_abc";
const OTHER_SUB_ORG = "subOrg_other_xyz";
const OWNER_USER_ID = "user_owner_1";
const ATTACKER_USER_ID = "user_attacker_2";

describe("agentic-wallet approval-request lifecycle", () => {
  beforeEach(() => {
    wireApprovalStore();
    mockGetSession.mockReset();
    mockLookupHmacSecret.mockReset();
    mockDbSelectLimit.mockReset();
    // Default secret resolver: SUB_ORG -> HMAC_SECRET, OTHER_SUB_ORG -> OTHER_HMAC_SECRET.
    mockLookupHmacSecret.mockImplementation(async (subOrgId: string) => {
      if (subOrgId === SUB_ORG) {
        return HMAC_SECRET;
      }
      if (subOrgId === OTHER_SUB_ORG) {
        return OTHER_HMAC_SECRET;
      }
      return null;
    });
    // Default ownership: SUB_ORG is owned by OWNER_USER_ID.
    mockDbSelectLimit.mockResolvedValue([{ linkedUserId: OWNER_USER_ID }]);
  });

  it("create (HMAC) -> poll (HMAC) returns pending -> approve (session) -> poll returns approved", async () => {
    const operationPayload = baseOperationPayload();
    const body = JSON.stringify({
      riskLevel: "ask",
      operationPayload,
    });
    const createReq = makeHmacRequest(
      "POST",
      "/api/agentic-wallet/approval-request",
      body,
      SUB_ORG,
      HMAC_SECRET
    );
    const createRes = await postApprovalRequest(createReq);
    expect(createRes.status).toBe(201);
    const createBody = (await createRes.json()) as { id: string };
    expect(createBody.id).toMatch(/^ar_/);
    const { id } = createBody;

    // Poll pending via HMAC.
    const pollReq1 = makeHmacRequest(
      "GET",
      `/api/agentic-wallet/approval-request/${id}`,
      "",
      SUB_ORG,
      HMAC_SECRET
    );
    const pollRes1 = await getApprovalRequestRoute(pollReq1, paramCtx(id));
    expect(pollRes1.status).toBe(200);
    const pollBody1 = (await pollRes1.json()) as {
      status: string;
      riskLevel: string;
      operationPayload: Record<string, unknown>;
    };
    expect(pollBody1.status).toBe("pending");
    expect(pollBody1.riskLevel).toBe("ask");
    expect(pollBody1.operationPayload).toEqual(operationPayload);

    // Approve via session.
    mockGetSession.mockResolvedValue({
      user: { id: OWNER_USER_ID, email: "owner@test" },
    });
    const approveRes = await postApprove(
      makeSessionRequest(`/api/agentic-wallet/${id}/approve`),
      paramCtx(id)
    );
    expect(approveRes.status).toBe(200);
    const approveBody = (await approveRes.json()) as {
      ok: boolean;
      status: string;
    };
    expect(approveBody.ok).toBe(true);
    expect(approveBody.status).toBe("approved");

    // Poll again via HMAC -> status approved, resolvedByUserId set.
    const pollReq2 = makeHmacRequest(
      "GET",
      `/api/agentic-wallet/approval-request/${id}`,
      "",
      SUB_ORG,
      HMAC_SECRET
    );
    const pollRes2 = await getApprovalRequestRoute(pollReq2, paramCtx(id));
    expect(pollRes2.status).toBe(200);
    const pollBody2 = (await pollRes2.json()) as {
      status: string;
      resolvedByUserId: string | null;
    };
    expect(pollBody2.status).toBe("approved");
    expect(pollBody2.resolvedByUserId).toBe(OWNER_USER_ID);
  });

  it("second approve on the same id returns 409 Already resolved", async () => {
    // Seed: one pending row for SUB_ORG. Binding must agree with the payload
    // so Task 13's checkApprovalForResolve re-derivation does not flag the
    // row as binding-mismatch.
    const { id } = await mockCreateApprovalRequest({
      subOrgId: SUB_ORG,
      riskLevel: "ask",
      operationPayload: baseOperationPayload(),
      binding: bindingFixture(),
    });

    mockGetSession.mockResolvedValue({
      user: { id: OWNER_USER_ID, email: "owner@test" },
    });
    const first = await postApprove(
      makeSessionRequest(`/api/agentic-wallet/${id}/approve`),
      paramCtx(id)
    );
    expect(first.status).toBe(200);

    // Second call -- mock session for a fresh request.
    mockGetSession.mockResolvedValue({
      user: { id: OWNER_USER_ID, email: "owner@test" },
    });
    const second = await postApprove(
      makeSessionRequest(`/api/agentic-wallet/${id}/approve`),
      paramCtx(id)
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: string };
    expect(body.error).toBe("Already resolved");
  });

  it("approve by a non-owner user returns 403 Forbidden", async () => {
    const { id } = await mockCreateApprovalRequest({
      subOrgId: SUB_ORG,
      riskLevel: "ask",
      operationPayload: baseOperationPayload(),
      binding: bindingFixture(),
    });
    // Ownership table says the wallet belongs to OWNER_USER_ID; the attacker
    // will not match.
    mockDbSelectLimit.mockResolvedValue([{ linkedUserId: OWNER_USER_ID }]);

    mockGetSession.mockResolvedValue({
      user: { id: ATTACKER_USER_ID, email: "attacker@test" },
    });
    const res = await postApprove(
      makeSessionRequest(`/api/agentic-wallet/${id}/approve`),
      paramCtx(id)
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Forbidden");
  });

  it("unauthenticated approve returns 401", async () => {
    const { id } = await mockCreateApprovalRequest({
      subOrgId: SUB_ORG,
      riskLevel: "ask",
      operationPayload: baseOperationPayload(),
      binding: bindingFixture(),
    });
    mockGetSession.mockResolvedValue(null);
    const res = await postApprove(
      makeSessionRequest(`/api/agentic-wallet/${id}/approve`),
      paramCtx(id)
    );
    expect(res.status).toBe(401);
  });

  it("POST /approval-request with riskLevel='auto' returns 400", async () => {
    // Clear seed-driven call history so the assertion only measures the
    // route handler's behaviour for this scenario.
    mockCreateApprovalRequest.mockClear();
    const body = JSON.stringify({
      riskLevel: "auto",
      operationPayload: { foo: "bar" },
    });
    const req = makeHmacRequest(
      "POST",
      "/api/agentic-wallet/approval-request",
      body,
      SUB_ORG,
      HMAC_SECRET
    );
    const res = await postApprovalRequest(req);
    expect(res.status).toBe(400);
    expect(mockCreateApprovalRequest).not.toHaveBeenCalled();
  });

  it("GET /approval-request/[id] with HMAC for a DIFFERENT sub-org returns 404", async () => {
    // Create the row under SUB_ORG.
    const { id } = await mockCreateApprovalRequest({
      subOrgId: SUB_ORG,
      riskLevel: "ask",
      operationPayload: { k: "v" },
      binding: bindingFixture(),
    });
    // Caller signs with OTHER_SUB_ORG's secret -- valid HMAC, but for the
    // wrong sub-org. Must 404 (not 403) so the caller cannot learn the row
    // exists.
    const req = makeHmacRequest(
      "GET",
      `/api/agentic-wallet/approval-request/${id}`,
      "",
      OTHER_SUB_ORG,
      OTHER_HMAC_SECRET
    );
    const res = await getApprovalRequestRoute(req, paramCtx(id));
    expect(res.status).toBe(404);
  });

  it("reject (session) transitions a pending row to 'rejected'", async () => {
    const { id } = await mockCreateApprovalRequest({
      subOrgId: SUB_ORG,
      riskLevel: "ask",
      operationPayload: baseOperationPayload(),
      binding: bindingFixture(),
    });
    mockGetSession.mockResolvedValue({
      user: { id: OWNER_USER_ID, email: "owner@test" },
    });
    const res = await postReject(
      makeSessionRequest(`/api/agentic-wallet/${id}/reject`),
      paramCtx(id)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; status: string };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("rejected");

    // Confirm state transition via HMAC poll.
    const pollReq = makeHmacRequest(
      "GET",
      `/api/agentic-wallet/approval-request/${id}`,
      "",
      SUB_ORG,
      HMAC_SECRET
    );
    const pollRes = await getApprovalRequestRoute(pollReq, paramCtx(id));
    const pollBody = (await pollRes.json()) as { status: string };
    expect(pollBody.status).toBe("rejected");
  });

  it("approve against an unknown id returns 404", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: OWNER_USER_ID, email: "owner@test" },
    });
    const res = await postApprove(
      makeSessionRequest("/api/agentic-wallet/ar_nonexistent/approve"),
      paramCtx("ar_nonexistent")
    );
    expect(res.status).toBe(404);
  });

  it("rejects approval-request without bound recipient/amount/chain/contract (Phase 37 fix B1)", async () => {
    mockCreateApprovalRequest.mockClear();
    // operationPayload has chain + paymentChallenge but the challenge is
    // missing payTo AND amount. Route must 422 BINDING_REQUIRED without
    // inserting the row.
    const body = JSON.stringify({
      riskLevel: "ask",
      operationPayload: { chain: "base", paymentChallenge: {} },
    });
    const req = makeHmacRequest(
      "POST",
      "/api/agentic-wallet/approval-request",
      body,
      SUB_ORG,
      HMAC_SECRET
    );
    const res = await postApprovalRequest(req);
    expect(res.status).toBe(422);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("BINDING_REQUIRED");
    expect(mockCreateApprovalRequest).not.toHaveBeenCalled();
  });

  it("rejects approval-request with operationPayload missing chain (Phase 37 fix B1)", async () => {
    mockCreateApprovalRequest.mockClear();
    const body = JSON.stringify({
      riskLevel: "ask",
      operationPayload: {
        paymentChallenge: {
          payTo: BOUND_RECIPIENT_FIXTURE,
          amount: BOUND_AMOUNT_FIXTURE,
        },
      },
    });
    const req = makeHmacRequest(
      "POST",
      "/api/agentic-wallet/approval-request",
      body,
      SUB_ORG,
      HMAC_SECRET
    );
    const res = await postApprovalRequest(req);
    expect(res.status).toBe(422);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("BINDING_REQUIRED");
    expect(mockCreateApprovalRequest).not.toHaveBeenCalled();
  });

  it("rejects approval-request with payload larger than 8 KiB (Phase 37 fix B3)", async () => {
    mockCreateApprovalRequest.mockClear();
    const bigString = "x".repeat(9 * 1024);
    const body = JSON.stringify({
      riskLevel: "ask",
      operationPayload: {
        chain: "base",
        paymentChallenge: {
          payTo: BOUND_RECIPIENT_FIXTURE,
          amount: BOUND_AMOUNT_FIXTURE,
          note: bigString,
        },
      },
    });
    const req = makeHmacRequest(
      "POST",
      "/api/agentic-wallet/approval-request",
      body,
      SUB_ORG,
      HMAC_SECRET
    );
    const res = await postApprovalRequest(req);
    expect(res.status).toBe(413);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("PAYLOAD_TOO_LARGE");
    expect(mockCreateApprovalRequest).not.toHaveBeenCalled();
  });

  it("accepts tempo approval-request that binds via paymentChallenge.recipient (Phase 37 fix B1)", async () => {
    // The tempo (MPP) challenge shape uses `recipient` instead of `payTo`.
    // deriveApprovalBinding must recognise both so that /sign, /approval-
    // request, and the /approve re-derivation agree on the same wallet.
    mockCreateApprovalRequest.mockClear();
    const TEMPO_RECIPIENT = "0x1111111111111111111111111111111111111111";
    const body = JSON.stringify({
      riskLevel: "ask",
      operationPayload: {
        chain: "tempo",
        paymentChallenge: {
          recipient: TEMPO_RECIPIENT,
          amount: BOUND_AMOUNT_FIXTURE,
        },
      },
    });
    const req = makeHmacRequest(
      "POST",
      "/api/agentic-wallet/approval-request",
      body,
      SUB_ORG,
      HMAC_SECRET
    );
    const res = await postApprovalRequest(req);
    expect(res.status).toBe(201);
    expect(mockCreateApprovalRequest).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateApprovalRequest.mock.calls[0]?.[0] as {
      binding: {
        recipient: string;
        amountMicro: string;
        chain: string;
        contract: string;
      };
    };
    expect(callArgs.binding.recipient).toBe(TEMPO_RECIPIENT);
    expect(callArgs.binding.chain).toBe("tempo");
  });

  it("rejects tempo approval-request when both payTo and recipient are missing (Phase 37 fix B1)", async () => {
    mockCreateApprovalRequest.mockClear();
    const body = JSON.stringify({
      riskLevel: "ask",
      operationPayload: {
        chain: "tempo",
        paymentChallenge: { amount: BOUND_AMOUNT_FIXTURE },
      },
    });
    const req = makeHmacRequest(
      "POST",
      "/api/agentic-wallet/approval-request",
      body,
      SUB_ORG,
      HMAC_SECRET
    );
    const res = await postApprovalRequest(req);
    expect(res.status).toBe(422);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("BINDING_REQUIRED");
    expect(mockCreateApprovalRequest).not.toHaveBeenCalled();
  });

  it("rejects approval-request with capitalised chain 'Base' as BINDING_REQUIRED (Phase 37 fix B1)", async () => {
    // deriveApprovalBinding matches chain case-sensitively; an input of "Base"
    // (instead of "base") must fail binding derivation. Documents the
    // intentional case-sensitivity of chain matching across the module.
    mockCreateApprovalRequest.mockClear();
    const body = JSON.stringify({
      riskLevel: "ask",
      operationPayload: {
        chain: "Base",
        paymentChallenge: {
          payTo: BOUND_RECIPIENT_FIXTURE,
          amount: BOUND_AMOUNT_FIXTURE,
        },
      },
    });
    const req = makeHmacRequest(
      "POST",
      "/api/agentic-wallet/approval-request",
      body,
      SUB_ORG,
      HMAC_SECRET
    );
    const res = await postApprovalRequest(req);
    expect(res.status).toBe(422);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("BINDING_REQUIRED");
    expect(mockCreateApprovalRequest).not.toHaveBeenCalled();
  });

  it("rejects approval-request when amount is an empty string (Phase 37 fix B1 amount-bypass)", async () => {
    // Before the deriveApprovalBinding helper, amount="" slipped through the
    // `String(... ?? "0") === "0"` guard because "" is not nullish and
    // "" !== "0". The helper now rejects any non-digit or zero amount.
    mockCreateApprovalRequest.mockClear();
    const body = JSON.stringify({
      riskLevel: "ask",
      operationPayload: {
        chain: "base",
        paymentChallenge: { payTo: BOUND_RECIPIENT_FIXTURE, amount: "" },
      },
    });
    const req = makeHmacRequest(
      "POST",
      "/api/agentic-wallet/approval-request",
      body,
      SUB_ORG,
      HMAC_SECRET
    );
    const res = await postApprovalRequest(req);
    expect(res.status).toBe(422);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("BINDING_REQUIRED");
    expect(mockCreateApprovalRequest).not.toHaveBeenCalled();
  });

  it("rejects approval-request when amount is a negative decimal string (Phase 37 fix B1 amount-bypass)", async () => {
    mockCreateApprovalRequest.mockClear();
    const body = JSON.stringify({
      riskLevel: "ask",
      operationPayload: {
        chain: "base",
        paymentChallenge: { payTo: BOUND_RECIPIENT_FIXTURE, amount: "-5" },
      },
    });
    const req = makeHmacRequest(
      "POST",
      "/api/agentic-wallet/approval-request",
      body,
      SUB_ORG,
      HMAC_SECRET
    );
    const res = await postApprovalRequest(req);
    expect(res.status).toBe(422);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("BINDING_REQUIRED");
    expect(mockCreateApprovalRequest).not.toHaveBeenCalled();
  });

  it("returns 410 GONE and lazy-flips to expired when expires_at has passed (Phase 37 fix B2)", async () => {
    const { id } = await mockCreateApprovalRequest({
      subOrgId: SUB_ORG,
      riskLevel: "ask",
      operationPayload: baseOperationPayload(),
      binding: bindingFixture(),
    });
    // Directly mutate the in-memory row to simulate a row whose TTL has
    // elapsed without the cron sweeper reaching it yet.
    const seeded = approvalStore.get(id) as ApprovalRow;
    seeded.expiresAt = new Date(Date.now() - 1000);
    approvalStore.set(id, seeded);

    mockGetSession.mockResolvedValue({
      user: { id: OWNER_USER_ID, email: "owner@test" },
    });
    const res = await postApprove(
      makeSessionRequest(`/api/agentic-wallet/${id}/approve`),
      paramCtx(id)
    );
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("EXPIRED");

    // Verify the lazy-flip: row should now be status="expired" and
    // resolvedAt stamped so the cron sweeper is not the only path.
    const flipped = approvalStore.get(id) as ApprovalRow;
    expect(flipped.status).toBe("expired");
    expect(flipped.resolvedAt).not.toBeNull();
  });

  it("returns 422 BINDING_MISMATCH when operationPayload is tampered after create (Phase 37 fix B2)", async () => {
    const { id } = await mockCreateApprovalRequest({
      subOrgId: SUB_ORG,
      riskLevel: "ask",
      operationPayload: baseOperationPayload(),
      binding: bindingFixture(),
    });
    // Tamper: mutate the challenge recipient after the bound_* columns are
    // locked in. checkApprovalForResolve re-derives from paymentChallenge and
    // must refuse the resolve.
    const seeded = approvalStore.get(id) as ApprovalRow;
    const challenge = (
      seeded.operationPayload as { paymentChallenge: Record<string, unknown> }
    ).paymentChallenge;
    challenge.payTo = "0x2222222222222222222222222222222222222222";
    approvalStore.set(id, seeded);

    mockGetSession.mockResolvedValue({
      user: { id: OWNER_USER_ID, email: "owner@test" },
    });
    const res = await postApprove(
      makeSessionRequest(`/api/agentic-wallet/${id}/approve`),
      paramCtx(id)
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("BINDING_MISMATCH");

    // A mismatch must NOT auto-flip the status -- only expiry does.
    const after = approvalStore.get(id) as ApprovalRow;
    expect(after.status).toBe("pending");
  });

  it("reject also returns 410 GONE for an expired approval request (Phase 37 fix B2)", async () => {
    const { id } = await mockCreateApprovalRequest({
      subOrgId: SUB_ORG,
      riskLevel: "ask",
      operationPayload: baseOperationPayload(),
      binding: bindingFixture(),
    });
    const seeded = approvalStore.get(id) as ApprovalRow;
    seeded.expiresAt = new Date(Date.now() - 1000);
    approvalStore.set(id, seeded);

    mockGetSession.mockResolvedValue({
      user: { id: OWNER_USER_ID, email: "owner@test" },
    });
    const res = await postReject(
      makeSessionRequest(`/api/agentic-wallet/${id}/reject`),
      paramCtx(id)
    );
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("EXPIRED");
    const flipped = approvalStore.get(id) as ApprovalRow;
    expect(flipped.status).toBe("expired");
  });

  it("reject also returns 422 BINDING_MISMATCH when payload tampered (Phase 37 fix B2)", async () => {
    const { id } = await mockCreateApprovalRequest({
      subOrgId: SUB_ORG,
      riskLevel: "ask",
      operationPayload: baseOperationPayload(),
      binding: bindingFixture(),
    });
    const seeded = approvalStore.get(id) as ApprovalRow;
    const challenge = (
      seeded.operationPayload as { paymentChallenge: Record<string, unknown> }
    ).paymentChallenge;
    challenge.amount = "99999999";
    approvalStore.set(id, seeded);

    mockGetSession.mockResolvedValue({
      user: { id: OWNER_USER_ID, email: "owner@test" },
    });
    const res = await postReject(
      makeSessionRequest(`/api/agentic-wallet/${id}/reject`),
      paramCtx(id)
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("BINDING_MISMATCH");
    const after = approvalStore.get(id) as ApprovalRow;
    expect(after.status).toBe("pending");
  });

  it("returns 409 ALREADY_RESOLVED when approving a row already resolved (Phase 37 fix B2)", async () => {
    const { id } = await mockCreateApprovalRequest({
      subOrgId: SUB_ORG,
      riskLevel: "ask",
      operationPayload: baseOperationPayload(),
      binding: bindingFixture(),
    });
    // Pre-resolve the row out-of-band.
    const seeded = approvalStore.get(id) as ApprovalRow;
    seeded.status = "approved";
    seeded.resolvedAt = new Date();
    seeded.resolvedByUserId = OWNER_USER_ID;
    approvalStore.set(id, seeded);

    mockGetSession.mockResolvedValue({
      user: { id: OWNER_USER_ID, email: "owner@test" },
    });
    const res = await postApprove(
      makeSessionRequest(`/api/agentic-wallet/${id}/approve`),
      paramCtx(id)
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("ALREADY_RESOLVED");
  });

  it("writes binding fields from paymentChallenge into the approval row (Phase 37 fix B1)", async () => {
    mockCreateApprovalRequest.mockClear();
    const body = JSON.stringify({
      riskLevel: "ask",
      operationPayload: baseOperationPayload(),
    });
    const req = makeHmacRequest(
      "POST",
      "/api/agentic-wallet/approval-request",
      body,
      SUB_ORG,
      HMAC_SECRET
    );
    const res = await postApprovalRequest(req);
    expect(res.status).toBe(201);
    expect(mockCreateApprovalRequest).toHaveBeenCalledTimes(1);
    const callArgs = mockCreateApprovalRequest.mock.calls[0]?.[0] as {
      binding: {
        recipient: string;
        amountMicro: string;
        chain: string;
        contract: string;
      };
    };
    expect(callArgs.binding).toEqual({
      recipient: BOUND_RECIPIENT_FIXTURE,
      amountMicro: BOUND_AMOUNT_FIXTURE,
      chain: "base",
      contract: BOUND_CONTRACT_BASE,
    });
  });
});
