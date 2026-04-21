import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { users } from "@/lib/db/schema";
import { generateId } from "@/lib/utils/id";

/**
 * Approval status pgEnum
 *
 * Lifecycle of a wallet approval request. Distinct DB type name
 * ("approval_status") to avoid collision with workflowRunStatus's
 * "status" enum.
 */
export const approvalStatus = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
]);

/**
 * Approval risk level pgEnum
 *
 * GUARD-03 classification for a pending signing operation. Distinct DB
 * type name ("approval_risk_level") to avoid collision with any other
 * status-like enum. `risk_level` is notNull with NO default: the caller
 * must explicitly classify every request.
 */
export const approvalRiskLevel = pgEnum("approval_risk_level", [
  "auto",
  "ask",
  "block",
]);

/**
 * Agentic Wallets table
 *
 * Turnkey sub-orgs owned by KeeperHub and operated on behalf of an agent
 * installation. Each row is ONE sub-org with two wallet addresses
 * (Base + Tempo). Anonymous wallets have null linked_user_id; linking
 * is late-bound via `npx @keeperhub/wallet link` (ONBOARD-04, Phase 33).
 *
 * Permanent by design (ONBOARD-06) -- there is intentionally no
 * expiry column. Wallet rows survive user deletion (linked_user_id
 * uses ON DELETE SET NULL) so cold storage stays usable.
 */
export const agenticWallets = pgTable(
  "agentic_wallets",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => generateId()),
    subOrgId: text("sub_org_id").notNull().unique(),
    walletAddressBase: text("wallet_address_base").notNull(),
    walletAddressTempo: text("wallet_address_tempo").notNull(),
    linkedUserId: text("linked_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    linkedAt: timestamp("linked_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_agentic_wallets_linked_user").on(table.linkedUserId),
    index("idx_agentic_wallets_wallet_base").on(table.walletAddressBase),
    index("idx_agentic_wallets_wallet_tempo").on(table.walletAddressTempo),
  ]
);

/**
 * Wallet Approval Requests table
 *
 * Pending signing operations awaiting human approval (GUARD-03 ask-decision).
 * Created by Phase 33's /api/agentic-wallet/approval-request endpoint,
 * resolved by the /approve endpoint. Phase 32 only defines the shape.
 *
 * FK target is agenticWallets.subOrgId (not .id) so the approval carries
 * the same identifier the agent client sends, avoiding an extra join.
 * Same precedent as explorerConfigs.chainId -> chains.chainId.
 */
export const walletApprovalRequests = pgTable(
  "wallet_approval_requests",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => generateId()),
    subOrgId: text("sub_org_id")
      .notNull()
      .references(() => agenticWallets.subOrgId, { onDelete: "cascade" }),
    operationPayload: jsonb("operation_payload")
      .notNull()
      .$type<Record<string, unknown>>(),
    status: approvalStatus("status").notNull().default("pending"),
    riskLevel: approvalRiskLevel("risk_level").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
    // SET NULL preserves the approval audit trail if the approver's user is
    // deleted. Mirrors the audit-preservation rationale on
    // agenticWallets.linked_user_id -- a deleted approver must not erase the
    // fact that an approval occurred.
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    index("idx_wallet_approval_sub_org").on(table.subOrgId),
    index("idx_wallet_approval_status").on(table.status),
    index("idx_wallet_approval_created").on(table.createdAt),
    // REVIEW MED-02: index the FK target so ON DELETE SET NULL does not
    // seq-scan wallet_approval_requests on user deletion, and so "approvals
    // resolved by user X" queries in Phase 33 use an index.
    index("idx_wallet_approval_resolved_by").on(table.resolvedByUserId),
  ]
);

export type AgenticWallet = typeof agenticWallets.$inferSelect;
export type NewAgenticWallet = typeof agenticWallets.$inferInsert;
export type WalletApprovalRequest = typeof walletApprovalRequests.$inferSelect;
export type NewWalletApprovalRequest =
  typeof walletApprovalRequests.$inferInsert;
