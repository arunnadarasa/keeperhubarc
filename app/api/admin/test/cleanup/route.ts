import { inArray, like, sql } from "drizzle-orm";
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
  workflowSchedules,
  workflows,
} from "@/lib/db/schema";

const K6_EMAIL_PATTERN = "k6-%@techops.services";

export async function POST(request: Request): Promise<NextResponse> {
  const auth = authenticateAdmin(request);
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: auth.error ?? "Unauthorized" },
      { status: 401 },
    );
  }

  let body: { dryRun?: boolean } = {};
  try {
    body = await request.json();
  } catch {
    // No body or invalid JSON — default to non-dry-run
  }
  const dryRun = body.dryRun === true;

  try {
    // Find all k6 test users
    const testUsers = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(like(users.email, K6_EMAIL_PATTERN));

    if (testUsers.length === 0) {
      return NextResponse.json({
        deleted: {
          users: 0,
          organizations: 0,
          workflows: 0,
          executions: 0,
          executionLogs: 0,
          sessions: 0,
          accounts: 0,
          apiKeys: 0,
          verifications: 0,
        },
        emails: [],
        dryRun,
      });
    }

    const userIds = testUsers.map((u) => u.id);
    const emails = testUsers.map((u) => u.email).filter(Boolean) as string[];

    // Find organizations owned by test users (via member table)
    const testMembers = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(inArray(member.userId, userIds));
    const orgIds = [...new Set(testMembers.map((m) => m.organizationId))];

    // Find workflow IDs for counting
    const testWorkflows = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(inArray(workflows.userId, userIds));
    const workflowIds = testWorkflows.map((w) => w.id);

    if (dryRun) {
      // Count what would be deleted without actually deleting
      let executionCount = 0;
      let logCount = 0;
      if (workflowIds.length > 0) {
        const execRows = await db
          .select({ id: workflowExecutions.id })
          .from(workflowExecutions)
          .where(inArray(workflowExecutions.workflowId, workflowIds));
        executionCount = execRows.length;
        if (execRows.length > 0) {
          const execIds = execRows.map((e) => e.id);
          const logRows = await db
            .select({ count: sql<number>`count(*)` })
            .from(workflowExecutionLogs)
            .where(inArray(workflowExecutionLogs.executionId, execIds));
          logCount = Number(logRows[0]?.count ?? 0);
        }
      }

      return NextResponse.json({
        deleted: {
          users: testUsers.length,
          organizations: orgIds.length,
          workflows: workflowIds.length,
          executions: executionCount,
          executionLogs: logCount,
          sessions: -1,
          accounts: -1,
          apiKeys: -1,
          verifications: -1,
        },
        emails,
        dryRun: true,
        message: "Dry run — no records were deleted",
      });
    }

    // Delete in FK dependency order within a transaction.
    // Most user→X FKs do NOT have ON DELETE CASCADE, so we must
    // delete children explicitly before deleting users.
    const counts = await db.transaction(async (tx) => {
      let deletedLogs = 0;
      let deletedExecutions = 0;
      let deletedSchedules = 0;

      if (workflowIds.length > 0) {
        // 1. workflowExecutionLogs → workflowExecutions
        const execRows = await tx
          .select({ id: workflowExecutions.id })
          .from(workflowExecutions)
          .where(inArray(workflowExecutions.workflowId, workflowIds));
        const execIds = execRows.map((e) => e.id);
        if (execIds.length > 0) {
          const logResult = await tx
            .delete(workflowExecutionLogs)
            .where(inArray(workflowExecutionLogs.executionId, execIds));
          deletedLogs = logResult.rowCount ?? 0;
        }

        // 2. workflowExecutions
        const execResult = await tx
          .delete(workflowExecutions)
          .where(inArray(workflowExecutions.workflowId, workflowIds));
        deletedExecutions = execResult.rowCount ?? 0;

        // 3. workflowSchedules (has cascade from workflows, but explicit is cleaner)
        const schedResult = await tx
          .delete(workflowSchedules)
          .where(inArray(workflowSchedules.workflowId, workflowIds));
        deletedSchedules = schedResult.rowCount ?? 0;
      }

      // 4. workflows
      const wfResult = await tx
        .delete(workflows)
        .where(inArray(workflows.userId, userIds));
      const deletedWorkflows = wfResult.rowCount ?? 0;

      // 5. integrations
      const intResult = await tx
        .delete(integrations)
        .where(inArray(integrations.userId, userIds));

      // 6. apiKeys
      const akResult = await tx
        .delete(apiKeys)
        .where(inArray(apiKeys.userId, userIds));

      // 7. deviceCode
      await tx.delete(deviceCode).where(inArray(deviceCode.userId, userIds));

      // 8. verifications (keyed by identifier, not user_id)
      const verResult = await tx
        .delete(verifications)
        .where(
          like(
            verifications.identifier,
            "email-verification-otp-k6-%@techops.services",
          ),
        );
      const deletedVerifications = verResult.rowCount ?? 0;

      // 9. sessions
      const sessResult = await tx
        .delete(sessions)
        .where(inArray(sessions.userId, userIds));
      const deletedSessions = sessResult.rowCount ?? 0;

      // 10. accounts
      const accResult = await tx
        .delete(accounts)
        .where(inArray(accounts.userId, userIds));
      const deletedAccounts = accResult.rowCount ?? 0;

      // 11. member (has cascade, but explicit for clarity)
      await tx.delete(member).where(inArray(member.userId, userIds));

      // 12. organization (cascades to orgApiKeys, orgTokens, paraWallets, etc.)
      let deletedOrgs = 0;
      if (orgIds.length > 0) {
        const orgResult = await tx
          .delete(organization)
          .where(inArray(organization.id, orgIds));
        deletedOrgs = orgResult.rowCount ?? 0;
      }

      // 13. users (last)
      const userResult = await tx
        .delete(users)
        .where(inArray(users.id, userIds));
      const deletedUsers = userResult.rowCount ?? 0;

      return {
        users: deletedUsers,
        organizations: deletedOrgs,
        workflows: deletedWorkflows,
        executions: deletedExecutions,
        executionLogs: deletedLogs,
        schedules: deletedSchedules,
        sessions: deletedSessions,
        accounts: deletedAccounts,
        apiKeys: akResult.rowCount ?? 0,
        verifications: deletedVerifications,
      };
    });

    return NextResponse.json({ deleted: counts, emails, dryRun: false });
  } catch (error) {
    console.error("Admin cleanup failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
