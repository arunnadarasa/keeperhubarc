import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildEdgesBySource,
  buildEdgesByTarget,
  getReadyDownstreamIds,
  propagateConvergenceSkips,
  signalConvergenceArrival,
} from "@/lib/convergence-barrier";

describe("convergence barrier", () => {
  describe("basic convergence: A -> [B, C, D] -> E", () => {
    const edges = [
      { source: "A", target: "B" },
      { source: "A", target: "C" },
      { source: "A", target: "D" },
      { source: "B", target: "E" },
      { source: "C", target: "E" },
      { source: "D", target: "E" },
    ];

    it("should detect E as a convergence node with 3 incoming edges", () => {
      const targetMap = buildEdgesByTarget(edges);
      const sources = targetMap.get("E");
      expect(sources).toEqual(["B", "C", "D"]);
      expect(sources?.length).toBe(3);
    });

    it("should block E when only first branch arrives", () => {
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();
      const visited = new Set<string>();

      const ready = getReadyDownstreamIds(
        "B",
        ["E"],
        targetMap,
        arrivals,
        visited
      );
      expect(ready).toEqual([]);
      expect(arrivals.get("E")?.size).toBe(1);
    });

    it("should block E when two branches have arrived", () => {
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();
      const visited = new Set<string>();

      getReadyDownstreamIds("B", ["E"], targetMap, arrivals, visited);
      const ready = getReadyDownstreamIds(
        "C",
        ["E"],
        targetMap,
        arrivals,
        visited
      );
      expect(ready).toEqual([]);
      expect(arrivals.get("E")?.size).toBe(2);
    });

    it("should release E when all three branches have arrived", () => {
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();
      const visited = new Set<string>();

      getReadyDownstreamIds("B", ["E"], targetMap, arrivals, visited);
      getReadyDownstreamIds("C", ["E"], targetMap, arrivals, visited);
      const ready = getReadyDownstreamIds(
        "D",
        ["E"],
        targetMap,
        arrivals,
        visited
      );
      expect(ready).toEqual(["E"]);
      expect(arrivals.get("E")?.size).toBe(3);
    });

    it("should not block non-convergence nodes", () => {
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();
      const visited = new Set<string>();

      const ready = getReadyDownstreamIds(
        "A",
        ["B", "C", "D"],
        targetMap,
        arrivals,
        visited
      );
      expect(ready).toEqual(["B", "C", "D"]);
    });
  });

  describe("mixed topology: A -> [B, C] -> E, A -> D -> F", () => {
    const edges = [
      { source: "A", target: "B" },
      { source: "A", target: "C" },
      { source: "A", target: "D" },
      { source: "B", target: "E" },
      { source: "C", target: "E" },
      { source: "D", target: "F" },
    ];

    it("should detect E as convergence (2 incoming) but not F (1 incoming)", () => {
      const targetMap = buildEdgesByTarget(edges);
      expect(targetMap.get("E")?.length).toBe(2);
      expect(targetMap.get("F")?.length).toBe(1);
    });

    it("should block E until both B and C arrive", () => {
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();
      const visited = new Set<string>();

      const first = getReadyDownstreamIds(
        "B",
        ["E"],
        targetMap,
        arrivals,
        visited
      );
      expect(first).toEqual([]);

      const second = getReadyDownstreamIds(
        "C",
        ["E"],
        targetMap,
        arrivals,
        visited
      );
      expect(second).toEqual(["E"]);
    });

    it("should not block F (single incoming edge from D)", () => {
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();
      const visited = new Set<string>();

      const ready = getReadyDownstreamIds(
        "D",
        ["F"],
        targetMap,
        arrivals,
        visited
      );
      expect(ready).toEqual(["F"]);
    });
  });

  describe("duplicate arrival from same source is idempotent", () => {
    const edges = [
      { source: "B", target: "E" },
      { source: "C", target: "E" },
    ];

    it("should not count duplicate arrivals from the same source", () => {
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();
      const visited = new Set<string>();

      getReadyDownstreamIds("B", ["E"], targetMap, arrivals, visited);
      getReadyDownstreamIds("B", ["E"], targetMap, arrivals, visited);
      const ready = getReadyDownstreamIds(
        "B",
        ["E"],
        targetMap,
        arrivals,
        visited
      );

      expect(ready).toEqual([]);
      expect(arrivals.get("E")?.size).toBe(1);
    });
  });

  describe("condition skip propagation", () => {
    it("should signal arrival at convergence node from skipped branch", () => {
      // Condition -> [true: B, false: C] -> E
      const edges = [
        { source: "Cond", target: "B" },
        { source: "Cond", target: "C" },
        { source: "B", target: "E" },
        { source: "C", target: "E" },
      ];
      const sourceMap = buildEdgesBySource(edges);
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();
      const visited = new Set<string>();

      // Condition takes true branch (B), skips false branch (C)
      const unblocked = propagateConvergenceSkips(
        ["C"],
        sourceMap,
        targetMap,
        arrivals,
        visited
      );

      // C's arrival at E was signaled, but E still needs B's arrival
      expect(unblocked).toEqual([]);
      expect(arrivals.get("E")?.has("C")).toBe(true);
      expect(arrivals.get("E")?.size).toBe(1);

      // Now B arrives at E
      const ready = getReadyDownstreamIds(
        "B",
        ["E"],
        targetMap,
        arrivals,
        visited
      );
      expect(ready).toEqual(["E"]);
    });

    it("should unblock convergence when skip is the last arrival", () => {
      // B already arrived, then C gets skipped
      const edges = [
        { source: "B", target: "E" },
        { source: "C", target: "E" },
      ];
      const sourceMap = buildEdgesBySource(edges);
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();
      const visited = new Set<string>();

      // B arrives first
      signalConvergenceArrival("B", ["E"], targetMap, arrivals, visited);
      expect(arrivals.get("E")?.size).toBe(1);

      // C gets skipped and propagation signals its arrival
      const unblocked = propagateConvergenceSkips(
        ["C"],
        sourceMap,
        targetMap,
        arrivals,
        visited
      );
      expect(unblocked).toEqual(["E"]);
    });

    it("should propagate through chain of non-convergence nodes to reach convergence", () => {
      // Cond -> [true: B, false: C -> D] -> E
      // C is skipped, D is downstream of C and leads to E
      const edges = [
        { source: "Cond", target: "B" },
        { source: "Cond", target: "C" },
        { source: "C", target: "D" },
        { source: "B", target: "E" },
        { source: "D", target: "E" },
      ];
      const sourceMap = buildEdgesBySource(edges);
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();
      const visited = new Set<string>();

      // Skip C, which chains through D to E
      const unblocked = propagateConvergenceSkips(
        ["C"],
        sourceMap,
        targetMap,
        arrivals,
        visited
      );

      // D is not a convergence node so skip propagates through it
      // E gets arrival from D (via skip chain)
      expect(arrivals.get("E")?.has("D")).toBe(true);
      expect(unblocked).toEqual([]);

      // B arrives at E, completing the barrier
      const ready = getReadyDownstreamIds(
        "B",
        ["E"],
        targetMap,
        arrivals,
        visited
      );
      expect(ready).toEqual(["E"]);
    });
  });

  describe("failure signaling at convergence nodes", () => {
    it("should allow signaling arrival for failed nodes", () => {
      // A -> [B, C] -> E where B fails
      const edges = [
        { source: "B", target: "E" },
        { source: "C", target: "E" },
      ];
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();
      const visited = new Set<string>();

      // B fails: signal arrival at E (same call the catch block makes)
      signalConvergenceArrival("B", ["E"], targetMap, arrivals, visited);

      // C completes and triggers barrier check
      const ready = getReadyDownstreamIds(
        "C",
        ["E"],
        targetMap,
        arrivals,
        visited
      );
      expect(ready).toEqual(["E"]);
    });
  });
});
