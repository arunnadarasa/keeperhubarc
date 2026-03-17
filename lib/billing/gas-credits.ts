import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  gasCreditAllocations,
  gasCreditUsage,
} from "@/keeperhub/db/schema-extensions";
import { db } from "@/lib/db";
import { isBillingEnabled } from "./feature-flag";
import { getPlanLimits, type PlanName, parsePlanName } from "./plans";
import { getOrgSubscription } from "./plans-server";

const MICRO_USD_PER_CENT = 10_000;

const PLAN_ENV_KEYS: Record<PlanName, string> = {
  free: "GAS_CREDITS_FREE_CENTS",
  pro: "GAS_CREDITS_PRO_CENTS",
  business: "GAS_CREDITS_BUSINESS_CENTS",
  enterprise: "GAS_CREDITS_ENTERPRISE_CENTS",
};

/**
 * Get the gas credit cap for a plan, preferring env var override.
 * Falls back to the hardcoded plan default if the env var is unset or invalid.
 */
export function getGasCreditCapCents(plan: PlanName): number {
  const envVal = process.env[PLAN_ENV_KEYS[plan]];
  if (envVal !== undefined && envVal !== "") {
    const parsed = Number(envVal);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return getPlanLimits(plan).gasCreditsCents;
}

/**
 * Get the current gas credit caps for all plans (env-driven with fallbacks).
 * Intended for API responses so the UI can display accurate values.
 */
export function getGasCreditCaps(): Record<PlanName, number> {
  return {
    free: getGasCreditCapCents("free"),
    pro: getGasCreditCapCents("pro"),
    business: getGasCreditCapCents("business"),
    enterprise: getGasCreditCapCents("enterprise"),
  };
}

type GasCreditBalance = {
  totalCents: number;
  usedCents: number;
  remainingCents: number;
  plan: string;
};

type GasCreditCheckResult =
  | { allowed: true; remainingCents: number }
  | { allowed: false; reason: string };

/**
 * Resolve the gas credit allocation for an org in the current billing period.
 *
 * On first call per period, snapshots the current env-driven cap to the DB.
 * Subsequent calls in the same period return the persisted value, ensuring
 * mid-period env changes don't affect existing orgs.
 */
async function resolveAllocation(
  organizationId: string,
  planName: PlanName,
  periodStart: Date
): Promise<number> {
  const existing = await db
    .select({ allocatedCents: gasCreditAllocations.allocatedCents })
    .from(gasCreditAllocations)
    .where(
      and(
        eq(gasCreditAllocations.organizationId, organizationId),
        eq(gasCreditAllocations.periodStart, periodStart)
      )
    )
    .limit(1);

  if (existing[0] !== undefined) {
    return existing[0].allocatedCents;
  }

  const capCents = getGasCreditCapCents(planName);

  await db
    .insert(gasCreditAllocations)
    .values({
      organizationId,
      periodStart,
      allocatedCents: capCents,
    })
    .onConflictDoNothing();

  const inserted = await db
    .select({ allocatedCents: gasCreditAllocations.allocatedCents })
    .from(gasCreditAllocations)
    .where(
      and(
        eq(gasCreditAllocations.organizationId, organizationId),
        eq(gasCreditAllocations.periodStart, periodStart)
      )
    )
    .limit(1);

  return inserted[0]?.allocatedCents ?? capCents;
}

/**
 * Get the gas credit balance for an organization in the current billing period.
 *
 * Computes: persisted allocation - sum of gas_cost_micro_usd since period start.
 * If no subscription exists, uses the free plan defaults.
 */
export async function getGasCreditBalance(
  organizationId: string
): Promise<GasCreditBalance> {
  const sub = await getOrgSubscription(organizationId);
  const planName = parsePlanName(sub?.plan);
  const periodStart = sub?.currentPeriodStart ?? getDefaultPeriodStart();

  const totalCents = await resolveAllocation(
    organizationId,
    planName,
    periodStart
  );

  const result = await db
    .select({
      total: sql<string>`coalesce(sum(${gasCreditUsage.gasCostMicroUsd}::bigint), 0)::text`,
    })
    .from(gasCreditUsage)
    .where(
      and(
        eq(gasCreditUsage.organizationId, organizationId),
        gte(gasCreditUsage.createdAt, periodStart)
      )
    );

  const usedMicroUsd = Number(result[0]?.total ?? "0");
  const usedCents = Math.ceil(usedMicroUsd / MICRO_USD_PER_CENT);
  const remainingCents = Math.max(0, totalCents - usedCents);

  return { totalCents, usedCents, remainingCents, plan: planName };
}

/**
 * Check if an organization has gas credits available for sponsorship.
 *
 * Returns { allowed: true } if billing is disabled (sponsorship is free)
 * or if credits remain. Returns { allowed: false } if credits are exhausted
 * for any plan (all plans block at cap, falling back to direct signing).
 */
export async function checkGasCredits(
  organizationId: string
): Promise<GasCreditCheckResult> {
  if (!isBillingEnabled()) {
    return { allowed: true, remainingCents: Number.MAX_SAFE_INTEGER };
  }

  const balance = await getGasCreditBalance(organizationId);

  if (balance.remainingCents > 0) {
    return { allowed: true, remainingCents: balance.remainingCents };
  }

  return {
    allowed: false,
    reason: "Gas credits exhausted for current billing period",
  };
}

type RecordGasUsageParams = {
  organizationId: string;
  chainId: number;
  txHash: string;
  executionId: string | undefined;
  gasUsed: bigint;
  gasPrice: bigint;
  ethPriceUsd: number;
};

/**
 * Record gas usage for a sponsored transaction.
 *
 * Converts gas cost from wei to micro-USD (1/1,000,000 of a dollar) for
 * sub-cent precision on L2s. Idempotent via unique constraint on
 * (organizationId, txHash).
 */
export async function recordGasUsage(
  params: RecordGasUsageParams
): Promise<void> {
  const gasCostWei = params.gasUsed * params.gasPrice;
  const gasCostEth = Number(gasCostWei) / 1e18;
  const gasCostMicroUsd = Math.ceil(
    gasCostEth * params.ethPriceUsd * 1_000_000
  );

  await db
    .insert(gasCreditUsage)
    .values({
      organizationId: params.organizationId,
      chainId: params.chainId,
      txHash: params.txHash,
      executionId: params.executionId,
      gasUsed: params.gasUsed.toString(),
      gasPriceWei: params.gasPrice.toString(),
      gasCostWei: gasCostWei.toString(),
      gasCostMicroUsd: gasCostMicroUsd.toString(),
      ethPriceUsd: params.ethPriceUsd.toString(),
    })
    .onConflictDoNothing();
}

// ETH price cache (60-second TTL to avoid rate limits)
let cachedEthPrice: { usd: number; fetchedAt: number } | undefined;
const ETH_PRICE_CACHE_TTL_MS = 60_000;

/**
 * Fetch current ETH/USD price from CoinGecko.
 * Results are cached for 60 seconds to avoid rate limits.
 * Returns the cached price (even if stale) on fetch failure.
 */
export async function getEthPriceUsd(): Promise<number> {
  const now = Date.now();

  if (
    cachedEthPrice !== undefined &&
    now - cachedEthPrice.fetchedAt < ETH_PRICE_CACHE_TTL_MS
  ) {
    return cachedEthPrice.usd;
  }

  try {
    const response = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );

    if (!response.ok) {
      throw new Error(`CoinGecko returned ${response.status}`);
    }

    const data: unknown = await response.json();
    const price = (data as { ethereum?: { usd?: number } })?.ethereum?.usd;

    if (typeof price !== "number" || price <= 0) {
      throw new Error("Invalid ETH price from CoinGecko");
    }

    cachedEthPrice = { usd: price, fetchedAt: now };
    return price;
  } catch {
    // Return stale cache if available
    if (cachedEthPrice !== undefined) {
      return cachedEthPrice.usd;
    }
    // Last resort fallback -- conservative estimate to avoid undercharging
    return 3000;
  }
}

/**
 * Default billing period start for orgs without a subscription.
 * Uses the 1st of the current month.
 */
function getDefaultPeriodStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
