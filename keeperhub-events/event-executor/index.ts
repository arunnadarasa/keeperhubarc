import {
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand,
} from "@aws-sdk/client-sqs";
import express from "express";
import { KEEPERHUB_API_KEY, KEEPERHUB_API_URL, SQS_QUEUE_URL } from "./config";
import { apiRequest } from "./http-client";
import { sqs } from "./sqs-client";
import type { EventMessage, Workflow } from "./types";

const VISIBILITY_TIMEOUT = 300;
const WAIT_TIME_SECONDS = 20;
const MAX_MESSAGES = 10;

async function fetchWorkflow(workflowId: string): Promise<Workflow | null> {
  try {
    const result = await apiRequest<{ workflow: Workflow }>(
      `/api/internal/workflows/${workflowId}`,
    );
    return result.workflow;
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      return null;
    }
    throw error;
  }
}

async function createExecution(
  workflowId: string,
  userId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const result = await apiRequest<{ executionId: string }>(
    "/api/internal/executions",
    {
      method: "POST",
      body: JSON.stringify({ workflowId, userId, input }),
    },
  );
  return result.executionId;
}

async function updateExecution(
  executionId: string,
  status: "running" | "success" | "error",
  error?: string,
): Promise<void> {
  await apiRequest(`/api/internal/executions/${executionId}`, {
    method: "PATCH",
    body: JSON.stringify({ status, error }),
  });
}

async function executeWorkflow(
  workflowId: string,
  executionId: string,
  input: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(
    `${KEEPERHUB_API_URL}/api/workflow/${workflowId}/execute`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Key": KEEPERHUB_API_KEY,
      },
      body: JSON.stringify({ executionId, input }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API call failed: ${response.status} - ${errorText}`);
  }

  const result = (await response.json()) as { executionId: string };
  console.log(`[EventExecutor] Execution started: ${result.executionId}`);
}

async function processEventMessage(body: EventMessage): Promise<void> {
  const { workflowId, triggerData } = body;

  console.log(
    `[EventExecutor] Processing event trigger for workflow ${workflowId}`,
  );

  const workflow = await fetchWorkflow(workflowId);

  if (!workflow) {
    console.error(`[EventExecutor] Workflow not found: ${workflowId}`);
    return;
  }

  if (!workflow.enabled) {
    console.log(`[EventExecutor] Workflow disabled, skipping: ${workflowId}`);
    return;
  }

  const input = { triggerType: "event" as const, ...triggerData };
  const executionId = await createExecution(
    workflowId,
    workflow.userId,
    input,
  );

  console.log(`[EventExecutor] Created execution ${executionId}`);

  try {
    await executeWorkflow(workflowId, executionId, input);
  } catch (error) {
    console.error(
      `[EventExecutor] Execution failed for ${workflowId}:`,
      error,
    );

    try {
      await updateExecution(
        executionId,
        "error",
        error instanceof Error ? error.message : "Unknown error",
      );
    } catch (updateError) {
      console.error(
        `[EventExecutor] Failed to update execution ${executionId} status:`,
        updateError,
      );
    }

    throw error;
  }
}

async function processMessage(message: Message): Promise<void> {
  if (!(message.Body && message.ReceiptHandle)) {
    console.error("[EventExecutor] Invalid message:", message);
    return;
  }

  let body: EventMessage;
  try {
    body = JSON.parse(message.Body);
  } catch {
    console.error(
      "[EventExecutor] Malformed message body, deleting:",
      message.Body,
    );
    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
    return;
  }

  try {
    await processEventMessage(body);

    await sqs.send(
      new DeleteMessageCommand({
        QueueUrl: SQS_QUEUE_URL,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );

    console.log(
      `[EventExecutor] Message deleted for workflow ${body.workflowId}`,
    );
  } catch (error) {
    console.error(
      `[EventExecutor] Failed to process workflow ${body.workflowId}:`,
      error,
    );
  }
}

async function listen(): Promise<void> {
  console.log("[EventExecutor] Starting SQS listener...");
  console.log(`[EventExecutor] Queue URL: ${SQS_QUEUE_URL}`);
  console.log(`[EventExecutor] KeeperHub URL: ${KEEPERHUB_API_URL}`);

  const healthApp = express();
  const HEALTH_PORT = process.env.HEALTH_PORT || 3070;

  healthApp.get("/health", (_req, res) => {
    res.status(200).json({
      status: "ok",
      service: "event-executor",
      timestamp: new Date().toISOString(),
    });
  });

  const healthServer = healthApp.listen(HEALTH_PORT, () => {
    console.log(
      `[EventExecutor] Health check server listening on port ${HEALTH_PORT}`,
    );
  });

  const shutdownHandler = () => {
    console.log("\n[EventExecutor] Shutting down...");
    healthServer.close(() => {
      console.log("[EventExecutor] Health server closed");
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
        }),
      );

      const messages = response.Messages || [];

      if (messages.length > 0) {
        console.log(
          `[EventExecutor] Received ${messages.length} messages`,
        );

        const results = await Promise.allSettled(
          messages.map((msg) => processMessage(msg)),
        );

        for (const [idx, result] of results.entries()) {
          if (result.status === "rejected") {
            console.error(
              `[EventExecutor] Message ${idx} failed:`,
              result.reason,
            );
          }
        }
      }
    } catch (error) {
      console.error("[EventExecutor] Error receiving messages:", error);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

listen();
