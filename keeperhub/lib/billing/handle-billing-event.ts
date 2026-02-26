import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { organizationSubscriptions } from "@/lib/db/schema";
import { BILLING_ALERTS } from "./constants";
import { resolvePriceId } from "./plans";
import type { BillingProvider, BillingWebhookEvent } from "./provider";

const LOG_PREFIX = "[Billing Handler]";

type SubscriptionRow = typeof organizationSubscriptions.$inferSelect;

async function findSubscriptionByProviderId(
  providerSubscriptionId: string
): Promise<SubscriptionRow | undefined> {
  const rows = await db
    .select()
    .from(organizationSubscriptions)
    .where(
      eq(
        organizationSubscriptions.providerSubscriptionId,
        providerSubscriptionId
      )
    )
    .limit(1);
  return rows[0];
}

export async function handleBillingEvent(
  event: BillingWebhookEvent,
  provider: BillingProvider
): Promise<void> {
  const { type, data } = event;
  console.log(LOG_PREFIX, "Handling event:", type);

  switch (type) {
    case "checkout.completed": {
      await handleCheckoutCompleted(data, provider);
      break;
    }
    case "subscription.updated": {
      await handleSubscriptionUpdated(data);
      break;
    }
    case "subscription.deleted": {
      await handleSubscriptionDeleted(data);
      break;
    }
    case "invoice.paid": {
      await handleInvoicePaid(data);
      break;
    }
    case "invoice.payment_failed": {
      await handleInvoicePaymentFailed(data);
      break;
    }
    case "invoice.overdue": {
      await handleInvoiceOverdue(data);
      break;
    }
    case "invoice.payment_action_required": {
      await handleInvoicePaymentActionRequired(data);
      break;
    }
    default:
      break;
  }
}

async function handleCheckoutCompleted(
  data: BillingWebhookEvent["data"],
  provider: BillingProvider
): Promise<void> {
  const { organizationId, providerSubscriptionId } = data;

  if (!organizationId) {
    console.error("[Billing Webhook] No organizationId in checkout event");
    return;
  }

  if (!providerSubscriptionId) {
    console.error("[Billing Webhook] No subscription in checkout event");
    return;
  }

  console.log(
    LOG_PREFIX,
    "checkout.completed - orgId:",
    organizationId,
    "subId:",
    providerSubscriptionId
  );

  const details = await provider.getSubscriptionDetails(providerSubscriptionId);
  console.log(
    LOG_PREFIX,
    "Subscription details - priceId:",
    details.priceId,
    "status:",
    details.status
  );

  if (!details.priceId) {
    console.error(LOG_PREFIX, "No price ID found in subscription");
    return;
  }

  const resolved = resolvePriceId(details.priceId);
  const plan = resolved?.plan ?? "pro";
  const tier = resolved?.tier ?? null;
  console.log(
    LOG_PREFIX,
    "Resolved plan:",
    plan,
    "tier:",
    tier,
    "from priceId:",
    details.priceId
  );

  await db
    .update(organizationSubscriptions)
    .set({
      providerSubscriptionId,
      providerPriceId: details.priceId,
      plan,
      tier,
      status: "active",
      currentPeriodStart: details.periodStart,
      currentPeriodEnd: details.periodEnd,
      cancelAtPeriodEnd: details.cancelAtPeriodEnd,
      updatedAt: new Date(),
    })
    .where(eq(organizationSubscriptions.organizationId, organizationId));

  console.log(LOG_PREFIX, "Updated subscription for org:", organizationId);
}

// Build the DB update payload for a subscription.updated event.
// Only changes plan/tier if the priceId actually changed (upgrade or plan switch).
// When cancelAtPeriodEnd is set, Stripe sends the same priceId -- we keep the
// current plan active until the period ends (handled by subscription.deleted).
function buildSubscriptionUpdate(
  data: BillingWebhookEvent["data"],
  current: SubscriptionRow
): Record<string, unknown> {
  const { priceId, status, cancelAtPeriodEnd, periodStart, periodEnd } = data;

  const priceChanged =
    priceId !== undefined && priceId !== current.providerPriceId;
  const resolved =
    priceChanged && priceId ? resolvePriceId(priceId) : undefined;

  console.log(
    LOG_PREFIX,
    "subscription.updated - subId:",
    current.providerSubscriptionId,
    "status:",
    status,
    "cancelAtPeriodEnd:",
    cancelAtPeriodEnd,
    "priceChanged:",
    priceChanged,
    priceChanged ? `${current.providerPriceId} -> ${priceId}` : "(no change)",
    "resolved:",
    resolved?.plan ?? current.plan,
    resolved?.tier ?? current.tier
  );

  const update: Record<string, unknown> = {
    status: status ?? current.status,
    currentPeriodStart: periodStart ?? current.currentPeriodStart,
    currentPeriodEnd: periodEnd ?? current.currentPeriodEnd,
    cancelAtPeriodEnd: cancelAtPeriodEnd ?? current.cancelAtPeriodEnd,
    updatedAt: new Date(),
  };

  if (priceChanged) {
    update.providerPriceId = priceId ?? null;
    update.plan = resolved?.plan ?? current.plan;
    update.tier = resolved?.tier ?? null;
  }

  return update;
}

