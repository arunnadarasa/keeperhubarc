import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isBillingEnabled } from "@/keeperhub/lib/billing/feature-flag";
import { handleBillingEvent } from "@/keeperhub/lib/billing/handle-billing-event";
import type { BillingWebhookEvent } from "@/keeperhub/lib/billing/provider";
import { getBillingProvider } from "@/keeperhub/lib/billing/providers";
import { UnknownEventTypeError } from "@/keeperhub/lib/billing/providers/stripe";
import { db } from "@/lib/db";
import { billingEvents } from "@/lib/db/schema";

async function isEventProcessed(providerEventId: string): Promise<boolean> {
  const existing = await db
    .select({ id: billingEvents.id })
    .from(billingEvents)
    .where(eq(billingEvents.providerEventId, providerEventId))
    .limit(1);
  return existing.length > 0;
}

async function recordEvent(
  providerEventId: string,
  type: string,
  data: unknown
): Promise<void> {
  await db.insert(billingEvents).values({
    providerEventId,
    type,
    data,
    processed: true,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = await request.text();

    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      return NextResponse.json(
        { error: "Missing stripe-signature header" },
        { status: 400 }
      );
    }

    const provider = getBillingProvider();
    let event: BillingWebhookEvent;
    try {
      event = await provider.verifyWebhook(body, signature);
    } catch (error) {
      if (error instanceof UnknownEventTypeError) {
        return NextResponse.json({ received: true });
      }
      if (
        error instanceof Error &&
        error.message === "STRIPE_WEBHOOK_SECRET not configured"
      ) {
        return NextResponse.json(
          { error: "Webhook not configured" },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const alreadyProcessed = await isEventProcessed(event.providerEventId);
    if (alreadyProcessed) {
      return NextResponse.json({ received: true });
    }

    await handleBillingEvent(event, provider);
    await recordEvent(event.providerEventId, event.type, event.data);

    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Billing Webhook] Handler failed:", message);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
