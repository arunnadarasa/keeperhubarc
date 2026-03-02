import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { workflowExecutions } from "@/lib/db/schema";

const DEFAULT_LIMIT = 500;

function getMaxConcurrent(): number {
  const envValue = process.env.MAX_CONCURRENT_WORKFLOW_EXECUTIONS;
  if (!envValue) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(envValue, 10);
  return Number.isNaN(parsed) ? DEFAULT_LIMIT : parsed;
}

export type ConcurrencyLimitResult =
  | { allowed: true }
  | { allowed: false; running: number; limit: number };

// Soft cap: the count-then-admit check is not atomic, so under burst load
// concurrent requests may all pass before any new execution is inserted.
// This is acceptable -- the goal is back-pressure, not a hard guarantee.
export async function checkConcurrencyLimit(): Promise<ConcurrencyLimitResult> {
  const limit = getMaxConcurrent();

  // TODO: workflow_executions.status has no DB index -- add one if this
  // query becomes a bottleneck under high execution volume.
  const [result] = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
    })
    .from(workflowExecutions)
    .where(eq(workflowExecutions.status, "running"));

  const running = result?.count ?? 0;

  if (running >= limit) {
    return { allowed: false, running, limit };
  }

  return { allowed: true };
}
