import { inArray, like, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { authenticateAdmin } from "@/lib/admin-auth";
import { db } from "@/lib/db";
import { member, organization, users } from "@/lib/db/schema";

const K6_EMAIL_PATTERN = "k6-%@techops.services";
const USER_IDS_SUBQUERY = sql`(SELECT id FROM users WHERE email LIKE 'k6-%@techops.services')`;
const WF_IDS_SUBQUERY = sql`(SELECT id FROM workflows WHERE user_id IN ${USER_IDS_SUBQUERY})`;

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

    // Step 1: Disable test workflows so scheduler stops triggering them
    await db.execute(
      sql`UPDATE workflows SET enabled = false WHERE user_id IN ${USER_IDS_SUBQUERY}`
    );

    // Step 2: Delete in FK order using subqueries (no array params)
    await db.execute(
      sql`DELETE FROM workflow_execution_logs WHERE execution_id IN (SELECT id FROM workflow_executions WHERE workflow_id IN ${WF_IDS_SUBQUERY})`
    );
    await db.execute(
      sql`DELETE FROM workflow_executions WHERE workflow_id IN ${WF_IDS_SUBQUERY}`
    );
    await db.execute(
      sql`DELETE FROM workflow_schedules WHERE workflow_id IN ${WF_IDS_SUBQUERY}`
    );
    await db.execute(
      sql`DELETE FROM workflows WHERE user_id IN ${USER_IDS_SUBQUERY}`
    );
    await db.execute(
      sql`DELETE FROM integrations WHERE user_id IN ${USER_IDS_SUBQUERY}`
    );
    await db.execute(
      sql`DELETE FROM api_keys WHERE user_id IN ${USER_IDS_SUBQUERY}`
    );
    await db.execute(
      sql`DELETE FROM device_code WHERE user_id IN ${USER_IDS_SUBQUERY}`
    );
    await db.execute(
      sql`DELETE FROM verifications WHERE identifier LIKE 'email-verification-otp-k6-%@techops.services'`
    );
    await db.execute(
      sql`DELETE FROM sessions WHERE user_id IN ${USER_IDS_SUBQUERY}`
    );
    await db.execute(
      sql`DELETE FROM accounts WHERE user_id IN ${USER_IDS_SUBQUERY}`
    );

    // Orgs
    const orgRows = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(inArray(member.userId, userIds));
    const orgIds = [...new Set(orgRows.map((r) => r.organizationId))];

    await db.execute(
      sql`DELETE FROM member WHERE user_id IN ${USER_IDS_SUBQUERY}`
    );
    if (orgIds.length > 0) {
      await db.delete(organization).where(inArray(organization.id, orgIds));
    }

    await db.execute(
      sql`DELETE FROM users WHERE email LIKE 'k6-%@techops.services'`
    );

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
