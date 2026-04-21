/**
 * POST /api/agentic-wallet/:id/approve
 *
 * Session-authenticated approval of a pending wallet approval request. The
 * logged-in user must OWN the underlying agentic wallet -- i.e. the wallet's
 * linked_user_id must equal session.user.id. Unlinked wallets are forbidden
 * (RESEARCH Anti-Patterns line 576-577: "no approver exists").
 *
 * Lifecycle:
 *   1. 401 when there is no session.
 *   2. 404 when the approval request id is unknown.
 *   3. 404 when the wallet for row.subOrgId does not exist.
 *   4. 403 when the wallet exists but linked_user_id != session.user.id
 *      (covers unlinked wallets).
 *   5. 409 when resolveApprovalRequest returns null -- another approver (or
 *      a duplicate tab) already resolved the row (T-33-race-double-approve).
 *   6. 200 { ok: true, status: "approved" } on success.
 */
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  getApprovalRequest,
  resolveApprovalRequest,
} from "@/lib/agentic-wallet/approval";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { agenticWallets } from "@/lib/db/schema";
import { ErrorCategory, logSystemError } from "@/lib/logging";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ id: string }> };

type OwnerCheckResult = "ok" | "not-found" | "forbidden";

async function ownerCheck(
  subOrgId: string,
  userId: string
): Promise<OwnerCheckResult> {
  const rows = await db
    .select({ linkedUserId: agenticWallets.linkedUserId })
    .from(agenticWallets)
    .where(eq(agenticWallets.subOrgId, subOrgId))
    .limit(1);
  if (rows.length === 0) {
    return "not-found";
  }
  // Unlinked wallets (linkedUserId === null) are never "owned" by a user, so
  // null !== userId always falls through to "forbidden". That matches the
  // RESEARCH directive that unlinked wallets have no approver.
  if (rows[0]?.linkedUserId !== userId) {
    return "forbidden";
  }
  return "ok";
}

export async function POST(
  request: Request,
  { params }: RouteParams
): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const userId = session.user.id;

  try {
    const row = await getApprovalRequest(id);
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const owner = await ownerCheck(row.subOrgId, userId);
    if (owner === "not-found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (owner === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const resolved = await resolveApprovalRequest(id, userId, "approved");
    if (!resolved) {
      return NextResponse.json(
        { error: "Already resolved" },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, status: "approved" });
  } catch (error) {
    logSystemError(
      ErrorCategory.DATABASE,
      "[Agentic] /approve failed",
      error,
      {
        endpoint: `/api/agentic-wallet/${id}/approve`,
        userId,
      }
    );
    return NextResponse.json({ error: "Approve failed" }, { status: 500 });
  }
}
