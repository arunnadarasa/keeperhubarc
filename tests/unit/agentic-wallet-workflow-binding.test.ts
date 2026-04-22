/**
 * Phase 37 fix #2: workflow-slug binding for /sign.
 *
 * verifyWorkflowBinding(slug, payTo, amountMicro) reads the workflows
 * registry and the active organization wallet, then verifies that the
 * caller-supplied payTo + amount match the registry-derived expected
 * values. This is the server-side gate that closes the HMAC-compromise
 * drain — without it, a stolen HMAC secret could redirect a wallet's
 * funds to any address the attacker chose.
 *
 * Strategy: hoisted vi mocks for db.select() so the test stays focused
 * on the matching logic and does not require a live Postgres. The mock
 * routes the first .from() call to the workflows fixture and the second
 * to the organizationWallets fixture by tracking call order.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type WorkflowRow = {
  id: string;
  organizationId: string | null;
  priceUsdcPerCall: string | null;
  isListed: boolean;
};

type WalletRow = {
  walletAddress: string;
};

const { mockSelectQueue } = vi.hoisted(
  (): { mockSelectQueue: { rows: unknown[][] } } => ({
    mockSelectQueue: { rows: [] },
  })
);

vi.mock("@/lib/db", () => ({
  db: {
    select: (): {
      from: () => {
        where: () => {
          limit: () => Promise<unknown[]>;
        };
      };
    } => ({
      from: () => ({
        where: () => ({
          limit: (): Promise<unknown[]> => {
            const next = mockSelectQueue.rows.shift() ?? [];
            return Promise.resolve(next);
          },
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  workflows: { _table: "workflows" },
  organizationWallets: { _table: "para_wallets" },
}));

const { verifyWorkflowBinding } = await import(
  "@/lib/agentic-wallet/workflow-binding"
);

const SLUG = "test-slug";
const CREATOR = "0xCreATor000000000000000000000000000000001";
const ATTACKER = "0xAttacker0000000000000000000000000000beef";

function queueWorkflow(row: Partial<WorkflowRow> | null): void {
  if (row === null) {
    mockSelectQueue.rows.push([]);
    return;
  }
  const full: WorkflowRow = {
    id: "wf_test",
    organizationId: "org_test",
    priceUsdcPerCall: "0.05",
    isListed: true,
    ...row,
  };
  mockSelectQueue.rows.push([full]);
}

function queueWallet(row: Partial<WalletRow> | null): void {
  if (row === null) {
    mockSelectQueue.rows.push([]);
    return;
  }
  const full: WalletRow = { walletAddress: CREATOR, ...row };
  mockSelectQueue.rows.push([full]);
}

describe("verifyWorkflowBinding", () => {
  beforeEach(() => {
    mockSelectQueue.rows = [];
  });

  it("returns ok when slug + payTo + amount all match", async () => {
    queueWorkflow({});
    queueWallet({});
    const r = await verifyWorkflowBinding(SLUG, CREATOR, "50000");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.expectedPayTo).toBe(CREATOR);
      expect(r.expectedAmountMicro).toBe("50000");
      expect(r.workflowId).toBe("wf_test");
    }
  });

  it("returns 403 PAYTO_MISMATCH when payTo differs from registry", async () => {
    queueWorkflow({});
    queueWallet({});
    const r = await verifyWorkflowBinding(SLUG, ATTACKER, "50000");
    expect(r).toMatchObject({
      ok: false,
      status: 403,
      code: "PAYTO_MISMATCH",
    });
  });

  it("returns 403 AMOUNT_MISMATCH when amount differs from priceUsdcPerCall", async () => {
    queueWorkflow({});
    queueWallet({});
    const r = await verifyWorkflowBinding(SLUG, CREATOR, "100000");
    expect(r).toMatchObject({
      ok: false,
      status: 403,
      code: "AMOUNT_MISMATCH",
    });
  });

  it("returns 403 UNKNOWN_WORKFLOW for an unknown slug", async () => {
    queueWorkflow(null);
    const r = await verifyWorkflowBinding("nope", CREATOR, "50000");
    expect(r).toMatchObject({
      ok: false,
      status: 403,
      code: "UNKNOWN_WORKFLOW",
    });
  });

  it("returns 403 WORKFLOW_NOT_PAYABLE when workflow has no active org wallet", async () => {
    queueWorkflow({});
    queueWallet(null);
    const r = await verifyWorkflowBinding(SLUG, CREATOR, "50000");
    expect(r).toMatchObject({
      ok: false,
      status: 403,
      code: "WORKFLOW_NOT_PAYABLE",
    });
  });

  it("compares addresses case-insensitively", async () => {
    queueWorkflow({});
    queueWallet({ walletAddress: CREATOR.toUpperCase() });
    const r = await verifyWorkflowBinding(SLUG, CREATOR.toLowerCase(), "50000");
    expect(r.ok).toBe(true);
  });

  it("returns 400 WORKFLOW_SLUG_REQUIRED when slug is empty", async () => {
    const r = await verifyWorkflowBinding("", CREATOR, "50000");
    expect(r).toMatchObject({
      ok: false,
      status: 400,
      code: "WORKFLOW_SLUG_REQUIRED",
    });
  });

  it("returns 403 UNKNOWN_WORKFLOW when slug exists but isListed=false", async () => {
    // The SQL `where` filters on isListed=true at the DB level, so an
    // unlisted row never reaches the code. Simulate by queueing an empty
    // result for the workflow lookup.
    queueWorkflow(null);
    const r = await verifyWorkflowBinding(SLUG, CREATOR, "50000");
    expect(r).toMatchObject({
      ok: false,
      status: 403,
      code: "UNKNOWN_WORKFLOW",
    });
  });
});
