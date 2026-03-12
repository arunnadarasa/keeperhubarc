import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { gasCreditUsage } from "@/keeperhub/db/schema-extensions";
import { db } from "@/lib/db";
import { isBillingEnabled } from "./feature-flag";
import { getPlanLimits, parsePlanName, parseTierKey } from "./plans";
import { getOrgSubscription } from "./plans-server";

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
 * Get the gas credit balance for an organization in the current billing period.
 *
 * Computes: plan allowance - sum of gas_cost_usd_cents since period start.
 * If no subscription exists, uses the free plan defaults.
 */
export async function getGasCreditBalance(
  organizationId: string
): Promise<GasCreditBalance> {
  const sub = await getOrgSubscription(organizationId);
  const planName = parsePlanName(sub?.plan);
  const limits = getPlanLimits(planName, parseTierKey(sub?.tier));
  const totalCents = limits.gasCreditsCents;

  const periodStart = sub?.currentPeriodStart ?? getDefaultPeriodStart();

  const result = await db
    .select({
      total: sql<number>`coalesce(sum(${gasCreditUsage.gasCostUsdCents}), 0)`,
    })
    .from(gasCreditUsage)
    .where(
      and(
        eq(gasCreditUsage.organizationId, organizationId),
        gte(gasCreditUsage.createdAt, periodStart)
      )
    );

  const usedCents = Number(result[0]?.total ?? 0);
  const remainingCents = Math.max(0, totalCents - usedCents);

  return { totalCents, usedCents, remainingCents, plan: planName };
}

/**
 * Check if an organization has gas credits available for sponsorship.
 *
 * Returns { allowed: true } if billing is disabled (sponsorship is free)
 * or if credits remain. Returns { allowed: false } if credits are exhausted
 * on the free plan. Paid plans always return allowed (overage is billed later).
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

  // Paid plans allow overage (billed at month-end)
  if (balance.plan !== "free") {
    return { allowed: true, remainingCents: 0 };
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
 * Converts gas cost from wei to USD cents using the provided ETH price.
 * Idempotent via unique constraint on (organizationId, txHash).
 */
export async function recordGasUsage(
  params: RecordGasUsageParams
): Promise<void> {
  const gasCostWei = params.gasUsed * params.gasPrice;
  const gasCostEth = Number(gasCostWei) / 1e18;
  const gasCostUsdCents = Math.ceil(gasCostEth * params.ethPriceUsd * 100);

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
      gasCostUsdCents,
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
