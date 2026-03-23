import { CronExpressionParser } from "cron-parser";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { validateWorkflowIntegrations } from "../lib/db/integrations";
import {
  organization,
  workflowExecutions,
  workflowSchedules,
  workflows,
} from "../lib/db/schema";
import { executeWorkflow } from "../lib/workflow-executor.workflow";
import { calculateTotalSteps } from "../lib/workflow-progress";
import type { WorkflowEdge, WorkflowNode } from "../lib/workflow-store";
import { toJsonSafe } from "./lib/serialize";

type DbSchema = {
  workflows: typeof workflows;
  workflowExecutions: typeof workflowExecutions;
  workflowSchedules: typeof workflowSchedules;
};

async function updateExecutionStatus(
  db: PostgresJsDatabase<DbSchema>,
  executionId: string,
  status: "running" | "success" | "error" | "cancelled",
  result?: { output?: unknown; error?: string }
): Promise<void> {
  const updateData: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };

  if (status === "success" || status === "error") {
    updateData.completedAt = new Date();
  }
  if (result?.output !== undefined) {
    updateData.output = toJsonSafe(result.output);
  }
  if (result?.error) {
    updateData.error = result.error;
  }

  await db
    .update(workflowExecutions)
    .set(updateData)
    .where(eq(workflowExecutions.id, executionId));
}

async function initializeExecutionProgress(
  db: PostgresJsDatabase<DbSchema>,
  executionId: string,
  totalSteps: number
): Promise<void> {
  await db
    .update(workflowExecutions)
    .set({
      totalSteps: totalSteps.toString(),
      completedSteps: "0",
      executionTrace: [],
      currentNodeId: null,
      currentNodeName: null,
      lastSuccessfulNodeId: null,
      lastSuccessfulNodeName: null,
    })
    .where(eq(workflowExecutions.id, executionId));
}

function computeNextRunTime(
  cronExpression: string,
  timezone: string
): Date | null {
  try {
    const interval = CronExpressionParser.parse(cronExpression, {
      currentDate: new Date(),
      tz: timezone,
    });
    return interval.next().toDate();
  } catch {
    return null;
  }
}

async function updateScheduleStatus(
  db: PostgresJsDatabase<DbSchema>,
  scheduleId: string,
  status: "success" | "error",
  error?: string
): Promise<void> {
  const schedule = await db.query.workflowSchedules.findFirst({
    where: eq(workflowSchedules.id, scheduleId),
  });

  if (!schedule) {
    return;
  }

  const nextRunAt = computeNextRunTime(
    schedule.cronExpression,
    schedule.timezone
  );

  const runCount =
    status === "success"
      ? String(Number(schedule.runCount || "0") + 1)
      : schedule.runCount;

  await db
    .update(workflowSchedules)
    .set({
      lastRunAt: new Date(),
      lastStatus: status,
      lastError: status === "error" ? error : null,
      nextRunAt,
      runCount,
      updatedAt: new Date(),
    })
    .where(eq(workflowSchedules.id, scheduleId));
}

/**
 * Execute a workflow in-process (no K8s Job).
 * Refactored from scripts/runtime/workflow-runner.ts main() to be callable
 * from the executor without managing its own process lifecycle.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: orchestrates multiple phases of workflow execution
export async function executeInProcess(params: {
  workflowId: string;
  executionId: string;
  input: Record<string, unknown>;
  scheduleId?: string;
  db: PostgresJsDatabase<DbSchema>;
}): Promise<void> {
  const { workflowId, executionId, input, scheduleId, db } = params;
  const startTime = Date.now();

  console.log("[Executor:InProcess] Starting workflow execution");
  console.log(`[Executor:InProcess] Workflow ID: ${workflowId}`);
  console.log(`[Executor:InProcess] Execution ID: ${executionId}`);

  try {
    await updateExecutionStatus(db, executionId, "running");

    const workflow = await db.query.workflows.findFirst({
      where: eq(workflows.id, workflowId),
    });

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    if (workflow.enabled === false) {
      console.log(
        `[Executor:InProcess] Workflow disabled, skipping: ${workflowId}`
      );
      await updateExecutionStatus(db, executionId, "cancelled");
      return;
    }

    let organizationName: string | undefined;
    if (workflow.organizationId) {
      const [org] = await db
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, workflow.organizationId))
        .limit(1);
      organizationName = org?.name;
    }

    const nodes = workflow.nodes as WorkflowNode[];
    const edges = workflow.edges as WorkflowEdge[];
    const validation = await validateWorkflowIntegrations(
      nodes,
      workflow.userId
    );

    if (!validation.valid) {
      throw new Error(
        `Workflow contains invalid integration references: ${validation.invalidIds?.join(", ")}`
      );
    }

    const totalSteps = calculateTotalSteps(nodes, edges);
    await initializeExecutionProgress(db, executionId, totalSteps);

    console.log("[Executor:InProcess] Executing workflow...");
    const result = await executeWorkflow({
      nodes,
      edges,
      triggerInput: input,
      executionId,
      workflowId,
      organizationId: workflow.organizationId ?? undefined,
      organizationName,
    });

    const duration = Date.now() - startTime;
    console.log(`[Executor:InProcess] Completed in ${duration}ms`);

    if (result.success) {
      await updateExecutionStatus(db, executionId, "success", {
        output: result.outputs,
      });

      if (scheduleId) {
        await updateScheduleStatus(db, scheduleId, "success");
      }

      console.log("[Executor:InProcess] Execution completed successfully");
    } else {
      const errorMessage =
        result.error ||
        Object.values(result.results || {}).find((r) => !r.success)?.error ||
        "Unknown error";

      await updateExecutionStatus(db, executionId, "error", {
        error: errorMessage,
        output: result.outputs,
      });

      if (scheduleId) {
        await updateScheduleStatus(db, scheduleId, "error", errorMessage);
      }

      console.error(
        "[Executor:InProcess] Workflow execution failed:",
        errorMessage
      );
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    console.error(
      `[Executor:InProcess] Fatal error after ${duration}ms:`,
      errorMessage
    );

    try {
      await updateExecutionStatus(db, executionId, "error", {
        error: errorMessage,
      });

      if (scheduleId) {
        await updateScheduleStatus(db, scheduleId, "error", errorMessage);
      }
    } catch (updateError) {
      console.error(
        "[Executor:InProcess] Failed to update execution status:",
        updateError
      );
    }
  }
}
