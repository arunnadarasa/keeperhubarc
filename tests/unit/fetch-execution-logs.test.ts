import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchExecutionLogs } from "@/keeperhub/lib/fetch-execution-logs";

describe("fetchExecutionLogs", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("EVENTS_SERVICE_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("should return undefined when NEXT_PUBLIC_APP_URL is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    const result = await fetchExecutionLogs("exec-1", ["node-1"]);
    expect(result).toBeUndefined();
  });

  it("should return undefined when EVENTS_SERVICE_API_KEY is missing", async () => {
    vi.stubEnv("EVENTS_SERVICE_API_KEY", "");

    const result = await fetchExecutionLogs("exec-1", ["node-1"]);
    expect(result).toBeUndefined();
  });

  it("should return undefined when fetch throws a network error", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Connection refused")
    );

    const result = await fetchExecutionLogs("exec-1", ["node-1"]);
    expect(result).toBeUndefined();
  });

  it("should return undefined when response is not ok", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    );

    const result = await fetchExecutionLogs("exec-1", ["node-1"]);
    expect(result).toBeUndefined();
  });

  it("should return logs on successful response", async () => {
    const logs = [
      { nodeId: "node-1", status: "success", output: { ok: true } },
    ];

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ logs }), { status: 200 })
    );

    const result = await fetchExecutionLogs("exec-1", ["node-1"]);
    expect(result).toEqual(logs);
  });
});
