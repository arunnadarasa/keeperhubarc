import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { auth } from "@/lib/auth";
import { ErrorCategory, logSystemError } from "@/lib/logging";
import { getActiveOrgId } from "@/lib/middleware/org-context";
import { getOrganizationWallet } from "@/lib/para/wallet-helpers";
import { exportTurnkeyPrivateKey } from "@/lib/turnkey/turnkey-client";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const activeOrgId = getActiveOrgId(session);
    if (!activeOrgId) {
      return NextResponse.json(
        { error: "No active organization" },
        { status: 400 }
      );
    }

    const activeMember = await auth.api.getActiveMember({
      headers: await headers(),
    });

    if (!activeMember) {
      return NextResponse.json(
        { error: "You are not a member of the active organization" },
        { status: 403 }
      );
    }

    if (activeMember.role !== "admin" && activeMember.role !== "owner") {
      return NextResponse.json(
        { error: "Only admins and owners can export wallet keys" },
        { status: 403 }
      );
    }

    const wallet = await getOrganizationWallet(activeOrgId);

    if (wallet.provider !== "turnkey") {
      return NextResponse.json(
        {
          error:
            "Private key export is only available for Turnkey wallets. Para wallets use MPC signing and do not support server-side key export.",
        },
        { status: 400 }
      );
    }

    if (!wallet.turnkeySubOrgId) {
      return NextResponse.json(
        { error: "Turnkey wallet configuration is incomplete" },
        { status: 500 }
      );
    }

    const privateKey = await exportTurnkeyPrivateKey(
      wallet.turnkeySubOrgId,
      wallet.walletAddress
    );

    return NextResponse.json({ privateKey });
  } catch (error) {
    logSystemError(
      ErrorCategory.EXTERNAL_SERVICE,
      "[Wallet] Failed to export private key",
      error,
      { endpoint: "/api/user/wallet/export-key", operation: "post" }
    );
    return apiError(error, "Failed to export private key");
  }
}
