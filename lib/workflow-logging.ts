/**
 * Server-only workflow logging functions
 * These replace the HTTP endpoint for better security
 */
import "server-only";

import { and, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { workflowExecutionLogs, workflowExecutions } from "@/lib/db/schema";

// start custom keeperhub code //
const TERMINAL_STATUSES = new Set(["cancelled", "success", "error"]);

/**
 * Check if an execution has been cancelled (or otherwise terminated).
 * Used as a guard to prevent stale writes from the runtime after cancellation.
 */
async function isExecutionTerminal(executionId: string): Promise<boolean> {
  const execution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, executionId),
    columns: { status: true },
  });
  return !execution || TERMINAL_STATUSES.has(execution.status);
}
// end keeperhub code //

export type LogStepStartParams = {
  executionId: string;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  input?: unknown;
  // start custom keeperhub code //
  iterationIndex?: number;
  forEachNodeId?: string;
  // end keeperhub code //
};

export type LogStepStartResult = {
  logId: string;
  startTime: number;
};

/**
 * Log the start of a step execution
 */
export async function logStepStartDb(
  params: LogStepStartParams
): Promise<LogStepStartResult> {
  // start custom keeperhub code //
  // Guard: skip if execution was cancelled (runtime continues after cancel)
  if (await isExecutionTerminal(params.executionId)) {
    return { logId: "", startTime: Date.now() };
  }
  // end keeperhub code //

  const [log] = await db
    .insert(workflowExecutionLogs)
    .values({
      executionId: params.executionId,
      nodeId: params.nodeId,
      nodeName: params.nodeName,
      nodeType: params.nodeType,
      status: "running",
      input: params.input,
      startedAt: new Date(),
      // start custom keeperhub code //
      iterationIndex: params.iterationIndex ?? null,
      forEachNodeId: params.forEachNodeId ?? null,
      // end keeperhub code //
    })
    .returning();

  return {
    logId: log.id,
    startTime: Date.now(),
  };
}

export type LogStepCompleteParams = {
  logId: string;
  startTime: number;
  status: "success" | "error";
  output?: unknown;
  error?: string;
  // start custom keeperhub code //
  executionId?: string;
  // end keeperhub code //
};

/**
 * Log the completion of a step execution
 */
export async function logStepCompleteDb(
  params: LogStepCompleteParams
): Promise<void> {
  // start custom keeperhub code //
  // Guard: skip if execution was cancelled (runtime continues after cancel)
  if (params.executionId && (await isExecutionTerminal(params.executionId))) {
    return;
  }
  // end keeperhub code //

  const duration = Date.now() - params.startTime;

  await db
    .update(workflowExecutionLogs)
    .set({
      status: params.status,
      output: params.output,
      error: params.error,
      completedAt: new Date(),
      duration: duration.toString(),
    })
    .where(eq(workflowExecutionLogs.id, params.logId));
}

export type LogWorkflowCompleteParams = {
  executionId: string;
  status: "success" | "error";
  output?: unknown;
  error?: string;
  startTime: number;
};

/**
 * Log the completion of a workflow execution
 */
export async function logWorkflowCompleteDb(
  params: LogWorkflowCompleteParams
): Promise<void> {
  const duration = Date.now() - params.startTime;

  await db
    .update(workflowExecutions)
    .set({
      status: params.status,
      output: params.output,
      error: params.error,
      completedAt: new Date(),
      duration: duration.toString(),
      // Clear current step on completion
      currentNodeId: null,
      currentNodeName: null,
    })
    .where(
      and(
        eq(workflowExecutions.id, params.executionId),
        ne(workflowExecutions.status, "cancelled")
      )
    );
}

// ============================================================================
// Progress Tracking Functions
// ============================================================================

export type InitializeProgressParams = {
  executionId: string;
  totalSteps: number;
};

/**
 * Initialize progress tracking at the start of workflow execution.
 * Sets total step count and resets progress counters.
 */
export async function initializeProgress(
  params: InitializeProgressParams
): Promise<void> {
  await db
    .update(workflowExecutions)
    .set({
      totalSteps: params.totalSteps.toString(),
      completedSteps: "0",
      executionTrace: [],
      currentNodeId: null,
      currentNodeName: null,
      lastSuccessfulNodeId: null,
      lastSuccessfulNodeName: null,
    })
    .where(eq(workflowExecutions.id, params.executionId));
}

export type UpdateCurrentStepParams = {
  executionId: string;
  currentNodeId: string;
  currentNodeName: string;
};

/**
 * Update the currently executing step.
 * Called when a step starts execution.
 */
export async function updateCurrentStep(
  params: UpdateCurrentStepParams
): Promise<void> {
  await db
    .update(workflowExecutions)
    .set({
      currentNodeId: params.currentNodeId,
      currentNodeName: params.currentNodeName,
    })
    .where(
      // start custom keeperhub code //
      and(
        eq(workflowExecutions.id, params.executionId),
        ne(workflowExecutions.status, "cancelled")
      )
      // end keeperhub code //
    );
}

export type IncrementCompletedStepsParams = {
  executionId: string;
  nodeId: string;
  nodeName: string;
  success: boolean;
};

/**
 * Increment the completed steps counter and update execution trace.
 * Called when a step completes (success or error).
 */
export async function incrementCompletedSteps(
  params: IncrementCompletedStepsParams
): Promise<void> {
  // Fetch current execution to get current values
  const execution = await db.query.workflowExecutions.findFirst({
    where: eq(workflowExecutions.id, params.executionId),
  });

  if (!execution) {
    return;
  }

  // start custom keeperhub code //
  // Guard: skip if execution was cancelled (runtime continues after cancel)
  if (TERMINAL_STATUSES.has(execution.status)) {
    return;
  }
  // end keeperhub code //

  const completedSteps =
    Number.parseInt(execution.completedSteps || "0", 10) + 1;
  const trace = (execution.executionTrace as string[] | null) || [];

  await db
    .update(workflowExecutions)
    .set({
      completedSteps: completedSteps.toString(),
      executionTrace: [...trace, params.nodeId],
      currentNodeId: null,
      currentNodeName: null,
      // Only update last successful if this step succeeded
      ...(params.success
        ? {
            lastSuccessfulNodeId: params.nodeId,
            lastSuccessfulNodeName: params.nodeName,
          }
        : {}),
    })
    .where(eq(workflowExecutions.id, params.executionId));
}
