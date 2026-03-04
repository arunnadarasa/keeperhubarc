import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { authenticateInternalService } from "@/keeperhub/lib/internal-service-auth";
import { db } from "@/lib/db";
import { workflowExecutionLogs } from "@/lib/db/schema";

/**
 * KEEP-1541: Internal endpoint to fetch execution logs for reconciling
 * spurious max-retries failures. Called via HTTP loopback from the workflow
 * executor to avoid importing DB modules in the workflow bundle.
 */
export async function POST(request: Request): Promise<Response> {
  const authResult = authenticateInternalService(request);
  if (!authResult.authenticated) {
    return NextResponse.json({ error: authResult.error }, { status: 401 });
  }

  const body = (await request.json()) as {
    executionId?: string;
    nodeIds?: string[];
  };

  const { executionId, nodeIds } = body;

  if (!(executionId && Array.isArray(nodeIds)) || nodeIds.length === 0) {
    return NextResponse.json(
      { error: "executionId and nodeIds[] are required" },
      { status: 400 }
    );
  }

  const logs = await db
    .select({
      nodeId: workflowExecutionLogs.nodeId,
      status: workflowExecutionLogs.status,
      output: workflowExecutionLogs.output,
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, executionId),
        inArray(workflowExecutionLogs.nodeId, nodeIds)
      )
    );

  return NextResponse.json({ logs });
}
