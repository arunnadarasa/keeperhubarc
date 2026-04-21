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
  status: "pending" | "approved" | "rejected";
  createdAt: Date;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
};

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
  };
});

vi.mock("@/lib/agentic-wallet/approval", () => ({
  createApprovalRequest: mockCreateApprovalRequest,
  getApprovalRequest: mockGetApprovalRequest,
  resolveApprovalRequest: mockResolveApprovalRequest,
}));

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
        resolvedAt: null,
        resolvedByUserId: null,
      };
      approvalStore.set(id, row);
      return { id };
    }
  );

  mockGetApprovalRequest.mockImplementation(async (id: string) => {
    return (approvalStore.get(id) as ApprovalRow | undefined) ?? null;
  });

  mockResolveApprovalRequest.mockImplementation(
    async (
      id: string,
      userId: string,
      decision: "approved" | "rejected"
    ) => {
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
    const body = JSON.stringify({
      riskLevel: "ask",
      operationPayload: { chain: "base", amount: "50000000" },
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
    expect(pollBody1.operationPayload).toEqual({
      chain: "base",
      amount: "50000000",
    });

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
    // Seed: one pending row for SUB_ORG.
    const { id } = await mockCreateApprovalRequest({
      subOrgId: SUB_ORG,
      riskLevel: "ask",
      operationPayload: { k: "v" },
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
      operationPayload: { k: "v" },
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
      operationPayload: { k: "v" },
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
      operationPayload: { k: "v" },
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
});
