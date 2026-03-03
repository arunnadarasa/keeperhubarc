import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getPlanLimits, PLANS, type PlanName, type TierKey } from "./plans";
import { getOrgSubscription } from "./plans-server";

export type UpgradeSuggestion =
  | { shouldUpgrade: false }
  | {
      shouldUpgrade: true;
      currentPlan: PlanName;
      currentTier: TierKey | null;
      currentLimit: number;
      currentUsage: number;
      usagePercent: number;
      suggestedPlan: PlanName;
      suggestedTier: TierKey;
      suggestedLimit: number;
      monthlySavings: number;
    };

/**
 * Analyze current usage and suggest a tier upgrade if cost-effective.
 *
 * Returns a suggestion when:
 * - Usage exceeds 80% of the current limit
 * - A higher tier exists that would reduce projected overage costs
 */
export async function getUpgradeSuggestion(
  organizationId: string
): Promise<UpgradeSuggestion> {
  const sub = await getOrgSubscription(organizationId);
  const plan = (sub?.plan ?? "free") as PlanName;
  const tier = (sub?.tier ?? null) as TierKey | null;
  const limits = getPlanLimits(plan, tier);

  if (limits.maxExecutionsPerMonth === -1) {
    return { shouldUpgrade: false };
  }

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

  const currentUsage = result[0]?.count ?? 0;
  const usagePercent = (currentUsage / limits.maxExecutionsPerMonth) * 100;

  if (usagePercent < 80) {
    return { shouldUpgrade: false };
  }

  // Project full-month usage based on days elapsed
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0
  ).getDate();
  const projectedUsage = Math.ceil((currentUsage / dayOfMonth) * daysInMonth);

  // Find the best upgrade option across all plans and tiers
  const suggestion = findBestUpgrade(
    plan,
    tier,
    limits.maxExecutionsPerMonth,
    projectedUsage
  );

  if (!suggestion) {
    return { shouldUpgrade: false };
  }

  return {
    shouldUpgrade: true,
    currentPlan: plan,
    currentTier: tier,
    currentLimit: limits.maxExecutionsPerMonth,
    currentUsage,
    usagePercent: Math.round(usagePercent),
    suggestedPlan: suggestion.plan,
    suggestedTier: suggestion.tier,
    suggestedLimit: suggestion.limit,
    monthlySavings: suggestion.savings,
  };
}

type UpgradeOption = {
  plan: PlanName;
  tier: TierKey;
  limit: number;
  savings: number;
};

type PlanTierDef = (typeof PLANS)[PlanName]["tiers"][number];
type PlanDef = (typeof PLANS)[PlanName];

function calculateOverageCostCents(overage: number, planDef: PlanDef): number {
  if (!planDef.overage.enabled || overage <= 0) {
    return 0;
  }
  return Math.ceil(overage / 1000) * planDef.overage.ratePerThousand * 100;
}

function calculateTierSavings(
  tierDef: PlanTierDef,
  planDef: PlanDef,
  projectedUsage: number,
  currentTotalCost: number
): number {
  const tierOverage = Math.max(0, projectedUsage - tierDef.executions);
  const overageCost = calculateOverageCostCents(tierOverage, planDef);
  const totalNewCost = tierDef.monthlyPrice * 100 + overageCost;
  return currentTotalCost - totalNewCost;
}

function findBestUpgrade(
  currentPlan: PlanName,
  currentTier: TierKey | null,
  currentLimit: number,
  projectedUsage: number
): UpgradeOption | undefined {
  const currentPlanDef = PLANS[currentPlan];
  const projectedOverage = Math.max(0, projectedUsage - currentLimit);

  if (projectedOverage === 0) {
    return undefined;
  }

  const currentOverageCost = calculateOverageCostCents(
    projectedOverage,
    currentPlanDef
  );
  const currentTierDef = currentPlanDef.tiers.find(
    (t) => t.key === currentTier
  );
  const currentTotalCost =
    (currentTierDef?.monthlyPrice ?? 0) * 100 + currentOverageCost;

  let bestOption: UpgradeOption | undefined;
  let bestSavings = 0;

  const plansToCheck: PlanName[] = ["pro", "business"];

  for (const planName of plansToCheck) {
    const planDef = PLANS[planName];

    for (const tierDef of planDef.tiers) {
      if (tierDef.executions <= currentLimit) {
        continue;
      }

      const savings = calculateTierSavings(
        tierDef,
        planDef,
        projectedUsage,
        currentTotalCost
      );

      if (savings > bestSavings) {
        bestSavings = savings;
        bestOption = {
          plan: planName,
          tier: tierDef.key,
          limit: tierDef.executions,
          savings: Math.round(savings),
        };
      }
    }
  }

  if (!bestOption || bestOption.savings <= 0) {
    return undefined;
  }

  return bestOption;
}
