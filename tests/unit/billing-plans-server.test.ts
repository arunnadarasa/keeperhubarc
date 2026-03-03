import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

vi.mock("server-only", () => ({}));

(db as any).execute = vi.fn();

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
  vi.mocked((db as any).execute).mockResolvedValue(rows);
}

import {
  checkExecutionLimit,
  checkFeatureAccess,
  getOrgPlan,
  getOrgSubscription,
} from "@/keeperhub/lib/billing/plans-server";

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(result).toEqual({ allowed: true, isOverage: false });
  });

  it("allows free plan when under limit", async () => {
    mockSelectReturning([]);
    mockExecuteReturning([{ count: 100 }]);

    const result = await checkExecutionLimit("org_1");
    expect(result).toEqual({ allowed: true, isOverage: false });
  });

  it("allows pro plan within limits without overage flag", async () => {
    mockSelectReturning([{ plan: "pro", tier: "25k", status: "active" }]);
    mockExecuteReturning([{ count: 1000 }]);

    const result = await checkExecutionLimit("org_1");
    expect(result).toEqual({ allowed: true, isOverage: false });
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
    });
  });
});
