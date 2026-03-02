// start custom keeperhub code //
import { and, eq, lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

import { authenticateInternalService } from "@/keeperhub/lib/internal-service-auth";
import { db } from "@/lib/db";
import { workflowExecutionLogs, workflowExecutions } from "@/lib/db/schema";

const DEFAULT_THRESHOLD_MINUTES = 30;

function getThresholdMinutes(): number {
  const envValue = process.env.STALE_EXECUTION_THRESHOLD_MINUTES;
  if (!envValue) {
    return DEFAULT_THRESHOLD_MINUTES;
  }
  const parsed = Number.parseInt(envValue, 10);
  return Number.isNaN(parsed) ? DEFAULT_THRESHOLD_MINUTES : parsed;
}

/**
 * GET /api/internal/reaper
 *
 * Finds workflow executions stuck in "running" state with no recent activity
 * and marks them as "error" with a timeout message.
 *
 * Intended to be called by an external cron job (K8s CronJob).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = authenticateInternalService(request);
  if (!auth.authenticated) {
    return NextResponse.json(
      { error: auth.error ?? "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const thresholdMinutes = getThresholdMinutes();
    const cutoff = new Date(Date.now() - thresholdMinutes * 60 * 1000);

    const staleExecutions = await db
      .select({
        id: workflowExecutions.id,
        workflowId: workflowExecutions.workflowId,
        startedAt: workflowExecutions.startedAt,
      })
      .from(workflowExecutions)
      .where(
        and(
          eq(workflowExecutions.status, "running"),
          lt(workflowExecutions.startedAt, cutoff)
        )
      );

    if (staleExecutions.length === 0) {
      return NextResponse.json({ reapedCount: 0, reapedIds: [] });
    }

    const reapedIds: string[] = [];

    for (const execution of staleExecutions) {
      const lastLog = await db
        .select({ completedAt: workflowExecutionLogs.completedAt })
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.executionId, execution.id))
        .orderBy(sql`${workflowExecutionLogs.completedAt} DESC NULLS LAST`)
        .limit(1);

      const lastActivity = lastLog[0]?.completedAt;
      const hasRecentActivity = lastActivity && new Date(lastActivity) > cutoff;

      if (!hasRecentActivity) {
        await db
          .update(workflowExecutions)
          .set({
            status: "error",
            error: `Execution timed out: no activity for ${thresholdMinutes} minutes`,
            completedAt: new Date(),
          })
          .where(eq(workflowExecutions.id, execution.id));

        reapedIds.push(execution.id);
      }
    }

    return NextResponse.json({
      reapedCount: reapedIds.length,
      reapedIds,
    });
  } catch (error) {
    console.error("[Reaper] Failed to reap stale executions:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to reap stale executions",
      },
      { status: 500 }
    );
  }
}
// end keeperhub code //
