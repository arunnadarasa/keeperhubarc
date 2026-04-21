import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  type AgenticWallet,
  approvalRiskLevel,
  approvalStatus,
  type NewAgenticWallet,
  type NewWalletApprovalRequest,
  agenticWallets as reexportedAgenticWallets,
  walletApprovalRequests as reexportedApprovalRequests,
  type WalletApprovalRequest,
} from "../../lib/db/schema";
import {
  agenticWallets,
  walletApprovalRequests,
} from "../../lib/db/schema-agentic-wallets";

// ONBOARD-06 invariant: agentic_wallets has NO expires_at column.
// Wave 0 RED: this test fails until lib/db/schema-agentic-wallets.ts lands (Task 2)
// and the re-export block is wired into lib/db/schema.ts (Task 3). The final GREEN
// state passes all three describe blocks.

describe("agenticWallets table: v1.8 schema", () => {
  const cfg = getTableConfig(agenticWallets);

  it("has required columns", () => {
    const cols = new Set(cfg.columns.map((c) => c.name));
    const required = [
      "id",
      "sub_org_id",
      "wallet_address_base",
      "wallet_address_tempo",
      "linked_user_id",
      "linked_at",
      "created_at",
    ];
    for (const name of required) {
      expect(cols.has(name)).toBe(true);
    }
  });

  it("has NO expires_at column (ONBOARD-06: permanent)", () => {
    const cols = new Set(cfg.columns.map((c) => c.name));
    expect(cols.has("expires_at")).toBe(false);
  });

  it("id column is primary key", () => {
    const col = cfg.columns.find((c) => c.name === "id");
    expect(col).toBeDefined();
    expect(col?.primary).toBe(true);
  });

  it("sub_org_id is unique and notNull", () => {
    const col = cfg.columns.find((c) => c.name === "sub_org_id");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(true);
    expect(col?.isUnique).toBe(true);
  });

  it("linked_user_id is nullable", () => {
    const col = cfg.columns.find((c) => c.name === "linked_user_id");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
  });

  it("created_at has default", () => {
    const col = cfg.columns.find((c) => c.name === "created_at");
    expect(col).toBeDefined();
    expect(col?.hasDefault).toBe(true);
  });

  it("linked_user_id FK uses ON DELETE SET NULL (ONBOARD-06 audit trail)", () => {
    const fk = cfg.foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === "linked_user_id")
    );
    expect(fk).toBeDefined();
    expect(fk?.onDelete).toBe("set null");
  });
});

describe("walletApprovalRequests table: v1.8 schema", () => {
  const cfg = getTableConfig(walletApprovalRequests);

  it("has required columns", () => {
    const cols = new Set(cfg.columns.map((c) => c.name));
    const required = [
      "id",
      "sub_org_id",
      "operation_payload",
      "status",
      "risk_level",
      "created_at",
      "resolved_at",
      "resolved_by_user_id",
    ];
    for (const name of required) {
      expect(cols.has(name)).toBe(true);
    }
  });

  it("status defaults to pending", () => {
    const col = cfg.columns.find((c) => c.name === "status");
    expect(col).toBeDefined();
    expect(col?.hasDefault).toBe(true);
  });

  it("risk_level is notNull with no default", () => {
    const col = cfg.columns.find((c) => c.name === "risk_level");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(false);
  });

  it("operation_payload is notNull", () => {
    const col = cfg.columns.find((c) => c.name === "operation_payload");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(true);
  });

  it("resolved_by_user_id is nullable", () => {
    const col = cfg.columns.find((c) => c.name === "resolved_by_user_id");
    expect(col).toBeDefined();
    expect(col?.notNull).toBe(false);
  });

  it("sub_org_id FK uses ON DELETE CASCADE (approval rows die with wallet)", () => {
    const fk = cfg.foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === "sub_org_id")
    );
    expect(fk).toBeDefined();
    expect(fk?.onDelete).toBe("cascade");
  });

  it("resolved_by_user_id FK uses ON DELETE SET NULL (audit preservation)", () => {
    const fk = cfg.foreignKeys.find((f) =>
      f.reference().columns.some((c) => c.name === "resolved_by_user_id")
    );
    expect(fk).toBeDefined();
    expect(fk?.onDelete).toBe("set null");
  });
});

describe("re-export: @/lib/db/schema exposes agentic-wallet tables", () => {
  it("re-exports agenticWallets as the same table object", () => {
    expect(reexportedAgenticWallets).toBe(agenticWallets);
  });

  it("re-exports walletApprovalRequests as the same table object", () => {
    expect(reexportedApprovalRequests).toBe(walletApprovalRequests);
  });

  it("re-exports approvalStatus pgEnum", () => {
    expect(approvalStatus).toBeDefined();
  });

  it("re-exports approvalRiskLevel pgEnum", () => {
    expect(approvalRiskLevel).toBeDefined();
  });

  it("re-exports all four types (compile-time check)", () => {
    const a: AgenticWallet | undefined = undefined;
    const b: NewAgenticWallet | undefined = undefined;
    const c: WalletApprovalRequest | undefined = undefined;
    const d: NewWalletApprovalRequest | undefined = undefined;
    expect([a, b, c, d]).toEqual([undefined, undefined, undefined, undefined]);
  });
});
