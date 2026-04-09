import { inArray, like } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import {
  accounts,
  apiKeys,
  deviceCode,
  integrations,
  member,
  organization,
  sessions,
  users,
  verifications,
  workflowExecutionLogs,
  workflowExecutions,
  workflows,
  workflowSchedules,
} from "@/lib/db/schema";

const K6_EMAIL_PATTERN = "k6-%@techops.services";
const VERIFICATION_PATTERN = "email-verification-otp-k6-%@techops.services";

export async function POST(request: Request): Promise<NextResponse> {
  const auth = authenticateAdmin(request);
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: auth.error ?? "Unauthorized" },
      { status: 401 }
    );
  }

  let body: { dryRun?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    // default
  }

  try {
    const testUsers = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(like(users.email, K6_EMAIL_PATTERN));

    if (testUsers.length === 0) {
      return NextResponse.json({
        deleted: { users: 0 },
        emails: [],
        dryRun: body.dryRun === true,
      });
    }

    const userIds = testUsers.map((u) => u.id);
    const emails = testUsers.map((u) => u.email).filter(Boolean) as string[];

    if (body.dryRun === true) {
      return NextResponse.json({
        deleted: { users: userIds.length },
        emails,
        dryRun: true,
      });
    }

    await db.transaction(async (tx) => {
      // Resolve dependent IDs up front so subsequent deletes can use inArray.
      const wfRows = await tx
        .select({ id: workflows.id })
        .from(workflows)
        .where(inArray(workflows.userId, userIds));
      const workflowIds = wfRows.map((w) => w.id);

      const orgRows = await tx
        .select({ organizationId: member.organizationId })
        .from(member)
        .where(inArray(member.userId, userIds));
      const orgIds = [...new Set(orgRows.map((r) => r.organizationId))];

      // Step 1: Disable test workflows so the scheduler stops triggering them
      // mid-cleanup. Done inside the transaction so it rolls back on failure.
      if (workflowIds.length > 0) {
        await tx
          .update(workflows)
          .set({ enabled: false })
          .where(inArray(workflows.id, workflowIds));
      }

      // Step 2: Delete in FK order.
      if (workflowIds.length > 0) {
        const execRows = await tx
          .select({ id: workflowExecutions.id })
          .from(workflowExecutions)
          .where(inArray(workflowExecutions.workflowId, workflowIds));
        const executionIds = execRows.map((e) => e.id);

        if (executionIds.length > 0) {
          await tx
            .delete(workflowExecutionLogs)
            .where(inArray(workflowExecutionLogs.executionId, executionIds));
        }
        await tx
          .delete(workflowExecutions)
          .where(inArray(workflowExecutions.workflowId, workflowIds));
        await tx
          .delete(workflowSchedules)
          .where(inArray(workflowSchedules.workflowId, workflowIds));
        await tx.delete(workflows).where(inArray(workflows.id, workflowIds));
      }

      await tx
        .delete(integrations)
        .where(inArray(integrations.userId, userIds));
      await tx.delete(apiKeys).where(inArray(apiKeys.userId, userIds));
      await tx.delete(deviceCode).where(inArray(deviceCode.userId, userIds));
      await tx
        .delete(verifications)
        .where(like(verifications.identifier, VERIFICATION_PATTERN));
      await tx.delete(sessions).where(inArray(sessions.userId, userIds));
      await tx.delete(accounts).where(inArray(accounts.userId, userIds));
      await tx.delete(member).where(inArray(member.userId, userIds));
      if (orgIds.length > 0) {
        await tx.delete(organization).where(inArray(organization.id, orgIds));
      }
      await tx.delete(users).where(inArray(users.id, userIds));
    });

    return NextResponse.json({
      deleted: { users: userIds.length },
      emails,
      dryRun: false,
    });
  } catch (error) {
    console.error("Admin cleanup failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
