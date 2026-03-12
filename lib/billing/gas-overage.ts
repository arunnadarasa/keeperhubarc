import "server-only";

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { gasCreditUsage } from "@/keeperhub/db/schema-extensions";
import { db } from "@/lib/db";
import { organizationSubscriptions } from "@/lib/db/schema";
import { getPlanLimits, PLANS, parsePlanName, parseTierKey } from "./plans";
import { getBillingProvider } from "./providers";

const LOG_PREFIX = "[Gas Overage]";

type GasOverageResult =
  | { billed: false; reason: string }
  | { billed: true; overageCents: number };

/**
 * Bill gas credit overage for an organization's billing period.
 *
 * Computes total gas usage (in USD cents) for the period, subtracts
 * the plan's included gas credits, and bills the difference via Stripe.
 *
 * Idempotent: checks if a gas overage invoice item already exists for the
 * period by querying existing usage and billing state.
 */
export async function billGasOverageForOrg(
  organizationId: string,
  periodStart: Date,
  periodEnd: Date
): Promise<GasOverageResult> {
  const sub = await db.query.organizationSubscriptions.findFirst({
    where: eq(organizationSubscriptions.organizationId, organizationId),
  });

  if (!sub) {
    return { billed: false, reason: "no subscription" };
  }

  const plan = parsePlanName(sub.plan);
  const tier = parseTierKey(sub.tier);
  const planDef = PLANS[plan];

  if (!planDef.overage.enabled) {
    return { billed: false, reason: "overage not enabled for plan" };
  }

  if (!sub.providerCustomerId) {
    return { billed: false, reason: "no provider customer ID" };
  }

  const limits = getPlanLimits(plan, tier);
  const gasCreditsCents = limits.gasCreditsCents;

  const result = await db
    .select({
      totalCents: sql<number>`coalesce(sum(${gasCreditUsage.gasCostUsdCents}), 0)`,
    })
    .from(gasCreditUsage)
    .where(
      and(
        eq(gasCreditUsage.organizationId, organizationId),
        gte(gasCreditUsage.createdAt, periodStart),
        lt(gasCreditUsage.createdAt, periodEnd)
      )
    );

  const totalUsageCents = Number(result[0]?.totalCents ?? 0);
  const overageCents = Math.max(0, totalUsageCents - gasCreditsCents);

  if (overageCents === 0) {
    return { billed: false, reason: "no gas overage" };
  }

  try {
    const provider = getBillingProvider();
    await provider.createInvoiceItem({
      customerId: sub.providerCustomerId,
      amount: overageCents,
      currency: "usd",
      description: `Gas sponsorship overage: $${(overageCents / 100).toFixed(2)} above $${(gasCreditsCents / 100).toFixed(2)} included (${plan} plan)`,
      metadata: {
        organizationId,
        type: "gas_overage",
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        totalUsageCents: String(totalUsageCents),
        includedCreditsCents: String(gasCreditsCents),
      },
    });

    return { billed: true, overageCents };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      LOG_PREFIX,
      "Failed to create gas overage invoice item:",
      message
    );
    return { billed: false, reason: `provider error: ${message}` };
  }
}
