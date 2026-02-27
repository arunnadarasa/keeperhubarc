import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { PAID_PLANS, VALID_INTERVALS } from "@/keeperhub/lib/billing/constants";
import { isBillingEnabled } from "@/keeperhub/lib/billing/feature-flag";
import {
  getPriceId,
  type PlanName,
  resolvePriceId,
  type TierKey,
} from "@/keeperhub/lib/billing/plans";
import { getOrgSubscription } from "@/keeperhub/lib/billing/plans-server";
import type { BillingProvider } from "@/keeperhub/lib/billing/provider";
import { getBillingProvider } from "@/keeperhub/lib/billing/providers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { organizationSubscriptions } from "@/lib/db/schema";

type CheckoutRequestBody = {
  plan?: string;
  tier?: string | null;
  interval?: string;
};

async function ensureProviderCustomer(
  provider: BillingProvider,
  activeOrgId: string,
  email: string,
  userId: string,
  existingSub: Awaited<ReturnType<typeof getOrgSubscription>>
): Promise<string> {
  if (existingSub?.providerCustomerId) {
    return existingSub.providerCustomerId;
  }

  const { customerId } = await provider.createCustomer({
    email,
    organizationId: activeOrgId,
    userId,
  });

  if (existingSub) {
    await db
      .update(organizationSubscriptions)
      .set({ providerCustomerId: customerId, updatedAt: new Date() })
      .where(eq(organizationSubscriptions.organizationId, activeOrgId));
  } else {
    await db.insert(organizationSubscriptions).values({
      organizationId: activeOrgId,
      providerCustomerId: customerId,
      plan: "free",
      status: "active",
    });
  }

  return customerId;
}

type ValidatedCheckout = {
  activeOrgId: string;
  email: string;
  userId: string;
  priceId: string;
};

async function validateCheckoutRequest(
  request: Request
): Promise<NextResponse | ValidatedCheckout> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeOrgId = session.session.activeOrganizationId;
  if (!activeOrgId) {
    return NextResponse.json(
      { error: "No active organization" },
      { status: 400 }
    );
  }

  const activeMember = await auth.api.getActiveMember({
    headers: await headers(),
  });

  if (!activeMember || activeMember.role !== "owner") {
    return NextResponse.json(
      { error: "Only organization owners can manage billing" },
      { status: 403 }
    );
  }

  const body = (await request.json()) as CheckoutRequestBody;
  const { plan, tier, interval } = body;

  if (!(plan && PAID_PLANS.has(plan))) {
    return NextResponse.json(
      { error: "Invalid plan. Must be one of: pro, business, enterprise" },
      { status: 400 }
    );
  }

  if (!(interval && VALID_INTERVALS.has(interval))) {
    return NextResponse.json(
      { error: "Invalid interval. Must be monthly or yearly" },
      { status: 400 }
    );
  }

  const priceId = getPriceId(
    plan as PlanName,
    (tier ?? null) as TierKey | null,
    interval as "monthly" | "yearly"
  );

  if (!priceId) {
    return NextResponse.json(
      { error: "Price configuration not found for selected plan" },
      { status: 400 }
    );
  }

  return {
    activeOrgId,
    email: session.user.email,
    userId: session.user.id,
    priceId,
  };
}

function isStripeCardError(error: unknown): boolean {
  return error instanceof Stripe.errors.StripeCardError;
}

async function handleExistingSubscription(
  provider: BillingProvider,
  subscriptionId: string,
  priceId: string,
  activeOrgId: string,
  currentSub: NonNullable<Awaited<ReturnType<typeof getOrgSubscription>>>
): Promise<NextResponse> {
  await provider.updateSubscription(subscriptionId, priceId);

  const details = await provider.getSubscriptionDetails(subscriptionId);
  const resolved = details.priceId
    ? resolvePriceId(details.priceId)
    : undefined;

  await db
    .update(organizationSubscriptions)
    .set({
      providerPriceId: details.priceId ?? null,
      plan: resolved?.plan ?? currentSub.plan,
      tier: resolved?.tier ?? null,
      status: details.status ?? currentSub.status,
      currentPeriodStart: details.periodStart,
      currentPeriodEnd: details.periodEnd ?? null,
      cancelAtPeriodEnd: details.cancelAtPeriodEnd,
      updatedAt: new Date(),
    })
    .where(eq(organizationSubscriptions.organizationId, activeOrgId));

  return NextResponse.json({ updated: true });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const result = await validateCheckoutRequest(request);
    if (result instanceof NextResponse) {
      return result;
    }

    const { activeOrgId, email, userId, priceId } = result;
    const provider = getBillingProvider();
    const sub = await getOrgSubscription(activeOrgId);
    const existingSubId = sub?.providerSubscriptionId ?? null;

    if (
      sub &&
      existingSubId &&
      sub.status !== "canceled" &&
      sub.plan !== "free"
    ) {
      return await handleExistingSubscription(
        provider,
        existingSubId,
        priceId,
        activeOrgId,
        sub
      );
    }

    const providerCustomerId = await ensureProviderCustomer(
      provider,
      activeOrgId,
      email,
      userId,
      sub
    );

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    const { url } = await provider.createCheckoutSession({
      customerId: providerCustomerId,
      priceId,
      organizationId: activeOrgId,
      successUrl: `${appUrl}/billing?checkout=success`,
      cancelUrl: `${appUrl}/billing?checkout=canceled`,
    });

    return NextResponse.json({ url });
  } catch (error) {
    if (isStripeCardError(error)) {
      return NextResponse.json(
        { error: "Payment failed. Please update your payment method." },
        { status: 402 }
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error("[Billing] Checkout error:", message);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
