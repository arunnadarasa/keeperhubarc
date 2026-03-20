/**
 * Workflow Executor
 *
 * Polls SQS for workflow triggers (schedule and block) and executes them.
 * Runs continuously as a long-polling listener.
 *
 * Usage:
 *   pnpm executor
 *
 * Environment variables:
 *   KEEPERHUB_API_URL - KeeperHub API URL (default: http://localhost:3000)
 *   KEEPERHUB_API_KEY - Service API key for authentication
 *   AWS_ENDPOINT_URL - LocalStack endpoint (default: http://localhost:4566)
 *   SQS_QUEUE_URL - SQS queue URL (default: LocalStack queue)
 */

import {
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand,
} from "@aws-sdk/client-sqs";
import { CronExpressionParser } from "cron-parser";
import express from "express";
import { sqs } from "../lib/sqs-client.js";
import { apiRequest } from "../lib/http-client.js";
import {
  KEEPERHUB_URL,
  SERVICE_API_KEY,
  SQS_QUEUE_URL,
} from "../lib/config.js";
import type {
  BlockMessage,
  ScheduleMessage,
  Workflow,
  WorkflowMessage,
} from "../lib/types.js";

const VISIBILITY_TIMEOUT = 300; // 5 minutes
const WAIT_TIME_SECONDS = 20; // Long polling
const MAX_MESSAGES = 10;

type Schedule = {
  id: string;
  workflowId: string;
  cronExpression: string;
  timezone: string;
  enabled: boolean;
};

// Fetch workflow by ID
async function fetchWorkflow(workflowId: string): Promise<Workflow | null> {
  try {
    const result = await apiRequest<{ workflow: Workflow }>(
      `/api/internal/workflows/${workflowId}`
    );
    return result.workflow;
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      return null;
    }
    throw error;
  }
}

// Fetch schedule by ID
async function fetchSchedule(scheduleId: string): Promise<Schedule | null> {
  try {
    const result = await apiRequest<{ schedule: Schedule }>(
      `/api/internal/schedules/${scheduleId}`
    );
    return result.schedule;
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      return null;
    }
    throw error;
  }
}

// Create execution record
async function createExecution(
  workflowId: string,
  userId: string,
  input: Record<string, unknown>
): Promise<string> {
  const result = await apiRequest<{ executionId: string }>(
    "/api/internal/executions",
    {
      method: "POST",
      body: JSON.stringify({ workflowId, userId, input }),
    }
  );
  return result.executionId;
}

// Update execution status
async function updateExecution(
  executionId: string,
  status: "running" | "success" | "error",
  error?: string
): Promise<void> {
  await apiRequest(`/api/internal/executions/${executionId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, error }),
  });
}

// Update schedule status after execution
async function updateScheduleStatus(
  scheduleId: string,
  status: "success" | "error",
  error?: string
): Promise<void> {
  await apiRequest(`/api/internal/schedules/${scheduleId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, error }),
  });
}

/**
 * Compute next run time for a cron expression
 */
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

/**
 * Execute a workflow via KeeperHub API
 */
