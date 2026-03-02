import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLogSystemError = vi.fn();
vi.mock("@/keeperhub/lib/logging", () => ({
  ErrorCategory: { DATABASE: "DATABASE" },
  logSystemError: (...args: unknown[]) => mockLogSystemError(...args),
}));

import { fallbackCompleteExecution } from "@/keeperhub/lib/execution-fallback";

describe("fallbackCompleteExecution", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("sends PATCH request to internal executions endpoint", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await fallbackCompleteExecution({
      executionId: "exec_1",
      status: "success",
      startTime: Date.now(),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/internal/executions/exec_1"),
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Service-Key": expect.any(String),
        }),
      })
    );
  });

  it("sends correct status and error in request body", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    await fallbackCompleteExecution({
      executionId: "exec_1",
      status: "error",
      error: "step 3 failed",
      startTime: Date.now(),
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body as string);
    expect(body).toEqual({ status: "error", error: "step 3 failed" });
  });

  it("logs success message when HTTP request succeeds", async () => {
    mockFetch.mockResolvedValue({ ok: true });

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

  it("calls logSystemError when HTTP request fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    await fallbackCompleteExecution({
      executionId: "exec_2",
      status: "error",
      error: "workflow failed",
      startTime: Date.now(),
    });

    expect(mockLogSystemError).toHaveBeenCalledWith(
      "DATABASE",
      expect.stringContaining("HTTP fallback also failed"),
      expect.any(Error),
      { execution_id: "exec_2" }
    );
  });

  it("calls logSystemError when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("connection refused"));

    await fallbackCompleteExecution({
      executionId: "exec_3",
      status: "error",
      startTime: Date.now(),
    });

    expect(mockLogSystemError).toHaveBeenCalledWith(
      "DATABASE",
      expect.stringContaining("HTTP fallback also failed"),
      expect.any(Error),
      { execution_id: "exec_3" }
    );
  });

  it("does not throw when fallback fails", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));

    await expect(
      fallbackCompleteExecution({
        executionId: "exec_4",
        status: "error",
        startTime: Date.now(),
      })
    ).resolves.toBeUndefined();
  });
});
