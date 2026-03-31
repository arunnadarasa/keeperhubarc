import { type NextRequest, NextResponse } from "next/server";
import { getEarningsSummary } from "@/lib/earnings/queries";
import { requireOrganization } from "@/lib/middleware/require-org";

export const GET = requireOrganization(
  async (req: NextRequest, context): Promise<Response> => {
    const organizationId = context.organization?.id;
    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 403 }
      );
    }

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
    const pageSize = Math.min(
      50,
      Math.max(1, Number(url.searchParams.get("pageSize") ?? "10"))
    );

    const summary = await getEarningsSummary(organizationId, page, pageSize);

    return NextResponse.json(summary);
  }
);