async function handleSubscriptionUpdated(
  data: BillingWebhookEvent["data"]
): Promise<void> {
  const { providerSubscriptionId } = data;

  if (!providerSubscriptionId) {
    return;
  }

  const current = await findSubscriptionByProviderId(providerSubscriptionId);
  if (!current) {
    console.warn(
      LOG_PREFIX,
      "subscription.updated - no matching row for subId:",
      providerSubscriptionId
    );
    return;
  }

  const update = buildSubscriptionUpdate(data, current);

  await db
    .update(organizationSubscriptions)
    .set(update)
    .where(
      eq(
        organizationSubscriptions.providerSubscriptionId,
        providerSubscriptionId
      )
    );
}

async function handleSubscriptionDeleted(
  data: BillingWebhookEvent["data"]
): Promise<void> {
  const { providerSubscriptionId } = data;

  if (!providerSubscriptionId) {
    return;
  }

  const current = await findSubscriptionByProviderId(providerSubscriptionId);
  const periodEnd = current?.currentPeriodEnd;
  const now = new Date();

  // If the billing period hasn't ended yet (cancel at period end),
  // keep the plan active but mark status as canceled so the UI shows
  // the cancellation notice. The plan features remain available.
  if (periodEnd !== null && periodEnd !== undefined && periodEnd > now) {
    console.log(
      LOG_PREFIX,
      "subscription.deleted - subId:",
      providerSubscriptionId,
      "period still active until:",
      periodEnd.toISOString(),
      "- keeping plan, marking canceled"
    );

    await db
      .update(organizationSubscriptions)
      .set({
        status: "canceled",
        cancelAtPeriodEnd: false,
        updatedAt: now,
      })
      .where(
        eq(
          organizationSubscriptions.providerSubscriptionId,
          providerSubscriptionId
        )
      );
    return;
  }

  // Period has ended (or no period data) -- fully reset to free
  console.log(
    LOG_PREFIX,
    "subscription.deleted - subId:",
    providerSubscriptionId,
    "period ended, resetting to free"
  );

  await db
    .update(organizationSubscriptions)
    .set({
      plan: "free",
      tier: null,
      status: "canceled",
      providerSubscriptionId: null,
      providerPriceId: null,
      cancelAtPeriodEnd: false,
      updatedAt: now,
    })
    .where(
      eq(
        organizationSubscriptions.providerSubscriptionId,
        providerSubscriptionId
      )
    );
}

async function handleInvoicePaid(
  data: BillingWebhookEvent["data"]
): Promise<void> {
  const { providerSubscriptionId } = data;

  if (!providerSubscriptionId) {
    console.warn(LOG_PREFIX, "invoice.paid - no subscriptionId, skipping");
    return;
  }

  console.log(LOG_PREFIX, "invoice.paid - subId:", providerSubscriptionId);

  await db
    .update(organizationSubscriptions)
    .set({
      status: "active",
      billingAlert: null,
      billingAlertUrl: null,
      updatedAt: new Date(),
    })
    .where(
      eq(
        organizationSubscriptions.providerSubscriptionId,
        providerSubscriptionId
      )
    );
}

async function handleInvoicePaymentFailed(
  data: BillingWebhookEvent["data"]
): Promise<void> {
  const { providerSubscriptionId, invoiceUrl } = data;

  if (!providerSubscriptionId) {
    console.warn(
      LOG_PREFIX,
      "invoice.payment_failed - no subscriptionId, skipping"
    );
    return;
  }

  console.log(
    LOG_PREFIX,
    "invoice.payment_failed - subId:",
    providerSubscriptionId
  );

  await db
    .update(organizationSubscriptions)
    .set({
      status: "past_due",
      billingAlert: BILLING_ALERTS.PAYMENT_FAILED,
      billingAlertUrl: invoiceUrl ?? null,
      updatedAt: new Date(),
    })
    .where(
      eq(
        organizationSubscriptions.providerSubscriptionId,
        providerSubscriptionId
      )
    );
}

async function handleInvoiceOverdue(
  data: BillingWebhookEvent["data"]
): Promise<void> {
  const { providerSubscriptionId, invoiceUrl } = data;

  if (!providerSubscriptionId) {
    console.warn(LOG_PREFIX, "invoice.overdue - no subscriptionId, skipping");
    return;
  }

  console.log(LOG_PREFIX, "invoice.overdue - subId:", providerSubscriptionId);

  await db
    .update(organizationSubscriptions)
    .set({
      billingAlert: BILLING_ALERTS.OVERDUE,
      billingAlertUrl: invoiceUrl ?? null,
      updatedAt: new Date(),
    })
    .where(
      eq(
        organizationSubscriptions.providerSubscriptionId,
        providerSubscriptionId
      )
    );
}

async function handleInvoicePaymentActionRequired(
  data: BillingWebhookEvent["data"]
): Promise<void> {
  const { providerSubscriptionId, invoiceUrl } = data;

  if (!providerSubscriptionId) {
    console.warn(
      LOG_PREFIX,
      "invoice.payment_action_required - no subscriptionId, skipping"
    );
    return;
  }

  console.log(
    LOG_PREFIX,
    "invoice.payment_action_required - subId:",
    providerSubscriptionId
  );

  await db
    .update(organizationSubscriptions)
    .set({
      billingAlert: BILLING_ALERTS.PAYMENT_ACTION_REQUIRED,
      billingAlertUrl: invoiceUrl ?? null,
      updatedAt: new Date(),
    })
    .where(
      eq(
        organizationSubscriptions.providerSubscriptionId,
        providerSubscriptionId
      )
    );
}
