import { and, eq, lt, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isBillingEnabled } from "@/keeperhub/lib/billing/feature-flag";
import { billOverageForOrg } from "@/keeperhub/lib/billing/overage";
import { authenticateInternalService } from "@/keeperhub/lib/internal-service-auth";
import { db } from "@/lib/db";
import {
  organizationSubscriptions,
  overageBillingRecords,
} from "@/lib/db/schema";

type SingleOrgBody = {
  scan?: never;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
};

type ScanBody = {
  scan: true;
  organizationId?: never;
  periodStart?: never;
  periodEnd?: never;
};

type RequestBody = SingleOrgBody | ScanBody;

/**
 * Internal POST endpoint for overage billing.
 *
 * Two modes:
 * - Single org: `{ organizationId, periodStart, periodEnd }` -- bill one org
 * - Scan mode: `{ scan: true }` -- find all active subscriptions with ended
 *   periods that haven't been billed yet, then bill each
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const auth = authenticateInternalService(request);
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: auth.error ?? "Unauthorized" },
      { status: 401 }
    );
  }

  const body = (await request.json()) as RequestBody;

  if (body.scan) {
    return handleScan();
  }

  if (body.organizationId && body.periodStart && body.periodEnd) {
    const result = await billOverageForOrg(
      body.organizationId,
      new Date(body.periodStart),
      new Date(body.periodEnd)
    );
    return NextResponse.json(result);
  }

  return NextResponse.json(
    {
      error:
        "Provide { scan: true } or { organizationId, periodStart, periodEnd }",
    },
    { status: 400 }
  );
}

async function handleScan(): Promise<NextResponse> {
  const now = new Date();

  // Find active subscriptions where the billing period has ended
  // and no overage record exists for that period
  const subs = await db
    .select({
      organizationId: organizationSubscriptions.organizationId,
      periodStart: organizationSubscriptions.currentPeriodStart,
      periodEnd: organizationSubscriptions.currentPeriodEnd,
    })
    .from(organizationSubscriptions)
    .where(
      and(
        eq(organizationSubscriptions.status, "active"),
        lt(organizationSubscriptions.currentPeriodEnd, now)
      )
    );

  const results: Array<{
    organizationId: string;
    result: { billed: boolean; reason?: string };
  }> = [];

  // Track orgs processed in loop 1 to avoid double-processing in loop 2
  const processedOrgPeriods = new Set<string>();

  for (const sub of subs) {
    if (sub.periodStart === null || sub.periodEnd === null) {
      continue;
    }

    const result = await billOverageForOrg(
      sub.organizationId,
      sub.periodStart,
      sub.periodEnd
    );
    processedOrgPeriods.add(
      `${sub.organizationId}:${sub.periodStart.toISOString()}:${sub.periodEnd.toISOString()}`
    );
    results.push({ organizationId: sub.organizationId, result });
  }

  // Retry pending/failed overage records that were created but not successfully
  // billed (e.g. if billOverageForOrg failed after inserting the record).
  // These records store period dates independently from the subscription row.
  const failedRecords = await db
    .select({
      organizationId: overageBillingRecords.organizationId,
      periodStart: overageBillingRecords.periodStart,
      periodEnd: overageBillingRecords.periodEnd,
    })
    .from(overageBillingRecords)
    .where(
      or(
        eq(overageBillingRecords.status, "pending"),
        eq(overageBillingRecords.status, "failed")
      )
    );

  for (const record of failedRecords) {
    const key = `${record.organizationId}:${record.periodStart.toISOString()}:${record.periodEnd.toISOString()}`;
    if (processedOrgPeriods.has(key)) {
      continue;
    }
    const result = await billOverageForOrg(
      record.organizationId,
      record.periodStart,
      record.periodEnd
    );
    results.push({ organizationId: record.organizationId, result });
  }

  return NextResponse.json({
    scanned: subs.length,
    retried: failedRecords.length,
    results,
  });
}
