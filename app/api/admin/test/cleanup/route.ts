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
  workflows,
} from "@/lib/db/schema";

const K6_EMAIL_PATTERN = "k6-%@techops.services";

async function findTestUserIds(): Promise<{
  userIds: string[];
  emails: string[];
}> {
  const testUsers = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(like(users.email, K6_EMAIL_PATTERN));

  if (testUsers.length === 0) {
    return { userIds: [], emails: [] };
  }

  return {
    userIds: testUsers.map((u) => u.id),
    emails: testUsers.map((u) => u.email).filter(Boolean) as string[],
  };
}

// Delete using raw SQL subqueries to avoid IN clause size limits.
// Each statement runs independently (no wrapping transaction to avoid timeouts).
async function deleteTestData(userIds: string[]) {
  if (userIds.length === 0) {
    return;
  }

  // Use raw SQL with subqueries for cascade-safe deletion
  // This avoids materializing thousands of IDs in IN clauses

  // 1. Execution logs (via execution -> workflow -> user)
  await db.execute(sql`
    DELETE FROM workflow_execution_logs WHERE execution_id IN (
      SELECT id FROM workflow_executions WHERE workflow_id IN (
        SELECT id FROM workflows WHERE user_id = ANY(${userIds})
      )
    )
  `);

  // 2. Executions
  await db.execute(sql`
    DELETE FROM workflow_executions WHERE workflow_id IN (
      SELECT id FROM workflows WHERE user_id = ANY(${userIds})
    )
  `);

  // 3. Workflow schedules
  await db.execute(sql`
    DELETE FROM workflow_schedules WHERE workflow_id IN (
      SELECT id FROM workflows WHERE user_id = ANY(${userIds})
    )
  `);

  // 4. Workflows
  await db.delete(workflows).where(inArray(workflows.userId, userIds));

  // 5. Other user-owned data
  await db.delete(integrations).where(inArray(integrations.userId, userIds));
  await db.delete(apiKeys).where(inArray(apiKeys.userId, userIds));
  await db.delete(deviceCode).where(inArray(deviceCode.userId, userIds));
  await db
    .delete(verifications)
    .where(
      like(
        verifications.identifier,
        "email-verification-otp-k6-%@techops.services"
      )
    );
  await db.delete(sessions).where(inArray(sessions.userId, userIds));
  await db.delete(accounts).where(inArray(accounts.userId, userIds));

  // 6. Orgs (find via member, then delete)
  const orgRows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(inArray(member.userId, userIds));
  const orgIds = [...new Set(orgRows.map((r) => r.organizationId))];

  await db.delete(member).where(inArray(member.userId, userIds));

  if (orgIds.length > 0) {
    await db.delete(organization).where(inArray(organization.id, orgIds));
  }

  // 7. Users last
  await db.delete(users).where(inArray(users.id, userIds));
}

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
    // default to non-dry-run
  }

  try {
    const { userIds, emails } = await findTestUserIds();

    if (userIds.length === 0) {
      return NextResponse.json({
        deleted: { users: 0, organizations: 0, workflows: 0 },
        emails: [],
        dryRun: body.dryRun === true,
      });
    }

    if (body.dryRun === true) {
      const wfRows = await db
        .select({ id: workflows.id })
        .from(workflows)
        .where(inArray(workflows.userId, userIds));
      return NextResponse.json({
        deleted: { users: userIds.length, workflows: wfRows.length },
        emails,
        dryRun: true,
      });
    }

    // Count before deleting
    const wfRows = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(inArray(workflows.userId, userIds));

    await deleteTestData(userIds);

    return NextResponse.json({
      deleted: { users: userIds.length, workflows: wfRows.length },
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
