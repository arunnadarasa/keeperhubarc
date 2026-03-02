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

export async function checkConcurrencyLimit(): Promise<ConcurrencyLimitResult> {
  const limit = getMaxConcurrent();

  const result = await db
    .select({
      count: sql<number>`COUNT(*)::int`,
    })
    .from(workflowExecutions)
    .where(eq(workflowExecutions.status, "running"))
    .then((rows) => rows[0]);

  const running = result?.count ?? 0;

  if (running >= limit) {
    return { allowed: false, running, limit };
  }

  return { allowed: true };
}
