// Wave 0 RED placeholder for the agentic-wallet schema file.
// Task 1 of plan 32-02 seeds empty stubs so the schema-shape unit test
// (tests/unit/agentic-wallets-schema.test.ts) compiles against real symbols
// but fails at runtime assertions. Task 2 replaces this file with the full
// schema (two tables, two pgEnums, six indexes, ONBOARD-06 "no expires_at"
// invariant). Task 3 wires the re-export in lib/db/schema.ts to bring the
// test fully GREEN.
import { pgEnum, pgTable, text } from "drizzle-orm/pg-core";

export const approvalStatus = pgEnum("approval_status", ["pending"]);
export const approvalRiskLevel = pgEnum("approval_risk_level", ["auto"]);

export const agenticWallets = pgTable("agentic_wallets", {
  id: text("id").primaryKey(),
});

export const walletApprovalRequests = pgTable("wallet_approval_requests", {
  id: text("id").primaryKey(),
});

export type AgenticWallet = typeof agenticWallets.$inferSelect;
export type NewAgenticWallet = typeof agenticWallets.$inferInsert;
export type WalletApprovalRequest = typeof walletApprovalRequests.$inferSelect;
export type NewWalletApprovalRequest =
  typeof walletApprovalRequests.$inferInsert;
