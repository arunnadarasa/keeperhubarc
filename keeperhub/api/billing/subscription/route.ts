import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  getPlanLimits,
  type PlanName,
  resolvePriceId,
  type TierKey,
} from "@/keeperhub/lib/billing/plans";
import { getOrgSubscription } from "@/keeperhub/lib/billing/plans-server";
import { auth } from "@/lib/auth";

export async function GET(): Promise<NextResponse> {
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

    const sub = await getOrgSubscription(activeOrgId);
    const plan = (sub?.plan ?? "free") as PlanName;
    const tier = (sub?.tier ?? null) as TierKey | null;
    const limits = getPlanLimits(plan, tier);
    const resolved = sub?.providerPriceId
      ? resolvePriceId(sub.providerPriceId)
      : undefined;
    const interval = resolved?.interval ?? null;

    return NextResponse.json({
      subscription: sub
        ? {
            plan: sub.plan,
            tier: sub.tier,
            interval,
            status: sub.status,
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            billingAlert: sub.billingAlert ?? null,
            billingAlertUrl: sub.billingAlertUrl ?? null,
          }
        : {
            plan: "free",
            tier: null,
            interval: null,
            status: "active",
            currentPeriodStart: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            billingAlert: null,
            billingAlertUrl: null,
          },
      limits,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Billing] Subscription query error:", message);
    return NextResponse.json(
      { error: "Failed to fetch subscription" },
      { status: 500 }
    );
  }
}
