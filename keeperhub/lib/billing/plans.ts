// Client-safe plan definitions and utilities.
// No server-side imports (db, drizzle) allowed here.
// Server-only query helpers are in plans-server.ts.

// -- Types --

export type PlanName = "free" | "pro" | "business" | "enterprise";

export type TierKey = "25k" | "50k" | "100k" | "250k" | "500k" | "1m";

type PlanTier = {
  key: TierKey;
  executions: number;
  monthlyPrice: number;
  yearlyPrice: number;
};

export type PlanLimits = {
  maxExecutionsPerMonth: number;
  gasCreditsCents: number;
  maxWorkflows: number; // -1 = unlimited
  apiAccess: "rate-limited" | "full";
  logRetentionDays: number;
  supportLevel: "community" | "email-48h" | "dedicated-12h" | "dedicated-1h";
  sla: string | null;
};

type OverageConfig = {
  enabled: boolean;
  ratePerThousand: number;
};

type PlanDefinition = {
  name: string;
  description: string;
  features: PlanLimits;
  tiers: PlanTier[];
  overage: OverageConfig;
};

// -- Price ID mapping --

export type BillingInterval = "monthly" | "yearly";

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

/**
 * Resolve a Stripe price ID back to the plan name and tier.
 * Returns undefined if the price ID is not recognized.
 */
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
        // enterprise_monthly or enterprise_yearly
        const interval = (parts[1] as BillingInterval) ?? null;
        return { plan, tier: null, interval };
      }
      // e.g. "pro_25k_monthly" -> tier = "25k", interval = "monthly"
      const tier = parts[1] as TierKey;
      const interval = (parts[2] as BillingInterval) ?? null;
      return { plan, tier, interval };
    }
  }
  return undefined;
}

// -- Plan definitions --

export const PLANS: Record<PlanName, PlanDefinition> = {
  free: {
    name: "Free",
    description: "Get started with Web3 automation",
    features: {
      maxExecutionsPerMonth: 5000,
      gasCreditsCents: 100,
      maxWorkflows: -1,
      apiAccess: "rate-limited",
      logRetentionDays: 7,
      supportLevel: "community",
      sla: null,
    },
    tiers: [],
    overage: { enabled: false, ratePerThousand: 0 },
  },
  pro: {
    name: "Pro",
    description: "Scale your automation workflows",
    features: {
      maxExecutionsPerMonth: 25_000,
      gasCreditsCents: 500,
      maxWorkflows: -1,
      apiAccess: "full",
      logRetentionDays: 30,
      supportLevel: "email-48h",
      sla: null,
    },
    tiers: [
      { key: "25k", executions: 25_000, monthlyPrice: 49, yearlyPrice: 39 },
      { key: "50k", executions: 50_000, monthlyPrice: 89, yearlyPrice: 71 },
      { key: "100k", executions: 100_000, monthlyPrice: 149, yearlyPrice: 119 },
    ],
    overage: { enabled: true, ratePerThousand: 2 },
  },
  business: {
    name: "Business",
    description: "Enterprise-grade automation at scale",
    features: {
      maxExecutionsPerMonth: 250_000,
      gasCreditsCents: 2500,
      maxWorkflows: -1,
      apiAccess: "full",
      logRetentionDays: 90,
      supportLevel: "dedicated-12h",
      sla: "99.9%",
    },
    tiers: [
      {
        key: "250k",
        executions: 250_000,
        monthlyPrice: 299,
        yearlyPrice: 239,
      },
      {
        key: "500k",
        executions: 500_000,
        monthlyPrice: 499,
        yearlyPrice: 399,
      },
      {
        key: "1m",
        executions: 1_000_000,
        monthlyPrice: 899,
        yearlyPrice: 719,
      },
    ],
    overage: { enabled: true, ratePerThousand: 1.5 },
  },
  enterprise: {
    name: "Enterprise",
    description: "Custom solutions for large organizations",
    features: {
      maxExecutionsPerMonth: -1,
      gasCreditsCents: 10_000,
      maxWorkflows: -1,
      apiAccess: "full",
      logRetentionDays: 365,
      supportLevel: "dedicated-1h",
      sla: "99.99%",
    },
    tiers: [],
    overage: { enabled: false, ratePerThousand: 0 },
  },
} as const;

// -- Shared helpers (no DB) --

export function getPlanLimits(
  plan: PlanName,
  tier?: TierKey | null
): PlanLimits {
  const planDef = PLANS[plan];
  const limits = { ...planDef.features };

  if (tier && planDef.tiers.length > 0) {
    const selectedTier = planDef.tiers.find((t) => t.key === tier);
    if (selectedTier) {
      limits.maxExecutionsPerMonth = selectedTier.executions;
    }
  }

  return limits;
}
