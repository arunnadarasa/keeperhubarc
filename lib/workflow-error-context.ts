/**
 * Async-local error context for workflow execution.
 *
 * Carries org/owner/workflow identifiers across async boundaries so that any
 * downstream call to logUserError/logSystemError automatically picks them up
 * without each plugin step having to thread labels through manually.
 *
 * High-cardinality fields (org_id, owner_id, execution_id) are kept in log
 * lines and Sentry extras only; logging.ts strips them before they reach
 * Prometheus.
 */
import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

export type WorkflowErrorContext = {
  workflow_id?: string;
  execution_id?: string;
  org_id?: string;
  org_slug?: string;
  owner_id?: string;
  plugin_id?: string;
  integration_id?: string;
};

const storage = new AsyncLocalStorage<WorkflowErrorContext>();

export function runWithWorkflowErrorContext<T>(
  ctx: WorkflowErrorContext,
  fn: () => T
): T {
  // Merge with any outer context so nested wraps (executor -> step) inherit.
  const outer = storage.getStore();
  const merged: WorkflowErrorContext = { ...outer, ...stripUndefined(ctx) };
  return storage.run(merged, fn);
}

/**
 * Set the workflow error context for the remainder of the current async
 * chain without requiring a callback. Used by long top-level functions
 * (like executeWorkflow) where wrapping the entire body in a closure would
 * be invasive. Safe because each workflow run executes in its own task
 * context isolated by the Workflow DevKit `start()` boundary.
 */
export function enterWorkflowErrorContext(ctx: WorkflowErrorContext): void {
  const outer = storage.getStore();
  const merged: WorkflowErrorContext = { ...outer, ...stripUndefined(ctx) };
  storage.enterWith(merged);
}

export function getWorkflowErrorContext(): WorkflowErrorContext | undefined {
  return storage.getStore();
}

function stripUndefined(ctx: WorkflowErrorContext): WorkflowErrorContext {
  const out: WorkflowErrorContext = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (v !== undefined && v !== null && v !== "") {
      (out as Record<string, string>)[k] = v;
    }
  }
  return out;
}
