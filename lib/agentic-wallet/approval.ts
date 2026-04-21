/**
 * Wallet approval request broker (infra for Phase 34 in-chat ask-decision flow).
 *
 * Three helpers over the `wallet_approval_requests` table:
 *   - createApprovalRequest({ subOrgId, riskLevel: 'ask' | 'block',
 *                              operationPayload }) -> { id }
 *       Inserts a pending row and returns its id. Throws when riskLevel is
 *       'auto' -- auto-tier ops must bypass approval entirely (RESEARCH
 *       Pattern 6 pre-filter).
 *   - getApprovalRequest(id) -> WalletApprovalRequest | null
 *       Selects a single row by id; returns null on miss.
 *   - resolveApprovalRequest(id, userId, decision) -> WalletApprovalRequest | null
 *       Transitions a PENDING row to `decision` and stamps resolvedAt +
 *       resolvedByUserId. Returns the updated row via .returning(), or null
 *       if no row matched (id not found OR already resolved). The
 *       status='pending' predicate guards against the T-33-race-double-approve
 *       race.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  walletApprovalRequests,
  type WalletApprovalRequest,
} from "@/lib/db/schema";

export type CreateApprovalRequestArgs = {
  subOrgId: string;
  riskLevel: "ask" | "block";
  operationPayload: Record<string, unknown>;
};

export async function createApprovalRequest(
  args: CreateApprovalRequestArgs
): Promise<{ id: string }> {
  // Defensive guard: even though the TS type excludes "auto", callers may
  // ignore the hint. Phase 34's pre-filter should never reach this call-site
  // with auto-tier ops, so throwing is the safest failure mode.
  if ((args.riskLevel as string) === "auto") {
    throw new Error(
      "createApprovalRequest: riskLevel 'auto' must not create a row"
    );
  }

  const rows = await db
    .insert(walletApprovalRequests)
    .values({
      subOrgId: args.subOrgId,
      riskLevel: args.riskLevel,
      operationPayload: args.operationPayload,
    })
    .returning({ id: walletApprovalRequests.id });

  const row = rows?.[0];
  if (!row) {
    throw new Error("createApprovalRequest: insert returned no row");
  }
  return { id: row.id };
}

export async function getApprovalRequest(
  id: string
): Promise<WalletApprovalRequest | null> {
  const rows = await db
    .select()
    .from(walletApprovalRequests)
    .where(eq(walletApprovalRequests.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function resolveApprovalRequest(
  id: string,
  userId: string,
  decision: "approved" | "rejected"
): Promise<WalletApprovalRequest | null> {
  const rows = await db
    .update(walletApprovalRequests)
    .set({
      status: decision,
      resolvedAt: new Date(),
      resolvedByUserId: userId,
    })
    .where(
      and(
        eq(walletApprovalRequests.id, id),
        eq(walletApprovalRequests.status, "pending")
      )
    )
    .returning();
  return rows[0] ?? null;
}
