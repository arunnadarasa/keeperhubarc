/**
 * KEEP-1549: "use step" function to query workflow_execution_logs for
 * successfully completed node IDs. Used by the reconciler inside
 * "use workflow" context where direct DB imports are unavailable.
 */
import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workflowExecutionLogs } from "@/lib/db/schema";

type FetchSuccessfulStepsInput = {
  executionId: string;
};

type FetchSuccessfulStepsResult = {
  successfulNodeIds: string[];
};

export async function fetchSuccessfulStepsStep(
  input: FetchSuccessfulStepsInput
): Promise<FetchSuccessfulStepsResult> {
  "use step";

  const logs = await db.query.workflowExecutionLogs.findMany({
    where: and(
      eq(workflowExecutionLogs.executionId, input.executionId),
      eq(workflowExecutionLogs.status, "success")
    ),
    columns: { nodeId: true },
  });

  return {
    successfulNodeIds: logs.map((log) => log.nodeId),
  };
}
fetchSuccessfulStepsStep.maxRetries = 0;
