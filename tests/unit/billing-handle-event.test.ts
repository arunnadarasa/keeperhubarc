import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { handleBillingEvent } from "@/keeperhub/lib/billing/handle-billing-event";
import type {
  BillingProvider,
  BillingWebhookEvent,
} from "@/keeperhub/lib/billing/provider";
import { db } from "@/lib/db";

const mockSet = vi.fn().mockReturnValue({ where: vi.fn() });
const mockWhere = vi.fn();

vi.mocked(db.update).mockReturnValue({
  set: mockSet,
} as unknown as ReturnType<typeof db.update>);

vi.mocked(db.select).mockReturnValue({
  from: vi.fn().mockReturnValue({
    where: vi.fn().mockReturnValue({
      limit: vi.fn().mockResolvedValue([]),
    }),
  }),
} as unknown as ReturnType<typeof db.select>);

function mockSelectReturning(rows: Record<string, unknown>[]): void {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  } as unknown as ReturnType<typeof db.select>);
}

function createMockProvider(
  overrides: Partial<BillingProvider> = {}
): BillingProvider {
  return {
    name: "test",
    createCustomer: vi.fn(),
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
    verifyWebhook: vi.fn(),
    getSubscriptionDetails: vi.fn().mockResolvedValue({
      priceId: process.env.STRIPE_PRICE_PRO_25K_MONTHLY,
      status: "active",
      cancelAtPeriodEnd: false,
      periodStart: new Date("2025-01-01"),
      periodEnd: new Date("2025-02-01"),
    }),
    listInvoices: vi.fn(),
    updateSubscription: vi.fn(),
    cancelSubscription: vi.fn(),
    previewProration: vi.fn(),
    ...overrides,
  };
}

function makeEvent(
  type: BillingWebhookEvent["type"],
  data: BillingWebhookEvent["data"]
): BillingWebhookEvent {
  return { type, providerEventId: `evt_${type}`, data };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSet.mockReturnValue({ where: mockWhere });
});

