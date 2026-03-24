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

const EMPTY_RESULT = {
  deleted: { users: 0, organizations: 0, workflows: 0 },
  emails: [] as string[],
};

async function findTestData() {
  const testUsers = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(like(users.email, K6_EMAIL_PATTERN));

  if (testUsers.length === 0) return null;

  const userIds = testUsers.map((u) => u.id);
  const emails = testUsers.map((u) => u.email).filter(Boolean) as string[];

  const testMembers = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(inArray(member.userId, userIds));
  const orgIds = [...new Set(testMembers.map((m) => m.organizationId))];

  const testWorkflows = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(inArray(workflows.userId, userIds));
  const workflowIds = testWorkflows.map((w) => w.id);

  return { userIds, emails, orgIds, workflowIds };
}

// Delete in FK dependency order within a transaction.
// Most user->X FKs do NOT have ON DELETE CASCADE, so we must
// delete children explicitly before deleting users.
async function deleteTestData(data: {
  userIds: string[];
  orgIds: string[];
  workflowIds: string[];
}) {
  const { userIds, orgIds, workflowIds } = data;

  await db.transaction(async (tx) => {
    if (workflowIds.length > 0) {
      const execRows = await tx
        .select({ id: workflowExecutions.id })
        .from(workflowExecutions)
        .where(inArray(workflowExecutions.workflowId, workflowIds));
      const execIds = execRows.map((e) => e.id);

      if (execIds.length > 0) {
        await tx
          .delete(workflowExecutionLogs)
          .where(inArray(workflowExecutionLogs.executionId, execIds));
      }
      await tx
        .delete(workflowExecutions)
        .where(inArray(workflowExecutions.workflowId, workflowIds));
      await tx
        .delete(workflowSchedules)
        .where(inArray(workflowSchedules.workflowId, workflowIds));
    }

    await tx.delete(workflows).where(inArray(workflows.userId, userIds));
    await tx.delete(integrations).where(inArray(integrations.userId, userIds));
    await tx.delete(apiKeys).where(inArray(apiKeys.userId, userIds));
    await tx.delete(deviceCode).where(inArray(deviceCode.userId, userIds));
    await tx
      .delete(verifications)
      .where(
        like(
          verifications.identifier,
          "email-verification-otp-k6-%@techops.services",
        ),
      );
    await tx.delete(sessions).where(inArray(sessions.userId, userIds));
    await tx.delete(accounts).where(inArray(accounts.userId, userIds));
    await tx.delete(member).where(inArray(member.userId, userIds));

    if (orgIds.length > 0) {
      await tx.delete(organization).where(inArray(organization.id, orgIds));
    }

    await tx.delete(users).where(inArray(users.id, userIds));
  });
}

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
    const data = await findTestData();
    if (!data) {
      return NextResponse.json({ ...EMPTY_RESULT, dryRun });
    }

    if (dryRun) {
      return NextResponse.json({
        deleted: {
          users: data.userIds.length,
          organizations: data.orgIds.length,
          workflows: data.workflowIds.length,
        },
        emails: data.emails,
        dryRun: true,
      });
    }

    await deleteTestData(data);

    return NextResponse.json({
      deleted: {
        users: data.userIds.length,
        organizations: data.orgIds.length,
        workflows: data.workflowIds.length,
      },
      emails: data.emails,
      dryRun: false,
    });
  } catch (error) {
    console.error("Admin cleanup failed:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
