import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let mockRunningCount = 0;

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([{ count: mockRunningCount }])),
      })),
    })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  workflowExecutions: {
    status: "status",
  },
}));

import { checkConcurrencyLimit } from "@/keeperhub/api/execute/_lib/concurrency-limit";

describe("checkConcurrencyLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunningCount = 0;
    process.env.MAX_CONCURRENT_WORKFLOW_EXECUTIONS = undefined;
  });

  afterEach(() => {
    process.env.MAX_CONCURRENT_WORKFLOW_EXECUTIONS = undefined;
  });

  it("allows execution when running count is below default limit", async () => {
    mockRunningCount = 100;

    const result = await checkConcurrencyLimit();

    expect(result).toEqual({ allowed: true });
  });

  it("rejects execution when running count meets default limit", async () => {
    mockRunningCount = 500;

    const result = await checkConcurrencyLimit();

    expect(result).toEqual({ allowed: false, running: 500, limit: 500 });
  });

  it("rejects execution when running count exceeds default limit", async () => {
    mockRunningCount = 600;

    const result = await checkConcurrencyLimit();

    expect(result).toEqual({ allowed: false, running: 600, limit: 500 });
  });

  it("allows execution when count is zero", async () => {
    mockRunningCount = 0;

    const result = await checkConcurrencyLimit();

    expect(result).toEqual({ allowed: true });
  });

  it("uses custom limit from env var", async () => {
    process.env.MAX_CONCURRENT_WORKFLOW_EXECUTIONS = "10";
    mockRunningCount = 10;

    const result = await checkConcurrencyLimit();

    expect(result).toEqual({ allowed: false, running: 10, limit: 10 });
  });

  it("allows when below custom limit", async () => {
    process.env.MAX_CONCURRENT_WORKFLOW_EXECUTIONS = "10";
    mockRunningCount = 9;

    const result = await checkConcurrencyLimit();

    expect(result).toEqual({ allowed: true });
  });

  it("falls back to default when env var is not a number", async () => {
    process.env.MAX_CONCURRENT_WORKFLOW_EXECUTIONS = "abc";
    mockRunningCount = 499;

    const result = await checkConcurrencyLimit();

    expect(result).toEqual({ allowed: true });
  });
});
