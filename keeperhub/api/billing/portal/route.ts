import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { isBillingEnabled } from "@/keeperhub/lib/billing/feature-flag";
import { getOrgSubscription } from "@/keeperhub/lib/billing/plans-server";
import { getBillingProvider } from "@/keeperhub/lib/billing/providers";
import { auth } from "@/lib/auth";

export async function POST(_request: Request): Promise<NextResponse> {
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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
    if (!sub?.providerCustomerId) {
      return NextResponse.json(
        {
          error: "No billing account found. Please subscribe to a plan first.",
        },
        { status: 400 }
      );
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const provider = getBillingProvider();

    const { url } = await provider.createPortalSession(
      sub.providerCustomerId,
      `${appUrl}/billing`
    );

    return NextResponse.json({ url });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Billing] Portal error:", message);
    return NextResponse.json(
      { error: "Failed to create portal session" },
      { status: 500 }
    );
  }
}
