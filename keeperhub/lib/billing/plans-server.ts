import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationSubscriptions } from "@/lib/db/schema";
import {
  type BillingInterval,
  getPlanLimits,
  PLANS,
  type PlanLimits,
  type PlanName,
  type TierKey,
} from "./plans";

// -- Price ID mapping (server-only, env vars not available in client bundles) --

const PRICE_IDS: Record<string, string | undefined> = {
  pro_25k_monthly: process.env.STRIPE_PRICE_PRO_25K_MONTHLY,
  pro_25k_yearly: process.env.STRIPE_PRICE_PRO_25K_YEARLY,
  pro_50k_monthly: process.env.STRIPE_PRICE_PRO_50K_MONTHLY,
  pro_50k_yearly: process.env.STRIPE_PRICE_PRO_50K_YEARLY,
  pro_100k_monthly: process.env.STRIPE_PRICE_PRO_100K_MONTHLY,
  pro_100k_yearly: process.env.STRIPE_PRICE_PRO_100K_YEARLY,
  business_250k_monthly: process.env.STRIPE_PRICE_BUSINESS_250K_MONTHLY,
  business_250k_yearly: process.env.STRIPE_PRICE_BUSINESS_250K_YEARLY,
  business_500k_monthly: process.env.STRIPE_PRICE_BUSINESS_500K_MONTHLY,
  business_500k_yearly: process.env.STRIPE_PRICE_BUSINESS_500K_YEARLY,
  business_1m_monthly: process.env.STRIPE_PRICE_BUSINESS_1M_MONTHLY,
  business_1m_yearly: process.env.STRIPE_PRICE_BUSINESS_1M_YEARLY,
  enterprise_monthly: process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY,
  enterprise_yearly: process.env.STRIPE_PRICE_ENTERPRISE_YEARLY,
};

export function getPriceId(
  plan: PlanName,
  tier: TierKey | null,
  interval: BillingInterval
): string | undefined {
  if (plan === "enterprise") {
    return PRICE_IDS[`enterprise_${interval}`];
  }
  if (tier === null) {
    return undefined;
  }
  return PRICE_IDS[`${plan}_${tier}_${interval}`];
}

export function resolvePriceId(priceId: string):
  | {
      plan: PlanName;
      tier: TierKey | null;
      interval: BillingInterval | null;
    }
  | undefined {
  for (const [key, value] of Object.entries(PRICE_IDS)) {
    if (value === priceId) {
      const parts = key.split("_");
      const plan = parts[0] as PlanName;
      if (plan === "enterprise") {
        const interval = (parts[1] as BillingInterval) ?? null;
        return { plan, tier: null, interval };
      }
      const tier = parts[1] as TierKey;
      const interval = (parts[2] as BillingInterval) ?? null;
      return { plan, tier, interval };
    }
  }
  return undefined;
}

export async function getOrgSubscription(
  organizationId: string
): Promise<typeof organizationSubscriptions.$inferSelect | undefined> {
  const rows = await db
    .select()
    .from(organizationSubscriptions)
    .where(eq(organizationSubscriptions.organizationId, organizationId))
    .limit(1);
  return rows[0];
}

export async function getOrgPlan(organizationId: string): Promise<PlanName> {
  const sub = await getOrgSubscription(organizationId);
  if (!sub) {
    return "free";
  }
  return sub.plan as PlanName;
}

export async function checkFeatureAccess(
  organizationId: string,
  feature: keyof PlanLimits
): Promise<boolean> {
  const sub = await getOrgSubscription(organizationId);
  const plan = (sub?.plan ?? "free") as PlanName;
  const limits = getPlanLimits(plan, sub?.tier as TierKey | null);

  const value = limits[feature];
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    return value !== "rate-limited";
  }
  return value !== null;
}

/**
 * Check if an organization has exceeded its monthly execution limit.
 * Returns { allowed: true } or { allowed: false, limit, used }.
 */
export async function checkExecutionLimit(
  organizationId: string
): Promise<
  { allowed: true } | { allowed: false; limit: number; used: number }
> {
  const sub = await getOrgSubscription(organizationId);
  const plan = (sub?.plan ?? "free") as PlanName;
  const tier = (sub?.tier ?? null) as TierKey | null;
  const limits = getPlanLimits(plan, tier);

  if (limits.maxExecutionsPerMonth === -1) {
    return { allowed: true };
  }

  const planDef = PLANS[plan];
  if (planDef.overage.enabled && sub?.status === "active") {
    return { allowed: true };
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const result = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int as count FROM workflow_runs
        WHERE organization_id = ${organizationId}
        AND created_at >= ${startOfMonth.toISOString()}`
  );

  const used = result[0]?.count ?? 0;

  if (used >= limits.maxExecutionsPerMonth) {
    return { allowed: false, limit: limits.maxExecutionsPerMonth, used };
  }

  return { allowed: true };
}
