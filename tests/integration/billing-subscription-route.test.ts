import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

const mockGetSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
    },
  },
}));

const mockSelectLimit = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockSelectLimit,
        })),
      })),
    })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  organizationSubscriptions: { organizationId: "organizationId" },
}));

import { GET } from "@/keeperhub/api/billing/subscription/route";

function mockSession(): void {
  mockGetSession.mockResolvedValue({
    user: { id: "usr_1", email: "user@test.com" },
    session: { activeOrganizationId: "org_1" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_BILLING_ENABLED = "true";
});

describe("GET /api/billing/subscription", () => {
  it("returns subscription data with limits", async () => {
    mockSession();
    mockSelectLimit.mockResolvedValue([
      {
        plan: "pro",
        tier: "25k",
        status: "active",
        providerPriceId: process.env.STRIPE_PRICE_PRO_25K_MONTHLY,
        currentPeriodStart: new Date("2025-01-01"),
        currentPeriodEnd: new Date("2025-02-01"),
        cancelAtPeriodEnd: false,
        billingAlert: null,
        billingAlertUrl: null,
      },
    ]);

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.subscription.plan).toBe("pro");
    expect(json.subscription.tier).toBe("25k");
    expect(json.subscription.interval).toBe("monthly");
    expect(json.subscription.status).toBe("active");
    expect(json.limits).toBeDefined();
    expect(json.limits.maxExecutionsPerMonth).toBe(25_000);
  });

  it("returns free plan when no subscription", async () => {
    mockSession();
    mockSelectLimit.mockResolvedValue([]);

    const response = await GET();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.subscription.plan).toBe("free");
    expect(json.subscription.status).toBe("active");
    expect(json.limits.maxExecutionsPerMonth).toBe(5000);
  });

  it("returns 401 without auth", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns 404 when billing is disabled", async () => {
    process.env.NEXT_PUBLIC_BILLING_ENABLED = "false";

    const response = await GET();

    expect(response.status).toBe(404);
  });
});
