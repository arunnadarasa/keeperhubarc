import { ErrorCategory, logSystemError } from "@/keeperhub/lib/logging";

type FallbackCompleteParams = {
  executionId: string;
  status: "success" | "error";
  error?: string;
};

/**
 * Fallback for when triggerStep({ _workflowComplete }) fails.
 * Uses fetch() to PATCH /api/internal/executions/[executionId] via HTTP loopback,
 * avoiding direct DB module imports that break the workflow bundler (nanoid/Node.js).
 */
export async function fallbackCompleteExecution(
  params: FallbackCompleteParams
): Promise<void> {
  const serviceKey = process.env.EVENTS_SERVICE_API_KEY ?? "";
  const port = process.env.PORT ?? "3000";

  try {
    const response = await fetch(
      `http://localhost:${port}/api/internal/executions/${params.executionId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Key": serviceKey,
        },
        body: JSON.stringify({
          status: params.status,
          error: params.error,
        }),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`HTTP ${response.status}: ${body}`);
    }

    console.warn(
      `[Execution Fallback] Successfully updated execution ${params.executionId} via HTTP fallback`
    );
  } catch (fallbackError) {
    logSystemError(
      ErrorCategory.INFRASTRUCTURE,
      "[Execution Fallback] HTTP fallback also failed:",
      fallbackError,
      { execution_id: params.executionId }
    );
  }
}
