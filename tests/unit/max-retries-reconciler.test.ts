import { describe, expect, it } from "vitest";

import {
  type ExecutionLog,
  getFailedMaxRetriesNodeIds,
  reconcileMaxRetriesFailures,
} from "@/keeperhub/lib/max-retries-reconciler";

describe("getFailedMaxRetriesNodeIds", () => {
  it("should return node IDs with max-retries errors", () => {
    const results = {
      "node-1": { success: true },
      "node-2": {
        success: false,
        error: 'Step "step//abc//sendWebhook" exceeded max retries (0 retries)',
      },
      "node-3": { success: false, error: "HTTP 500 Internal Server Error" },
    };

    expect(getFailedMaxRetriesNodeIds(results)).toEqual(["node-2"]);
  });

  it("should return empty array when no max-retries errors", () => {
    const results = {
      "node-1": { success: true },
      "node-2": { success: false, error: "Connection refused" },
    };

    expect(getFailedMaxRetriesNodeIds(results)).toEqual([]);
  });
});

describe("reconcileMaxRetriesFailures", () => {
  it("should return empty when no max-retries failures exist", () => {
    const results: Record<string, { success: boolean; error?: string }> = {
      "node-1": { success: true },
      "node-2": { success: false, error: "HTTP 500 Internal Server Error" },
    };

    const output = reconcileMaxRetriesFailures({
      results,
      executionLogs: [],

    });

    expect(output.overriddenNodeIds).toEqual([]);
    expect(results["node-2"]?.success).toBe(false);
  });

  it("should override to success when all logs for the node are success", () => {
    const results: Record<
      string,
      { success: boolean; error?: string; data?: unknown }
    > = {
      "node-1": { success: true },
      "node-2": {
        success: false,
        error: 'Step "step//abc//sendWebhook" exceeded max retries (0 retries)',
      },
    };

    const executionLogs: ExecutionLog[] = [
      {
        nodeId: "node-2",
        status: "success",
        output: { statusCode: 200, body: "ok" },
      },
    ];

    const output = reconcileMaxRetriesFailures({
      results,
      executionLogs,

    });

    expect(output.overriddenNodeIds).toEqual(["node-2"]);
    expect(results["node-2"]).toEqual({
      success: true,
      data: { statusCode: 200, body: "ok" },
    });
  });

  it("should NOT override when there is an error log for the node", () => {
    const results: Record<string, { success: boolean; error?: string }> = {
      "node-1": {
        success: false,
        error: 'Step "step//abc//sendWebhook" exceeded max retries (1 retry)',
      },
    };

    const executionLogs: ExecutionLog[] = [
      { nodeId: "node-1", status: "success", output: { statusCode: 200 } },
      { nodeId: "node-1", status: "error", output: null },
    ];

    const output = reconcileMaxRetriesFailures({
      results,
      executionLogs,

    });

    expect(output.overriddenNodeIds).toEqual([]);
    expect(results["node-1"]?.success).toBe(false);
  });

  it("should NOT override when there are no logs at all for the node", () => {
    const results: Record<string, { success: boolean; error?: string }> = {
      "node-1": {
        success: false,
        error: 'Step "step//abc//condition" exceeded max retries (0 retries)',
      },
    };

    const output = reconcileMaxRetriesFailures({
      results,
      executionLogs: [],

    });

    expect(output.overriddenNodeIds).toEqual([]);
    expect(results["node-1"]?.success).toBe(false);
  });

  it("should handle multiple failed nodes independently", () => {
    const results: Record<
      string,
      { success: boolean; error?: string; data?: unknown }
    > = {
      "node-1": {
        success: false,
        error: 'Step "step//a//webhook" exceeded max retries (0 retries)',
      },
      "node-2": {
        success: false,
        error: 'Step "step//b//condition" exceeded max retries (0 retries)',
      },
      "node-3": { success: true },
    };

    const executionLogs: ExecutionLog[] = [
      { nodeId: "node-1", status: "success", output: { sent: true } },
      { nodeId: "node-2", status: "success", output: { result: true } },
      { nodeId: "node-2", status: "error", output: null },
    ];

    const output = reconcileMaxRetriesFailures({
      results,
      executionLogs,

    });

    expect(output.overriddenNodeIds).toEqual(["node-1"]);
    expect(results["node-1"]).toEqual({ success: true, data: { sent: true } });
    expect(results["node-2"]?.success).toBe(false);
    expect(results["node-3"]?.success).toBe(true);
  });

  it("should not touch results for non-max-retries failures", () => {
    const results: Record<
      string,
      { success: boolean; error?: string; data?: unknown }
    > = {
      "node-1": {
        success: false,
        error: 'Step "step//a//webhook" exceeded max retries (0 retries)',
      },
      "node-2": {
        success: false,
        error: "Connection refused",
      },
    };

    const executionLogs: ExecutionLog[] = [
      { nodeId: "node-1", status: "success", output: { ok: true } },
    ];

    const output = reconcileMaxRetriesFailures({
      results,
      executionLogs,

    });

    expect(output.overriddenNodeIds).toEqual(["node-1"]);
    expect(results["node-2"]?.success).toBe(false);
    expect(results["node-2"]?.error).toBe("Connection refused");
  });
});
