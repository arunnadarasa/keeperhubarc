import type {
  BillingInterval,
  PLANS,
  PlanName,
  TierKey,
} from "@/lib/billing/plans";

export type PricingTableProps = {
  currentPlan?: PlanName;
  currentTier?: TierKey | null;
  currentInterval?: BillingInterval | null;
  onPlanUpdated?: () => Promise<void>;
};

export type PlanTierItem = (typeof PLANS)[PlanName]["tiers"][number];
