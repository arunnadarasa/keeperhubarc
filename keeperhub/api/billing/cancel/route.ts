import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getOrgSubscription } from "@/keeperhub/lib/billing/plans-server";
import { getBillingProvider } from "@/keeperhub/lib/billing/providers";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { organizationSubscriptions } from "@/lib/db/schema";

export async function POST(): Promise<NextResponse> {
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

    const activeMember = await auth.api.getActiveMember({
      headers: await headers(),
    });

    if (!activeMember || activeMember.role !== "owner") {
      return NextResponse.json(
        { error: "Only organization owners can manage billing" },
        { status: 403 }
      );
    }

    const sub = await getOrgSubscription(activeOrgId);

    if (!sub?.providerSubscriptionId || sub.plan === "free") {
      return NextResponse.json(
        { error: "No active subscription to cancel" },
        { status: 400 }
      );
    }

    const provider = getBillingProvider();
    const { periodEnd } = await provider.cancelSubscription(
      sub.providerSubscriptionId
    );

    await db
      .update(organizationSubscriptions)
      .set({
        cancelAtPeriodEnd: true,
        updatedAt: new Date(),
      })
      .where(eq(organizationSubscriptions.organizationId, activeOrgId));

    return NextResponse.json({
      canceled: true,
      periodEnd: periodEnd?.toISOString() ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Billing] Cancel error:", message);
    return NextResponse.json(
      { error: "Failed to cancel subscription" },
      { status: 500 }
    );
  }
}
