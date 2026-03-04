import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("server-only", () => ({}));

const mockGetActiveDebtExecutions = vi.fn().mockResolvedValue(0);

vi.mock("@/keeperhub/lib/billing/execution-debt", () => ({
  getActiveDebtExecutions: (...args: unknown[]) =>
    mockGetActiveDebtExecutions(...args),
}));

const mockExecute = vi.fn();
Object.assign(db, { execute: mockExecute });

function mockSelectReturning(rows: Record<string, unknown>[]): void {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  } as unknown as ReturnType<typeof db.select>);
}

function mockExecuteReturning(rows: Record<string, unknown>[]): void {
  mockExecute.mockResolvedValue(rows);
}

import type {
  BillingInterval,
  PlanName,
  TierKey,
} from "@/keeperhub/lib/billing/plans";
import {
  checkExecutionLimit,
  checkFeatureAccess,
  getOrgPlan,
  getOrgSubscription,
  getPriceId,
  resolvePriceId,
} from "@/keeperhub/lib/billing/plans-server";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveDebtExecutions.mockResolvedValue(0);
});

describe("getOrgSubscription", () => {
  it("returns subscription row when found", async () => {
    const row = { id: "sub_1", plan: "pro", tier: "25k", status: "active" };
    mockSelectReturning([row]);

    const result = await getOrgSubscription("org_1");
    expect(result).toEqual(row);
  });

  it("returns undefined when no subscription exists", async () => {
    mockSelectReturning([]);

    const result = await getOrgSubscription("org_1");
    expect(result).toBeUndefined();
  });
});

describe("getOrgPlan", () => {
  it("returns plan name from subscription", async () => {
    mockSelectReturning([{ plan: "business" }]);

    const result = await getOrgPlan("org_1");
    expect(result).toBe("business");
  });

  it("returns 'free' when no subscription", async () => {
    mockSelectReturning([]);

    const result = await getOrgPlan("org_1");
    expect(result).toBe("free");
  });
});

describe("checkFeatureAccess", () => {
  it("returns true for full apiAccess on pro plan", async () => {
    mockSelectReturning([{ plan: "pro", tier: "25k" }]);

    const result = await checkFeatureAccess("org_1", "apiAccess");
    expect(result).toBe(true);
  });

  it("returns false for rate-limited apiAccess on free plan", async () => {
    mockSelectReturning([]);

    const result = await checkFeatureAccess("org_1", "apiAccess");
    expect(result).toBe(false);
  });

  it("returns true for numeric feature with non-zero value", async () => {
    mockSelectReturning([{ plan: "pro", tier: "25k" }]);

    const result = await checkFeatureAccess("org_1", "logRetentionDays");
    expect(result).toBe(true);
  });

  it("returns true for non-null SLA on business plan", async () => {
    mockSelectReturning([{ plan: "business", tier: "250k" }]);

    const result = await checkFeatureAccess("org_1", "sla");
    expect(result).toBe(true);
  });

  it("returns false for null SLA on free plan", async () => {
    mockSelectReturning([]);

    const result = await checkFeatureAccess("org_1", "sla");
    expect(result).toBe(false);
  });
});

