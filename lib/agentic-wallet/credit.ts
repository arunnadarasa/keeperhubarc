/**
 * Initial credit grant for newly-provisioned agentic wallets.
 *
 * ONBOARD-03: $0.50 off-chain KeeperHub credit written to the
 * agentic_wallet_credits ledger at provision time. Phase 34 tooling
 * (fund / balance) reads this ledger.
 *
 * UNIQUE `(sub_org_id, allocation_reason)` in the schema guards
 * T-33-07 (double-grant race): a concurrent /provision retry for the
 * same sub-org re-throws with a clear UNIQUE-violation message.
 */
import { db } from "@/lib/db";
import { agenticWalletCredits } from "@/lib/db/schema";

export async function grantInitialCredit(subOrgId: string): Promise<void> {
  await db.insert(agenticWalletCredits).values({
    subOrgId,
    amountUsdcCents: 50, // ONBOARD-03 — $0.50 off-chain credit
    allocationReason: "onboard_initial",
  });
}
