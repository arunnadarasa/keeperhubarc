import { ErrorCategory, logSystemError } from "@/keeperhub/lib/logging";
import { logWorkflowCompleteDb } from "@/lib/workflow-logging";

type FallbackCompleteParams = {
  executionId: string;
  status: "success" | "error";
  output?: unknown;
  error?: string;
  startTime: number;
};

/**
 * Direct DB fallback for when triggerStep({ _workflowComplete }) fails.
 * Calls logWorkflowCompleteDb directly, bypassing the workflow SDK queue.
 */
export async function fallbackCompleteExecution(
  params: FallbackCompleteParams
): Promise<void> {
  try {
    await logWorkflowCompleteDb(params);
    console.error(
      `[Execution Fallback] Successfully updated execution ${params.executionId} via DB fallback`
    );
  } catch (fallbackError) {
    logSystemError(
      ErrorCategory.DATABASE,
      "[Execution Fallback] DB fallback also failed:",
      fallbackError,
      { execution_id: params.executionId }
    );
  }
}
