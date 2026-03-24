import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db", () => ({
  db: {},
}));

vi.mock("@/lib/db/schema", () => ({
  workflowExecutions: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
}));

import { determineExecutionMode } from "../../keeperhub-executor/execution-mode";
import type { WorkflowNode } from "../../lib/workflow-store";

function makeNode(
  type: "trigger" | "action" | "add",
  actionType?: string
): WorkflowNode {
  return {
    id: `node-${Math.random()}`,
    position: { x: 0, y: 0 },
    data: {
      label: "Test",
      type,
      config: actionType ? { actionType } : {},
    },
  } as WorkflowNode;
}

describe("determineExecutionMode", () => {
  it("returns in-process for empty nodes", () => {
    expect(determineExecutionMode([])).toBe("in-process");
  });

  it("returns in-process for trigger-only nodes", () => {
    const nodes = [makeNode("trigger")];
    expect(determineExecutionMode(nodes)).toBe("in-process");
  });

  it("returns in-process for read-only web3 actions", () => {
    const nodes = [
      makeNode("trigger"),
      makeNode("action", "web3/check-balance"),
      makeNode("action", "web3/read-contract"),
    ];
    expect(determineExecutionMode(nodes)).toBe("in-process");
  });

  it("returns in-process for web2 actions", () => {
    const nodes = [
      makeNode("trigger"),
      makeNode("action", "discord/send-message"),
      makeNode("action", "webhook/send-webhook"),
    ];
    expect(determineExecutionMode(nodes)).toBe("in-process");
  });

  it("returns k8s-job for web3 write actions", () => {
    const nodes = [
      makeNode("trigger"),
      makeNode("action", "web3/transfer-funds"),
    ];
    expect(determineExecutionMode(nodes)).toBe("k8s-job");
  });

  it("returns k8s-job if any node is a write action", () => {
    const nodes = [
      makeNode("trigger"),
      makeNode("action", "web3/check-balance"),
      makeNode("action", "web3/write-contract"),
      makeNode("action", "discord/send-message"),
    ];
    expect(determineExecutionMode(nodes)).toBe("k8s-job");
  });

  it("returns k8s-job for transfer-token", () => {
    const nodes = [makeNode("action", "web3/transfer-token")];
    expect(determineExecutionMode(nodes)).toBe("k8s-job");
  });

  it("returns k8s-job for approve-token", () => {
    const nodes = [makeNode("action", "web3/approve-token")];
    expect(determineExecutionMode(nodes)).toBe("k8s-job");
  });

  it("returns in-process for unknown action types", () => {
    const nodes = [makeNode("action", "nonexistent/action")];
    expect(determineExecutionMode(nodes)).toBe("in-process");
  });

  it("returns in-process for nodes without actionType", () => {
    const nodes = [makeNode("action")];
    expect(determineExecutionMode(nodes)).toBe("in-process");
  });
});
