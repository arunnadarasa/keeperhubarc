import { and, eq, lt } from "drizzle-orm";
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

  for (const sub of subs) {
    if (sub.periodStart === null || sub.periodEnd === null) {
      continue;
    }

    // Check if already billed for this period
    const existing = await db.query.overageBillingRecords.findFirst({
      where: and(
        eq(overageBillingRecords.organizationId, sub.organizationId),
        eq(overageBillingRecords.periodStart, sub.periodStart),
        eq(overageBillingRecords.periodEnd, sub.periodEnd)
      ),
      columns: { id: true },
    });

    if (existing) {
      continue;
    }

    const result = await billOverageForOrg(
      sub.organizationId,
      sub.periodStart,
      sub.periodEnd
    );
    results.push({ organizationId: sub.organizationId, result });
  }

  return NextResponse.json({ scanned: subs.length, results });
}
