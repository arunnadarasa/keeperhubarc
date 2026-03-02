import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockLogWorkflowCompleteDb = vi.fn();
vi.mock("@/lib/workflow-logging", () => ({
  logWorkflowCompleteDb: (...args: unknown[]) =>
    mockLogWorkflowCompleteDb(...args),
}));

const mockLogSystemError = vi.fn();
vi.mock("@/keeperhub/lib/logging", () => ({
  ErrorCategory: { DATABASE: "DATABASE" },
  logSystemError: (...args: unknown[]) => mockLogSystemError(...args),
}));

import { fallbackCompleteExecution } from "@/keeperhub/lib/execution-fallback";

describe("fallbackCompleteExecution", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("calls logWorkflowCompleteDb with the provided params", async () => {
    mockLogWorkflowCompleteDb.mockResolvedValue(undefined);

    const params = {
      executionId: "exec_1",
      status: "success" as const,
      output: { result: "ok" },
      startTime: Date.now() - 5000,
    };

    await fallbackCompleteExecution(params);

    expect(mockLogWorkflowCompleteDb).toHaveBeenCalledWith(params);
  });

  it("logs success message when DB update succeeds", async () => {
    mockLogWorkflowCompleteDb.mockResolvedValue(undefined);

    await fallbackCompleteExecution({
      executionId: "exec_1",
      status: "error",
      error: "workflow failed",
      startTime: Date.now(),
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("exec_1")
    );
    expect(mockLogSystemError).not.toHaveBeenCalled();
  });

  it("calls logSystemError when DB fallback fails", async () => {
    const dbError = new Error("connection refused");
    mockLogWorkflowCompleteDb.mockRejectedValue(dbError);

    await fallbackCompleteExecution({
      executionId: "exec_2",
      status: "error",
      error: "workflow failed",
      startTime: Date.now(),
    });

    expect(mockLogSystemError).toHaveBeenCalledWith(
      "DATABASE",
      expect.stringContaining("DB fallback also failed"),
      dbError,
      { execution_id: "exec_2" }
    );
  });

  it("does not throw when DB fallback fails", async () => {
    mockLogWorkflowCompleteDb.mockRejectedValue(new Error("db down"));

    await expect(
      fallbackCompleteExecution({
        executionId: "exec_3",
        status: "error",
        startTime: Date.now(),
      })
    ).resolves.toBeUndefined();
  });

  it("passes error status and message correctly", async () => {
    mockLogWorkflowCompleteDb.mockResolvedValue(undefined);

    await fallbackCompleteExecution({
      executionId: "exec_4",
      status: "error",
      error: "step 3 failed: timeout",
      startTime: 1000,
    });

    expect(mockLogWorkflowCompleteDb).toHaveBeenCalledWith({
      executionId: "exec_4",
      status: "error",
      error: "step 3 failed: timeout",
      startTime: 1000,
    });
  });
});
