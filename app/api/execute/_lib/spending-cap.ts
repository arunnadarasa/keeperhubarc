import "server-only";

import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { directExecutions, organizationSpendCaps } from "@/lib/db/schema";

export type SpendCapResult =
  | { allowed: true }
  | { allowed: false; reason: string };

export async function checkSpendingCap(
  organizationId: string
): Promise<SpendCapResult> {
  return await db.transaction(async (tx) => {
    const caps = await tx
      .select({ dailyCapWei: organizationSpendCaps.dailyCapWei })
      .from(organizationSpendCaps)
      .where(eq(organizationSpendCaps.organizationId, organizationId))
      .for("update")
      .limit(1);

    const cap = caps[0];

    if (!cap) {
      return { allowed: true } as const;
    }

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const result = await tx
      .select({
        totalWei: sql<string>`COALESCE(SUM(CAST(${directExecutions.gasUsedWei} AS NUMERIC)), 0)::text`,
      })
      .from(directExecutions)
      .where(
        and(
          eq(directExecutions.organizationId, organizationId),
          eq(directExecutions.status, "completed"),
          gte(directExecutions.createdAt, todayStart)
        )
      )
      .then((rows) => rows[0]);

    const totalWei = BigInt(result?.totalWei ?? "0");
    const dailyCap = BigInt(cap.dailyCapWei);

    if (totalWei >= dailyCap) {
      return { allowed: false, reason: "Daily spending cap exceeded" } as const;
    }

    return { allowed: true } as const;
  });
}
