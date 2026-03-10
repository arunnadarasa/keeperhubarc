import { NextResponse } from "next/server";
import { scanAndCreateDebt } from "@/keeperhub/lib/billing/execution-debt";
import { isBillingEnabled } from "@/keeperhub/lib/billing/feature-flag";
import { authenticateInternalService } from "@/keeperhub/lib/internal-service-auth";

/**
 * Internal POST endpoint for scanning unpaid overage and creating debt records.
 * Called by the scheduler daily after the 15-day grace period.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!isBillingEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const auth = authenticateInternalService(request);
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: auth.error ?? "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const result = await scanAndCreateDebt();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Billing] Debt scan error:", message);
    return NextResponse.json({ error: "Debt scan failed" }, { status: 500 });
  }
}