describe("handleBillingEvent", () => {
  describe("checkout.completed", () => {
    it("updates subscription with resolved plan and tier", async () => {
      const provider = createMockProvider();
      const event = makeEvent("checkout.completed", {
        organizationId: "org_1",
        providerSubscriptionId: "sub_1",
      });

      await handleBillingEvent(event, provider);

      expect(provider.getSubscriptionDetails).toHaveBeenCalledWith("sub_1");
      expect(db.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          providerSubscriptionId: "sub_1",
          plan: "pro",
          tier: "25k",
          status: "active",
        })
      );
    });

    it("skips when organizationId is missing", async () => {
      const provider = createMockProvider();
      const event = makeEvent("checkout.completed", {
        providerSubscriptionId: "sub_1",
      });

      await handleBillingEvent(event, provider);

      expect(provider.getSubscriptionDetails).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });

    it("skips when providerSubscriptionId is missing", async () => {
      const provider = createMockProvider();
      const event = makeEvent("checkout.completed", {
        organizationId: "org_1",
      });

      await handleBillingEvent(event, provider);

      expect(provider.getSubscriptionDetails).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
    });

    it("returns early when priceId cannot be resolved", async () => {
      const provider = createMockProvider({
        getSubscriptionDetails: vi.fn().mockResolvedValue({
          priceId: "price_unknown_xyz",
          status: "active",
          cancelAtPeriodEnd: false,
          periodStart: new Date("2025-01-01"),
          periodEnd: new Date("2025-02-01"),
        }),
      });
      const event = makeEvent("checkout.completed", {
        organizationId: "org_1",
        providerSubscriptionId: "sub_1",
      });

      await handleBillingEvent(event, provider);

      expect(provider.getSubscriptionDetails).toHaveBeenCalledWith("sub_1");
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe("subscription.updated", () => {
    it("updates plan when price changes", async () => {
      mockSelectReturning([
        {
          providerSubscriptionId: "sub_1",
          providerPriceId: process.env.STRIPE_PRICE_PRO_25K_MONTHLY,
          plan: "pro",
          tier: "25k",
          status: "active",
          cancelAtPeriodEnd: false,
          currentPeriodStart: new Date("2025-01-01"),
          currentPeriodEnd: new Date("2025-02-01"),
        },
      ]);

      const provider = createMockProvider();
      const event = makeEvent("subscription.updated", {
        providerSubscriptionId: "sub_1",
        priceId: process.env.STRIPE_PRICE_PRO_50K_MONTHLY,
        status: "active",
        cancelAtPeriodEnd: false,
        periodStart: new Date("2025-01-01"),
        periodEnd: new Date("2025-02-01"),
      });

      await handleBillingEvent(event, provider);

      expect(db.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: "pro",
          tier: "50k",
          providerPriceId: process.env.STRIPE_PRICE_PRO_50K_MONTHLY,
        })
      );
    });

    it("preserves plan on cancel-at-period-end (same priceId)", async () => {
      mockSelectReturning([
        {
          providerSubscriptionId: "sub_1",
          providerPriceId: process.env.STRIPE_PRICE_PRO_25K_MONTHLY,
          plan: "pro",
          tier: "25k",
          status: "active",
          cancelAtPeriodEnd: false,
          currentPeriodStart: new Date("2025-01-01"),
          currentPeriodEnd: new Date("2025-02-01"),
        },
      ]);

      const provider = createMockProvider();
      const event = makeEvent("subscription.updated", {
        providerSubscriptionId: "sub_1",
        priceId: process.env.STRIPE_PRICE_PRO_25K_MONTHLY,
        status: "active",
        cancelAtPeriodEnd: true,
      });

      await handleBillingEvent(event, provider);

      expect(db.update).toHaveBeenCalled();
      const setArg = mockSet.mock.calls[0][0] as Record<string, unknown>;
      expect(setArg.plan).toBeUndefined();
      expect(setArg.tier).toBeUndefined();
      expect(setArg.cancelAtPeriodEnd).toBe(true);
    });

    it("skips when no matching subscription row found", async () => {
      mockSelectReturning([]);

      const provider = createMockProvider();
      const event = makeEvent("subscription.updated", {
        providerSubscriptionId: "sub_unknown",
        status: "active",
      });

      await handleBillingEvent(event, provider);

      expect(db.update).not.toHaveBeenCalled();
    });

    it("skips when providerSubscriptionId is missing", async () => {
      const provider = createMockProvider();
      const event = makeEvent("subscription.updated", {});

      await handleBillingEvent(event, provider);

      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe("subscription.deleted", () => {
    it("keeps plan active when period has not ended", async () => {
      const futureDate = new Date(Date.now() + 86_400_000 * 30);
      mockSelectReturning([
        {
          providerSubscriptionId: "sub_1",
          currentPeriodEnd: futureDate,
          plan: "pro",
        },
      ]);

      const provider = createMockProvider();
      const event = makeEvent("subscription.deleted", {
        providerSubscriptionId: "sub_1",
      });

      await handleBillingEvent(event, provider);

      expect(db.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "canceled",
          cancelAtPeriodEnd: false,
        })
      );
      const setArg = mockSet.mock.calls[0][0] as Record<string, unknown>;
      expect(setArg.plan).toBeUndefined();
    });

    it("resets to free when period has ended", async () => {
      const pastDate = new Date(Date.now() - 86_400_000);
      mockSelectReturning([
        {
          providerSubscriptionId: "sub_1",
          currentPeriodEnd: pastDate,
          plan: "pro",
        },
      ]);

      const provider = createMockProvider();
      const event = makeEvent("subscription.deleted", {
        providerSubscriptionId: "sub_1",
      });

      await handleBillingEvent(event, provider);

      expect(db.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: "free",
          tier: null,
          status: "canceled",
          providerSubscriptionId: null,
          providerPriceId: null,
        })
      );
    });

    it("uses event periodEnd over DB periodEnd", async () => {
      const pastDbDate = new Date(Date.now() - 86_400_000);
      const futureEventDate = new Date(Date.now() + 86_400_000 * 30);
      mockSelectReturning([
        {
          providerSubscriptionId: "sub_1",
          currentPeriodEnd: pastDbDate,
          plan: "pro",
        },
      ]);

      const provider = createMockProvider();
      const event = makeEvent("subscription.deleted", {
        providerSubscriptionId: "sub_1",
        periodEnd: futureEventDate,
      });

      await handleBillingEvent(event, provider);

      expect(db.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "canceled",
          cancelAtPeriodEnd: false,
        })
      );
      const setArg = mockSet.mock.calls[0][0] as Record<string, unknown>;
      expect(setArg.plan).toBeUndefined();
    });

    it("skips when providerSubscriptionId is missing", async () => {
      const provider = createMockProvider();
      const event = makeEvent("subscription.deleted", {});

      await handleBillingEvent(event, provider);

      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe("invoice.paid", () => {
    it("sets status active and clears billing alerts", async () => {
      const provider = createMockProvider();
      const event = makeEvent("invoice.paid", {
        providerSubscriptionId: "sub_1",
      });

      await handleBillingEvent(event, provider);

      expect(db.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "active",
          billingAlert: null,
          billingAlertUrl: null,
        })
      );
    });

    it("skips when providerSubscriptionId is missing", async () => {
      const provider = createMockProvider();
      const event = makeEvent("invoice.paid", {});

      await handleBillingEvent(event, provider);

      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe("invoice.payment_failed", () => {
    it("sets past_due status and payment_failed alert", async () => {
      const provider = createMockProvider();
      const event = makeEvent("invoice.payment_failed", {
        providerSubscriptionId: "sub_1",
        invoiceUrl: "https://invoice.stripe.com/i/123",
      });

      await handleBillingEvent(event, provider);

      expect(db.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "past_due",
          billingAlert: "payment_failed",
          billingAlertUrl: "https://invoice.stripe.com/i/123",
        })
      );
    });

    it("skips when providerSubscriptionId is missing", async () => {
      const provider = createMockProvider();
      const event = makeEvent("invoice.payment_failed", {});

      await handleBillingEvent(event, provider);

      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe("invoice.overdue", () => {
    it("sets overdue alert", async () => {
      const provider = createMockProvider();
      const event = makeEvent("invoice.overdue", {
        providerSubscriptionId: "sub_1",
        invoiceUrl: "https://invoice.stripe.com/i/456",
      });

      await handleBillingEvent(event, provider);

      expect(db.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          billingAlert: "overdue",
          billingAlertUrl: "https://invoice.stripe.com/i/456",
        })
      );
    });
  });

  describe("invoice.payment_action_required", () => {
    it("sets payment_action_required alert", async () => {
      const provider = createMockProvider();
      const event = makeEvent("invoice.payment_action_required", {
        providerSubscriptionId: "sub_1",
        invoiceUrl: "https://invoice.stripe.com/i/789",
      });

      await handleBillingEvent(event, provider);

      expect(db.update).toHaveBeenCalled();
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          billingAlert: "payment_action_required",
          billingAlertUrl: "https://invoice.stripe.com/i/789",
        })
      );
    });
  });
});
