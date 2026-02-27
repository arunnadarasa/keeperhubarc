import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockSelectLimit = vi.fn().mockResolvedValue([]);
const mockInsertValues = vi.fn().mockReturnValue({ returning: vi.fn() });
const mockUpdateSet = vi.fn().mockReturnValue({ where: vi.fn() });

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockSelectLimit,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: mockInsertValues,
    })),
    update: vi.fn(() => ({
      set: mockUpdateSet,
    })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  billingEvents: { id: "id", providerEventId: "providerEventId" },
  organizationSubscriptions: {
    organizationId: "organizationId",
    providerSubscriptionId: "providerSubscriptionId",
  },
}));

const mockVerifyWebhook = vi.fn();
const mockGetSubscriptionDetails = vi.fn();

vi.mock("@/keeperhub/lib/billing/providers", () => ({
  getBillingProvider: () => ({
    verifyWebhook: mockVerifyWebhook,
    getSubscriptionDetails: mockGetSubscriptionDetails,
  }),
}));

import { POST } from "@/keeperhub/api/billing/webhooks/stripe/route";
import { UnknownEventTypeError } from "@/keeperhub/lib/billing/providers/stripe";

function makeWebhookRequest(
  body: string,
  signature: string | null = "sig_test"
): Request {
  const headers = new Headers({ "Content-Type": "text/plain" });
  if (signature !== null) {
    headers.set("stripe-signature", signature);
  }
  return new Request("http://localhost:3000/api/billing/webhooks/stripe", {
    method: "POST",
    headers,
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_BILLING_ENABLED = "true";
  mockSelectLimit.mockResolvedValue([]);
});

describe("POST /api/billing/webhooks/stripe", () => {
  it("processes valid webhook event", async () => {
    mockVerifyWebhook.mockResolvedValue({
      type: "invoice.paid",
      providerEventId: "evt_1",
      data: { providerSubscriptionId: "sub_1" },
    });

    const response = await POST(makeWebhookRequest('{"type":"invoice.paid"}'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.received).toBe(true);
    expect(mockVerifyWebhook).toHaveBeenCalledWith(
      '{"type":"invoice.paid"}',
      "sig_test"
    );
  });

  it("returns 400 when signature is missing", async () => {
    const response = await POST(makeWebhookRequest("{}", null));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("stripe-signature");
  });

  it("skips already-processed events", async () => {
    mockVerifyWebhook.mockResolvedValue({
      type: "invoice.paid",
      providerEventId: "evt_1",
      data: { providerSubscriptionId: "sub_1" },
    });
    mockSelectLimit.mockResolvedValue([{ id: "existing_1" }]);

    const response = await POST(makeWebhookRequest("{}"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.received).toBe(true);
  });

  it("returns 200 for unknown event types", async () => {
    mockVerifyWebhook.mockRejectedValue(
      new UnknownEventTypeError("payment_intent.created", "evt_unknown")
    );

    const response = await POST(makeWebhookRequest("{}"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.received).toBe(true);
  });

  it("returns 400 for invalid signature", async () => {
    mockVerifyWebhook.mockRejectedValue(
      new Error("No signatures found matching the expected signature")
    );

    const response = await POST(makeWebhookRequest("{}"));

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("Invalid signature");
  });

  it("returns generic error message on handler failure", async () => {
    mockVerifyWebhook.mockResolvedValue({
      type: "invoice.paid",
      providerEventId: "evt_fail",
      data: { providerSubscriptionId: "sub_1" },
    });
    mockUpdateSet.mockImplementation(() => {
      throw new Error("DB connection lost");
    });

    const response = await POST(makeWebhookRequest("{}"));

    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json.error).toBe("Webhook processing failed");
    expect(json.error).not.toContain("DB connection lost");
  });

  it("returns 404 when billing is disabled", async () => {
    process.env.NEXT_PUBLIC_BILLING_ENABLED = "false";

    const response = await POST(makeWebhookRequest("{}"));

    expect(response.status).toBe(404);
  });
});
