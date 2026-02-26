import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  getPriceId,
  type PlanName,
  type TierKey,
} from "@/keeperhub/lib/billing/plans";
import { getOrgSubscription } from "@/keeperhub/lib/billing/plans-server";
import { getBillingProvider } from "@/keeperhub/lib/billing/providers";
import { auth } from "@/lib/auth";

type PreviewRequestBody = {
  plan?: string;
  tier?: string | null;
  interval?: string;
};

const VALID_PLANS = new Set<string>(["pro", "business", "enterprise"]);
const VALID_INTERVALS = new Set<string>(["monthly", "yearly"]);

export async function POST(request: Request): Promise<NextResponse> {
  try {
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

    const body = (await request.json()) as PreviewRequestBody;
    const { plan, tier, interval } = body;

    if (!(plan && VALID_PLANS.has(plan))) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    if (!(interval && VALID_INTERVALS.has(interval))) {
      return NextResponse.json({ error: "Invalid interval" }, { status: 400 });
    }

    const priceId = getPriceId(
      plan as PlanName,
      (tier ?? null) as TierKey | null,
      interval as "monthly" | "yearly"
    );

    if (!priceId) {
      return NextResponse.json(
        { error: "Price not found for selected plan" },
        { status: 400 }
      );
    }

    const sub = await getOrgSubscription(activeOrgId);
    const existingSubId = sub?.providerSubscriptionId;

    if (!existingSubId || sub.status === "canceled" || sub.plan === "free") {
      return NextResponse.json({
        amountDue: 0,
        currency: "usd",
        periodEnd: null,
        lineItems: [],
      });
    }

    const provider = getBillingProvider();
    const preview = await provider.previewProration(existingSubId, priceId);

    return NextResponse.json({
      amountDue: preview.amountDue,
      currency: preview.currency,
      periodEnd: preview.periodEnd?.toISOString() ?? null,
      lineItems: preview.lineItems,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Billing] Preview proration error:", message);
    return NextResponse.json(
      { error: "Failed to preview proration" },
      { status: 500 }
    );
  }
}
