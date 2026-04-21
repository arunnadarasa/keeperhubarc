/**
 * Wallet approval request broker (infra for Phase 34 in-chat ask-decision flow).
 *
 * Phase 33 Wave 0: stub only. Plan 33-03 fleshes out createApprovalRequest:
 *   - Inserts a row into walletApprovalRequests with { subOrgId, riskLevel,
 *     operationPayload } and status defaulted to "pending".
 *   - Throws when riskLevel === "auto" (auto-approved ops must not create
 *     approval rows -- RESEARCH Pattern 6 pre-filter).
 *   - Returns the inserted row id so callers can poll GET /approval-request/:id.
 */
export type CreateApprovalRequestArgs = {
  subOrgId: string;
  riskLevel: "ask" | "block";
  operationPayload: Record<string, unknown>;
};

export function createApprovalRequest(
  _args: CreateApprovalRequestArgs
): Promise<{ id: string }> {
  throw new Error(
    "createApprovalRequest: not yet implemented (Phase 33 plan 03)"
  );
}
