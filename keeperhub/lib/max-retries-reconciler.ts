/**
 * KEEP-1541: The Workflow DevKit's "use step" durability layer can throw
 * "exceeded max retries" even when the step itself succeeded. This happens
 * because the SDK's internal state tracking encounters a conflict (e.g.,
 * step already completed, state replay mismatch) AFTER withStepLogging has
 * already recorded a success log in workflow_execution_logs. The error is
 * caught by executeNode's catch block and stored as a failed result, which
 * then causes finalSuccess to be false -- marking the entire workflow as
 * "error" despite all steps completing successfully.
 *
 * Fix: after all nodes finish, cross-reference failed results that have
 * "max retries exceeded" errors against the in-memory success tracker.
 * If a failed node has a recorded success in the tracker, the SDK error
 * was spurious and we override the result to success.
 */

type ExecutionResult = {
  success: boolean;
  data?: unknown;
  error?: string;
};

type ReconcileInput = {
  results: Record<string, ExecutionResult>;
  successfulSteps: Map<string, unknown>;
  workflowId: string | undefined;
  executionId: string | undefined;
};

type ReconcileOutput = {
  overriddenNodeIds: string[];
};

// SDK error message substring used to identify spurious max-retries failures.
// If the SDK changes this wording, update this constant.
export const MAX_RETRIES_ERROR_MARKER = "exceeded max retries";

export function getFailedMaxRetriesNodeIds(
  results: Record<string, ExecutionResult>
): string[] {
  return Object.entries(results)
    .filter(
      ([, r]) => !r.success && r.error?.includes(MAX_RETRIES_ERROR_MARKER)
    )
    .map(([nodeId]) => nodeId);
}

export function reconcileMaxRetriesFailures(
  input: ReconcileInput
): ReconcileOutput {
  const { results, successfulSteps, workflowId, executionId } = input;

  const failedNodeIds = getFailedMaxRetriesNodeIds(results);

  if (failedNodeIds.length === 0) {
    return { overriddenNodeIds: [] };
  }

  const overriddenNodeIds: string[] = [];

  for (const failedNodeId of failedNodeIds) {
    if (successfulSteps.has(failedNodeId)) {
      const successOutput = successfulSteps.get(failedNodeId);
      console.warn(
        "[Workflow Executor] Overriding spurious max-retries failure for node with tracked success:",
        {
          error: results[failedNodeId]?.error,
          ...(workflowId ? { workflow_id: workflowId } : {}),
          ...(executionId ? { execution_id: executionId } : {}),
          node_id: failedNodeId,
        }
      );
      results[failedNodeId] = {
        success: true,
        data: successOutput,
      };
      overriddenNodeIds.push(failedNodeId);
    }
  }

  return { overriddenNodeIds };
}
