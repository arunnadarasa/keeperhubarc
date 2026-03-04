import { ErrorCategory, logSystemError } from "@/keeperhub/lib/logging";

type ExecutionLog = {
  nodeId: string;
  status: string;
  output: unknown;
};

/**
 * KEEP-1541: Fetch execution logs via HTTP loopback to avoid importing DB
 * modules in the workflow bundle. Same pattern as execution-fallback.ts.
 *
 * Returns the logs on success, or undefined if the request fails or config
 * is missing (caller should skip reconciliation in that case).
 */
export async function fetchExecutionLogs(
  executionId: string,
  nodeIds: string[]
): Promise<ExecutionLog[] | undefined> {
  const serviceKey = process.env.EVENTS_SERVICE_API_KEY;
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

  if (!(baseUrl && serviceKey)) {
    return undefined;
  }

  try {
    const response = await fetch(`${baseUrl}/api/internal/execution-logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Service-Key": serviceKey,
      },
      body: JSON.stringify({ executionId, nodeIds }),
    });

    if (!response.ok) {
      return undefined;
    }

    const { logs } = (await response.json()) as { logs: ExecutionLog[] };
    return logs;
  } catch (error) {
    logSystemError(
      ErrorCategory.EXTERNAL_SERVICE,
      "[Workflow Executor] Failed to fetch execution logs for reconciliation:",
      error,
      { execution_id: executionId }
    );
    return undefined;
  }
}
