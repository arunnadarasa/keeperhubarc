import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getOrgSubscription } from "@/keeperhub/lib/billing/plans-server";
import { getBillingProvider } from "@/keeperhub/lib/billing/providers";
import { auth } from "@/lib/auth";

export async function GET(request: Request): Promise<NextResponse> {
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
    if (!sub?.providerCustomerId) {
      return NextResponse.json({ invoices: [], hasMore: false });
    }

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const startingAfter = searchParams.get("startingAfter") ?? undefined;
    const limit = Math.min(Math.max(Number(limitParam) || 10, 1), 100);

    const provider = getBillingProvider();
    const result = await provider.listInvoices({
      customerId: sub.providerCustomerId,
      limit,
      startingAfter,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Billing] Invoices error:", message);
    return NextResponse.json(
      { error: "Failed to fetch invoices" },
      { status: 500 }
    );
  }
}
