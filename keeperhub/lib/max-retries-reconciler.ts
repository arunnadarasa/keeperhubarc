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
 * "max retries exceeded" errors against the actual execution logs in the DB.
 * If every log entry for that node is status: "success" (no error logs at
 * all), the SDK error was spurious and we override the result to success.
 * If there is ANY error log for the node, we keep the failure -- this
 * prevents masking real failures where a retry legitimately failed.
 *
 * Architecture: the workflow executor (.workflow.ts) cannot import DB modules
 * (the bundler rejects Node.js modules like nanoid). It fetches logs via HTTP
 * loopback to /api/internal/execution-logs (same pattern as execution-fallback.ts).
 * This module contains only pure reconciliation logic used by tests.
 */

export type ExecutionLog = {
  nodeId: string;
  status: string;
  output: unknown;
};

type ExecutionResult = {
  success: boolean;
  data?: unknown;
  error?: string;
};

type ReconcileInput = {
  results: Record<string, ExecutionResult>;
  executionLogs: ExecutionLog[];
  workflowId: string | undefined;
  executionId: string | undefined;
};

type ReconcileOutput = {
  overriddenNodeIds: string[];
};

export function getFailedMaxRetriesNodeIds(
  results: Record<string, ExecutionResult>
): string[] {
  return Object.entries(results)
    .filter(([, r]) => !r.success && r.error?.includes("exceeded max retries"))
    .map(([nodeId]) => nodeId);
}

export function reconcileMaxRetriesFailures(
  input: ReconcileInput
): ReconcileOutput {
  const { results, executionLogs, workflowId, executionId } = input;

  const failedNodeIds = getFailedMaxRetriesNodeIds(results);

  if (failedNodeIds.length === 0) {
    return { overriddenNodeIds: [] };
  }

  const overriddenNodeIds: string[] = [];

  for (const failedNodeId of failedNodeIds) {
    const nodeLogs = executionLogs.filter((l) => l.nodeId === failedNodeId);
    const hasAnyErrorLog = nodeLogs.some((l) => l.status === "error");
    const successLog = nodeLogs.find((l) => l.status === "success");

    if (successLog && !hasAnyErrorLog) {
      console.warn(
        "[Workflow Executor] Overriding spurious max-retries failure for node with all-success logs:",
        {
          error: results[failedNodeId]?.error,
          ...(workflowId ? { workflow_id: workflowId } : {}),
          ...(executionId ? { execution_id: executionId } : {}),
          node_id: failedNodeId,
        }
      );
      results[failedNodeId] = {
        success: true,
        data: successLog.output,
      };
      overriddenNodeIds.push(failedNodeId);
    }
  }

  return { overriddenNodeIds };
}
