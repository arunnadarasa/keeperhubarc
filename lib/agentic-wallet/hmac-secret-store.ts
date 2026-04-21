/**
 * @security HMAC secret access helper. NEVER pass the returned value to
 * logSystemError, console.log, or any serializer that may surface in error
 * responses. Log only the sub-org id, never the secret material.
 *
 * Phase 33 Plan 01a: reads agentic_wallets.hmac_secret keyed by sub-org id.
 * Null return signals "unknown sub-org"; callers translate to HTTP 404.
 * T-33-02 (Information Disclosure) mitigation: module-level JSDoc guard
 * plus a negative grep in the plan's acceptance criteria.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agenticWallets } from "@/lib/db/schema";

export async function lookupHmacSecret(
  subOrgId: string
): Promise<string | null> {
  const rows = await db
    .select({ hmacSecret: agenticWallets.hmacSecret })
    .from(agenticWallets)
    .where(eq(agenticWallets.subOrgId, subOrgId))
    .limit(1);
  return rows[0]?.hmacSecret ?? null;
}
