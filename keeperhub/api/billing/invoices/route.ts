import { NextResponse } from "next/server";
import { isBillingEnabled } from "@/lib/billing/feature-flag";
import { getOrgSubscription } from "@/lib/billing/plans-server";
import { getBillingProvider } from "@/lib/billing/providers";
import { requireOrgOwner } from "@/lib/billing/require-org-owner";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const authResult = await requireOrgOwner();
    if ("error" in authResult) {
      return authResult.error;
    }
    const { orgId: activeOrgId } = authResult;

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
