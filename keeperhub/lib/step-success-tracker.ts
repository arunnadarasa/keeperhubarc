/**
 * KEEP-1541: In-memory tracker for step successes within a workflow execution.
 *
 * Both withStepLogging (step-handler.ts) and the workflow executor run in the
 * same Node.js process, so a module-level Map is sufficient. This replaces the
 * HTTP loopback approach that failed silently in production.
 *
 * Lifecycle:
 *   1. withStepLogging calls recordStepSuccess() after each successful step
 *   2. The executor calls getSuccessfulSteps() during max-retries reconciliation
 *   3. The executor calls clearExecution() after reconciliation to free memory
 */

const executions = new Map<string, Map<string, unknown>>();

export function recordStepSuccess(
  executionId: string,
  nodeId: string,
  output: unknown
): void {
  let steps = executions.get(executionId);
  if (steps === undefined) {
    steps = new Map<string, unknown>();
    executions.set(executionId, steps);
  }
  steps.set(nodeId, output);
}

export function getSuccessfulSteps(
  executionId: string
): Map<string, unknown> | undefined {
  return executions.get(executionId);
}

export function clearExecution(executionId: string): void {
  executions.delete(executionId);
}