async function executeWorkflow(
  workflowId: string,
  executionId: string,
  input: Record<string, unknown>
): Promise<void> {
  const response = await fetch(
    `${KEEPERHUB_URL}/api/workflow/${workflowId}/execute`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Key": SERVICE_API_KEY,
      },
      body: JSON.stringify({ executionId, input }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API call failed: ${response.status} - ${errorText}`);
  }

  const result = (await response.json()) as { executionId: string };
  console.log(`[Executor] Execution started: ${result.executionId}`);
}

/**
 * Process a single scheduled workflow message
 */
async function processScheduledWorkflow(
  message: ScheduleMessage
): Promise<void> {
  const { workflowId, scheduleId, triggerTime } = message;

  console.log(
    `[Executor] Processing schedule trigger for workflow ${workflowId}`
  );

  // Get workflow
  const workflow = await fetchWorkflow(workflowId);

  if (!workflow) {
    console.error(`[Executor] Workflow not found: ${workflowId}`);
    await updateScheduleStatus(scheduleId, "error", "Workflow not found");
    return;
  }

  if (!workflow.enabled) {
    console.log(`[Executor] Workflow disabled, skipping: ${workflowId}`);
    return;
  }

  // Verify schedule exists and is enabled
  const schedule = await fetchSchedule(scheduleId);

  if (!schedule) {
    console.error(`[Executor] Schedule not found: ${scheduleId}`);
    return;
  }

  if (!schedule.enabled) {
    console.log(`[Executor] Schedule disabled, skipping: ${scheduleId}`);
    return;
  }

  // Create execution record
  const input = { triggerType: "schedule" as const, scheduleId, triggerTime };
  const executionId = await createExecution(workflowId, workflow.userId, input);

  console.log(`[Executor] Created execution ${executionId}`);

  try {
    await executeWorkflow(workflowId, executionId, input);

    // Update schedule status
    await updateScheduleStatus(scheduleId, "success");
  } catch (error) {
    console.error(`[Executor] Execution failed for ${workflowId}:`, error);

    // Update execution record with error
    await updateExecution(
      executionId,
      "error",
      error instanceof Error ? error.message : "Unknown error"
    );

    // Update schedule status
    await updateScheduleStatus(
      scheduleId,
      "error",
      error instanceof Error ? error.message : "Unknown error"
    );

    throw error;
  }
}

/**
 * Process a single block trigger workflow message
 */
async function processBlockWorkflow(message: BlockMessage): Promise<void> {
  const { workflowId, triggerData } = message;

  console.log(
    `[Executor] Processing block trigger for workflow ${workflowId} at block ${triggerData.blockNumber}`
  );

  // Get workflow
  const workflow = await fetchWorkflow(workflowId);

  if (!workflow) {
    console.error(`[Executor] Workflow not found: ${workflowId}`);
    return;
  }

  if (!workflow.enabled) {
    console.log(`[Executor] Workflow disabled, skipping: ${workflowId}`);
    return;
  }

  // Create execution record — use workflow.userId (source of truth) rather than
  // message.userId which may be stale if the workflow was transferred.
  const input = { triggerType: "block" as const, ...triggerData };
  const executionId = await createExecution(workflowId, workflow.userId, input);

  console.log(`[Executor] Created execution ${executionId}`);

  try {
    await executeWorkflow(workflowId, executionId, input);
  } catch (error) {
    console.error(`[Executor] Execution failed for ${workflowId}:`, error);

    // Update execution record with error
    await updateExecution(
      executionId,
      "error",
      error instanceof Error ? error.message : "Unknown error"
    );

    throw error;
  }
}

/**
 * Process a single SQS message
 */
async function processMessage(message: Message): Promise<void> {
  if (!(message.Body && message.ReceiptHandle)) {
    console.error("[Executor] Invalid message:", message);
    return;
  }

  const body: WorkflowMessage = JSON.parse(message.Body);

  try {
    if (body.triggerType === "block") {
      await processBlockWorkflow(body);
    } else {
      await processScheduledWorkflow(body);
    }

    // Delete message on success
    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        ReceiptHandle: message.ReceiptHandle,
      })
    );

    console.log(`[Executor] Message deleted for workflow ${body.workflowId}`);
  } catch (error) {
    console.error(
      `[Executor] Failed to process workflow ${body.workflowId}:`,
      error
    );
    // Don't delete message - it will become visible again after timeout
  }
}

/**
 * Main listener loop
 */
async function listen(): Promise<void> {
  console.log("[Executor] Starting SQS listener...");
  console.log(`[Executor] Queue URL: ${SQS_QUEUE_URL}`);
  console.log(`[Executor] KeeperHub URL: ${KEEPERHUB_URL}`);

  // Start health check server
  const healthApp = express();
  const HEALTH_PORT = process.env.HEALTH_PORT || 3070;

  healthApp.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "schedule-executor",
      timestamp: new Date().toISOString(),
    });
  });

  const healthServer = healthApp.listen(HEALTH_PORT, () => {
    console.log(
      `[Executor] Health check server listening on port ${HEALTH_PORT}`
    );
  });

  // Close health server on shutdown
  const shutdownHandler = () => {
    console.log("\n[Executor] Shutting down...");
    healthServer.close(() => {
      console.log("[Executor] Health server closed");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdownHandler);
  process.on("SIGTERM", shutdownHandler);

  while (true) {
    try {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: SQS_QUEUE_URL,
          MaxNumberOfMessages: MAX_MESSAGES,
          WaitTimeSeconds: WAIT_TIME_SECONDS,
          VisibilityTimeout: VISIBILITY_TIMEOUT,
          MessageAttributeNames: ["All"],
        })
      );

      const messages = response.Messages || [];

      if (messages.length > 0) {
        console.log(`[Executor] Received ${messages.length} messages`);

        // Process messages concurrently
        const results = await Promise.allSettled(
          messages.map((msg) => processMessage(msg))
        );

        // Log any failures
        for (const [idx, result] of results.entries()) {
          if (result.status === "rejected") {
            console.error(`[Executor] Message ${idx} failed:`, result.reason);
          }
        }
      }
    } catch (error) {
      console.error("[Executor] Error receiving messages:", error);
      // Back off on error
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// Start listener
listen();
