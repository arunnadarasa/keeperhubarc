import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { isBillingEnabled } from "@/keeperhub/lib/billing/feature-flag";
import { getUpgradeSuggestion } from "@/keeperhub/lib/billing/tier-suggestions";
import { auth } from "@/lib/auth";

export async function GET(): Promise<NextResponse> {
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

    const suggestion = await getUpgradeSuggestion(activeOrgId);
    return NextResponse.json(suggestion);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Billing] Usage suggestion error:", message);
    return NextResponse.json(
      { error: "Failed to fetch usage suggestion" },
      { status: 500 }
    );
  }
}
