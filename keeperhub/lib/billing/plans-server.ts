import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationSubscriptions } from "@/lib/db/schema";
import {
  getPlanLimits,
  PLANS,
  type PlanLimits,
  type PlanName,
  type TierKey,
} from "./plans";

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
