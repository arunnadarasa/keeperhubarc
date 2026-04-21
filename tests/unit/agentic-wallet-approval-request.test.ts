/**
 * Wave 0 RED scaffold for lib/agentic-wallet/approval.ts.
 *
 * Contract anchor: 33-CONTEXT.md /approval-request decisions (lines 22-23) +
 * 33-RESEARCH.md Pattern 6 pre-filter (auto should not produce rows).
 *
 *   createApprovalRequest({ subOrgId, riskLevel: "ask" | "block",
 *                            operationPayload })
 *     -> inserts a row with status default "pending" and returns { id }
 *     -> throws when riskLevel === "auto" (auto-approved ops bypass approval)
 *
 * Baseline: every case throws because createApprovalRequest is a stub.
 * Plan 33-03 flips this suite GREEN.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockInsertCall, mockReturning } = vi.hoisted(() => ({
  mockInsertCall: vi.fn(),
  mockReturning: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: (table: unknown): unknown => ({
      values: (payload: unknown): unknown => {
        mockInsertCall(table, payload);
        return { returning: mockReturning };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  walletApprovalRequests: { _tableName: "wallet_approval_requests" },
}));

const { createApprovalRequest } = await import(
  "@/lib/agentic-wallet/approval"
);

const SUB_ORG = "subOrg_approval_test";

describe("createApprovalRequest", () => {
  beforeEach(() => {
    mockInsertCall.mockReset();
    mockReturning.mockReset();
    mockReturning.mockResolvedValue([{ id: "ar_abc" }]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a pending row into wallet_approval_requests for a risk='ask' op", async () => {
    await createApprovalRequest({
      subOrgId: SUB_ORG,
      riskLevel: "ask",
      operationPayload: { foo: "bar" },
    });
    expect(mockInsertCall).toHaveBeenCalledTimes(1);
    const payload = mockInsertCall.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(payload.subOrgId).toBe(SUB_ORG);
    expect(payload.riskLevel).toBe("ask");
    expect(payload.operationPayload).toEqual({ foo: "bar" });
    // status is either omitted (relies on DB default "pending") or explicitly
    // set to "pending"; tolerate either.
    const statusOrMissing =
      (payload.status as string | undefined) ?? "pending";
    expect(statusOrMissing).toBe("pending");
  });

  it("returns the inserted row id", async () => {
    mockReturning.mockResolvedValueOnce([{ id: "ar_generated_xyz" }]);
    const result = await createApprovalRequest({
      subOrgId: SUB_ORG,
      riskLevel: "ask",
      operationPayload: { k: "v" },
    });
    expect(result.id).toBe("ar_generated_xyz");
  });

  it("inserts risk='block' operations for audit (they will never transition to approved)", async () => {
    await createApprovalRequest({
      subOrgId: SUB_ORG,
      riskLevel: "block",
      operationPayload: { k: "v" },
    });
    const payload = mockInsertCall.mock.calls[0]?.[1] as Record<
      string,
      unknown
    >;
    expect(payload.riskLevel).toBe("block");
  });

  it("throws when riskLevel is 'auto' (auto ops must not create approval rows)", async () => {
    await expect(
      createApprovalRequest({
        subOrgId: SUB_ORG,
        // @ts-expect-error -- "auto" is deliberately outside the allowed type
        // for createApprovalRequest; Phase 34's pre-filter should never reach
        // this call-site with auto-tier ops. The helper must still throw
        // defensively if a caller ignores the type hint.
        riskLevel: "auto",
        operationPayload: { k: "v" },
      })
    ).rejects.toThrow();
    expect(mockInsertCall).not.toHaveBeenCalled();
  });
});