describe("checkExecutionLimit", () => {
  it("allows unlimited plans (enterprise)", async () => {
    mockSelectReturning([{ plan: "enterprise", tier: null, status: "active" }]);

    const result = await checkExecutionLimit("org_1");
    expect(result).toEqual({
      allowed: true,
      isOverage: false,
      debtExecutions: 0,
      effectiveLimit: -1,
    });
  });

  it("allows free plan when under limit", async () => {
    mockSelectReturning([]);
    mockExecuteReturning([{ count: 100 }]);

    const result = await checkExecutionLimit("org_1");
    expect(result).toEqual({
      allowed: true,
      isOverage: false,
      debtExecutions: 0,
      effectiveLimit: 5000,
    });
  });

  it("allows pro plan within limits without overage flag", async () => {
    mockSelectReturning([{ plan: "pro", tier: "25k", status: "active" }]);
    mockExecuteReturning([{ count: 1000 }]);

    const result = await checkExecutionLimit("org_1");
    expect(result).toEqual({
      allowed: true,
      isOverage: false,
      debtExecutions: 0,
      effectiveLimit: 25_000,
    });
  });

  it("allows pro plan over limit with overage details", async () => {
    mockSelectReturning([{ plan: "pro", tier: "25k", status: "active" }]);
    mockExecuteReturning([{ count: 30_000 }]);

    const result = await checkExecutionLimit("org_1");
    expect(result).toEqual({
      allowed: true,
      isOverage: true,
      limit: 25_000,
      used: 30_000,
      overageRate: 2,
      debtExecutions: 0,
      effectiveLimit: 25_000,
    });
  });

  it("blocks free plan when at limit", async () => {
    mockSelectReturning([]);
    mockExecuteReturning([{ count: 5000 }]);

    const result = await checkExecutionLimit("org_1");
    expect(result).toEqual({
      allowed: false,
      limit: 5000,
      used: 5000,
      plan: "free",
      debtExecutions: 0,
      effectiveLimit: 5000,
    });
  });

  it("blocks free plan when over limit", async () => {
    mockSelectReturning([]);
    mockExecuteReturning([{ count: 6000 }]);

    const result = await checkExecutionLimit("org_1");
    expect(result).toEqual({
      allowed: false,
      limit: 5000,
      used: 6000,
      plan: "free",
      debtExecutions: 0,
      effectiveLimit: 5000,
    });
  });

  it("blocks paid plan when canceled (overage disabled)", async () => {
    mockSelectReturning([{ plan: "pro", tier: "25k", status: "canceled" }]);
    mockExecuteReturning([{ count: 30_000 }]);

    const result = await checkExecutionLimit("org_1");
    expect(result).toEqual({
      allowed: false,
      limit: 25_000,
      used: 30_000,
      plan: "pro",
      debtExecutions: 0,
      effectiveLimit: 25_000,
    });
  });

  it("reduces effective limit by debt executions", async () => {
    mockSelectReturning([{ plan: "pro", tier: "25k", status: "active" }]);
    mockGetActiveDebtExecutions.mockResolvedValue(5000);
    mockExecuteReturning([{ count: 21_000 }]);

    // 21k is above effectiveLimit (20k) but below plan limit (25k),
    // so the org is blocked in the debt penalty zone (not overage).
    const result = await checkExecutionLimit("org_1");

    expect(result).toEqual({
      allowed: false,
      limit: 25_000,
      used: 21_000,
      plan: "pro",
      debtExecutions: 5000,
      effectiveLimit: 20_000,
    });
  });

  it("blocks paid plan when active debt exists despite overage support", async () => {
    mockSelectReturning([{ plan: "pro", tier: "25k", status: "active" }]);
    mockGetActiveDebtExecutions.mockResolvedValue(5000);
    mockExecuteReturning([{ count: 26_000 }]);

    const result = await checkExecutionLimit("org_1");

    expect(result).toEqual({
      allowed: false,
      limit: 25_000,
      used: 26_000,
      plan: "pro",
      debtExecutions: 5000,
      effectiveLimit: 20_000,
    });
  });

  it("blocks paid plan with large debt even when usage is low", async () => {
    mockSelectReturning([{ plan: "pro", tier: "25k", status: "active" }]);
    mockGetActiveDebtExecutions.mockResolvedValue(30_000);
    mockExecuteReturning([{ count: 50 }]);

    const result = await checkExecutionLimit("org_1");

    expect(result).toEqual({
      allowed: false,
      limit: 25_000,
      used: 50,
      plan: "pro",
      debtExecutions: 30_000,
      effectiveLimit: 100,
    });
  });

  it("blocks when usage exceeds debt-reduced limit", async () => {
    mockSelectReturning([{ plan: "pro", tier: "25k", status: "canceled" }]);
    mockGetActiveDebtExecutions.mockResolvedValue(10_000);
    mockExecuteReturning([{ count: 16_000 }]);

    const result = await checkExecutionLimit("org_1");

    expect(result).toEqual({
      allowed: false,
      limit: 25_000,
      used: 16_000,
      plan: "pro",
      debtExecutions: 10_000,
      effectiveLimit: 15_000,
    });
  });
});

const hasStripeEnv = process.env.STRIPE_PRICE_PRO_25K_MONTHLY !== undefined;

describe("resolvePriceId", () => {
  it.skipIf(!hasStripeEnv)(
    "resolves a known tiered price ID back to plan, tier, and interval",
    () => {
      const priceId = String(process.env.STRIPE_PRICE_PRO_25K_MONTHLY);

      const resolved = resolvePriceId(priceId);
      expect(resolved).toEqual({
        plan: "pro",
        tier: "25k",
        interval: "monthly",
      });
    }
  );

  it.skipIf(!hasStripeEnv)(
    "resolves enterprise price ID with null tier",
    () => {
      const priceId = String(process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY);

      const resolved = resolvePriceId(priceId);
      expect(resolved).toEqual({
        plan: "enterprise",
        tier: null,
        interval: "monthly",
      });
    }
  );

  it("returns undefined for unknown price ID", () => {
    const resolved = resolvePriceId("price_unknown_xyz");
    expect(resolved).toBeUndefined();
  });

  it("every getPriceId result can be resolved back (no orphaned keys)", () => {
    const plans: PlanName[] = ["pro", "business", "enterprise"];
    const tiers: Array<TierKey | null> = [
      "25k",
      "50k",
      "100k",
      "250k",
      "500k",
      "1m",
      null,
    ];
    const intervals: BillingInterval[] = ["monthly", "yearly"];

    for (const plan of plans) {
      for (const tier of tiers) {
        for (const interval of intervals) {
          const priceId = getPriceId(plan, tier, interval);
          if (priceId === undefined) {
            continue;
          }
          const resolved = resolvePriceId(priceId);
          expect(resolved).toBeDefined();
          expect(resolved?.plan).toBe(plan);
        }
      }
    }
  });
});
