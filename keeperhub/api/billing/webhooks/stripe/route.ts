import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
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

const LOG_PREFIX = "[Billing Webhook /stripe]";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.text();
    console.log(LOG_PREFIX, "Received webhook request");

    const signature = request.headers.get("stripe-signature");
    if (!signature) {
      console.warn(LOG_PREFIX, "Missing stripe-signature header");
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
        console.log(
          LOG_PREFIX,
          "Ignoring unhandled event type:",
          error.eventType
        );
        return NextResponse.json({ received: true });
      }
      if (
        error instanceof Error &&
        error.message === "STRIPE_WEBHOOK_SECRET not configured"
      ) {
        console.error(LOG_PREFIX, "STRIPE_WEBHOOK_SECRET not configured");
        return NextResponse.json(
          { error: "Webhook not configured" },
          { status: 500 }
        );
      }
      const msg = error instanceof Error ? error.message : String(error);
      console.error(LOG_PREFIX, "Signature verification failed:", msg);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    console.log(
      LOG_PREFIX,
      "Verified event:",
      event.type,
      "id:",
      event.providerEventId,
      "data:",
      JSON.stringify(event.data)
    );

    const alreadyProcessed = await isEventProcessed(event.providerEventId);
    if (alreadyProcessed) {
      console.log(
        LOG_PREFIX,
        "Skipping already-processed event:",
        event.providerEventId
      );
      return NextResponse.json({ received: true });
    }

    await handleBillingEvent(event, provider);
    await recordEvent(event.providerEventId, event.type, event.data);

    console.log(LOG_PREFIX, "Successfully processed event:", event.type);
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(LOG_PREFIX, "Unhandled error:", message);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}
