import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationSubscriptions } from "@/lib/db/schema";
import { getActiveDebtExecutions } from "./execution-debt";
import {
  type BillingInterval,
  getPlanLimits,
  PLANS,
  type PlanLimits,
  type PlanName,
  type TierKey,
} from "./plans";

const MINIMUM_EXECUTION_FLOOR = 100;

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

/** Within limits or unlimited plan -- no action needed. */
export type ExecutionWithinLimits = {
  allowed: true;
  isOverage: false;
  debtExecutions: number;
  effectiveLimit: number;
};

/** Paid plan exceeded its included limit -- execution proceeds, billed later. */
export type ExecutionOverageAllowed = {
  allowed: true;
  isOverage: true;
  limit: number;
  used: number;
  overageRate: number;
  debtExecutions: number;
  effectiveLimit: number;
};

/** Free plan limit exhausted -- execution must be blocked. */
export type ExecutionLimitExceeded = {
  allowed: false;
  limit: number;
  used: number;
  plan: PlanName;
  debtExecutions: number;
  effectiveLimit: number;
};

export type ExecutionLimitResult =
  | ExecutionWithinLimits
  | ExecutionOverageAllowed
  | ExecutionLimitExceeded;

/**
 * Check if an organization has exceeded its monthly execution limit.
 *
 * Returns one of:
 * - allowed + not overage (within limits or unlimited plan)
 * - allowed + overage (paid plan with overage enabled, will be billed later)
 * - not allowed (free plan limit exceeded)
 *
 * NOTE: This is a point-in-time check (TOCTOU). The caller does not hold a lock,
 * so concurrent requests may each pass the check before any execution is recorded.
 * The resulting overshoot is bounded by request concurrency and is acceptable:
 * paid plans are backstopped by overage billing, free plans by a small bounded excess.
 */
export async function checkExecutionLimit(
  organizationId: string
): Promise<ExecutionLimitResult> {
  const sub = await getOrgSubscription(organizationId);
  const plan = (sub?.plan ?? "free") as PlanName;
  const tier = (sub?.tier ?? null) as TierKey | null;
  const limits = getPlanLimits(plan, tier);

  if (limits.maxExecutionsPerMonth === -1) {
    return {
      allowed: true,
      isOverage: false,
      debtExecutions: 0,
      effectiveLimit: -1,
    };
  }

  const debtExecutions = await getActiveDebtExecutions(organizationId);
  const effectiveLimit = Math.max(
    MINIMUM_EXECUTION_FLOOR,
    limits.maxExecutionsPerMonth - debtExecutions
  );

  const now = new Date();
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );

  const result = await db.execute<{ count: number }>(
    sql`SELECT COUNT(*)::int as count
        FROM workflow_executions we
        JOIN workflows w ON we.workflow_id = w.id
        WHERE w.organization_id = ${organizationId}
        AND we.started_at >= ${startOfMonth.toISOString()}`
  );

  const used = result[0]?.count ?? 0;

  // Under the debt-adjusted limit: always allowed, no overage
  if (used < effectiveLimit) {
    return {
      allowed: true,
      isOverage: false,
      debtExecutions,
      effectiveLimit,
    };
  }

  // Between effectiveLimit and plan limit: blocked (debt penalty zone).
  // Between plan limit and infinity: overage if paid+active, else blocked.
  const planDef = PLANS[plan];
  const overPlanLimit = used >= limits.maxExecutionsPerMonth;

  if (overPlanLimit && planDef.overage.enabled && sub?.status === "active") {
    return {
      allowed: true,
      isOverage: true,
      limit: limits.maxExecutionsPerMonth,
      used,
      overageRate: planDef.overage.ratePerThousand,
      debtExecutions,
      effectiveLimit,
    };
  }

  return {
    allowed: false,
    limit: limits.maxExecutionsPerMonth,
    used,
    plan,
    debtExecutions,
    effectiveLimit,
  };
}
