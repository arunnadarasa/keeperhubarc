import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getStepLogs } from "@/keeperhub/lib/analytics/queries";
import { apiError } from "@/keeperhub/lib/api-error";
import { requireOrganization } from "@/keeperhub/lib/middleware/require-org";

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
    const segments = url.pathname.split("/");
    const runsIndex = segments.indexOf("runs");
    const executionId = segments[runsIndex + 1];

    if (!executionId) {
      return NextResponse.json(
        { error: "Execution ID is required" },
        { status: 400 }
      );
    }

    try {
      const steps = await getStepLogs(executionId);
      return NextResponse.json(steps);
    } catch (error) {
      return apiError(error, "Failed to fetch step logs");
    }
  }
);
