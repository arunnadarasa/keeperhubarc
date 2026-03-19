import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

type EdgeLike = {
  source: string;
  target: string;
};

/**
 * Builds the reverse edge map (target -> source[]) used by the convergence
 * barrier in the workflow executor to determine how many incoming edges
 * each node has.
 */
function buildEdgesByTarget(edges: EdgeLike[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const sources = map.get(edge.target) ?? [];
    sources.push(edge.source);
    map.set(edge.target, sources);
  }
  return map;
}

function buildEdgesBySource(edges: EdgeLike[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = map.get(edge.source) ?? [];
    targets.push(edge.target);
    map.set(edge.source, targets);
  }
  return map;
}

/**
 * Mirrors the convergence barrier logic from executeReadyDownstream in the
 * workflow executor. Returns which nodes are ready to execute (all incoming
 * branches have arrived) vs which are still waiting.
 */
function simulateConvergenceBarrier(
  fromNodeId: string,
  nextNodeIds: string[],
  edgesByTarget: Map<string, string[]>,
  arrivals: Map<string, Set<string>>
): { ready: string[]; waiting: string[] } {
  const ready: string[] = [];
  const waiting: string[] = [];

  for (const nextId of nextNodeIds) {
    const incomingSources = edgesByTarget.get(nextId);
    const isConvergenceNode =
      incomingSources !== undefined && incomingSources.length > 1;

    if (isConvergenceNode) {
      let nodeArrivals = arrivals.get(nextId);
      if (nodeArrivals === undefined) {
        nodeArrivals = new Set<string>();
        arrivals.set(nextId, nodeArrivals);
      }
      nodeArrivals.add(fromNodeId);

      if (nodeArrivals.size >= incomingSources.length) {
        ready.push(nextId);
      } else {
        waiting.push(nextId);
      }
    } else {
      ready.push(nextId);
    }
  }

  return { ready, waiting };
}

/**
 * Mirrors propagateConvergenceSkips from the workflow executor.
 * BFS through skipped subtree, signaling arrival at convergence nodes.
 * Returns convergence nodes that became fully arrived (ready to execute).
 */
function simulateSkipPropagation(
  skippedNodeIds: string[],
  edgesBySource: Map<string, string[]>,
  edgesByTarget: Map<string, string[]>,
  arrivals: Map<string, Set<string>>
): string[] {
  const unblocked: string[] = [];
  const queue = [...skippedNodeIds];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift() as string;
    if (seen.has(currentId)) {
      continue;
    }
    seen.add(currentId);

    const incomingSources = edgesByTarget.get(currentId);
    const isConvergenceNode =
      incomingSources !== undefined && incomingSources.length > 1;

    if (isConvergenceNode) {
      for (const src of incomingSources) {
        if (seen.has(src) || skippedNodeIds.includes(src)) {
          let nodeArrivals = arrivals.get(currentId);
          if (nodeArrivals === undefined) {
            nodeArrivals = new Set<string>();
            arrivals.set(currentId, nodeArrivals);
          }
          nodeArrivals.add(src);
        }
      }

      if ((arrivals.get(currentId)?.size ?? 0) >= incomingSources.length) {
        unblocked.push(currentId);
        continue;
      }
    }

    const downstream = edgesBySource.get(currentId) ?? [];
    for (const downId of downstream) {
      if (!seen.has(downId)) {
        queue.push(downId);
      }
    }
  }

  return unblocked;
}

describe("convergence barrier", () => {
  describe("basic convergence: A -> [B, C, D] -> E", () => {
    const edges: EdgeLike[] = [
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

      const result = simulateConvergenceBarrier(
        "B",
        ["E"],
        targetMap,
        arrivals
      );
      expect(result.ready).toEqual([]);
      expect(result.waiting).toEqual(["E"]);
      expect(arrivals.get("E")?.size).toBe(1);
    });

    it("should block E when two branches have arrived", () => {
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();

      simulateConvergenceBarrier("B", ["E"], targetMap, arrivals);
      const result = simulateConvergenceBarrier(
        "C",
        ["E"],
        targetMap,
        arrivals
      );
      expect(result.ready).toEqual([]);
      expect(result.waiting).toEqual(["E"]);
      expect(arrivals.get("E")?.size).toBe(2);
    });

    it("should release E when all three branches have arrived", () => {
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();

      simulateConvergenceBarrier("B", ["E"], targetMap, arrivals);
      simulateConvergenceBarrier("C", ["E"], targetMap, arrivals);
      const result = simulateConvergenceBarrier(
        "D",
        ["E"],
        targetMap,
        arrivals
      );
      expect(result.ready).toEqual(["E"]);
      expect(result.waiting).toEqual([]);
      expect(arrivals.get("E")?.size).toBe(3);
    });

    it("should not block non-convergence nodes", () => {
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();

      const result = simulateConvergenceBarrier(
        "A",
        ["B", "C", "D"],
        targetMap,
        arrivals
      );
      expect(result.ready).toEqual(["B", "C", "D"]);
      expect(result.waiting).toEqual([]);
    });
  });

  describe("mixed topology: A -> [B, C] -> E, A -> D -> F", () => {
    const edges: EdgeLike[] = [
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

      const first = simulateConvergenceBarrier("B", ["E"], targetMap, arrivals);
      expect(first.ready).toEqual([]);

      const second = simulateConvergenceBarrier(
        "C",
        ["E"],
        targetMap,
        arrivals
      );
      expect(second.ready).toEqual(["E"]);
    });

    it("should not block F (single incoming edge from D)", () => {
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();

      const result = simulateConvergenceBarrier(
        "D",
        ["F"],
        targetMap,
        arrivals
      );
      expect(result.ready).toEqual(["F"]);
    });
  });

  describe("duplicate arrival from same source is idempotent", () => {
    const edges: EdgeLike[] = [
      { source: "B", target: "E" },
      { source: "C", target: "E" },
    ];

    it("should not count duplicate arrivals from the same source", () => {
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();

      simulateConvergenceBarrier("B", ["E"], targetMap, arrivals);
      simulateConvergenceBarrier("B", ["E"], targetMap, arrivals);
      const result = simulateConvergenceBarrier(
        "B",
        ["E"],
        targetMap,
        arrivals
      );

      expect(result.ready).toEqual([]);
      expect(arrivals.get("E")?.size).toBe(1);
    });
  });

  describe("condition skip propagation", () => {
    it("should signal arrival at convergence node from skipped branch", () => {
      // Condition -> [true: B, false: C] -> E
      const edges: EdgeLike[] = [
        { source: "Cond", target: "B" },
        { source: "Cond", target: "C" },
        { source: "B", target: "E" },
        { source: "C", target: "E" },
      ];
      const sourceMap = buildEdgesBySource(edges);
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();

      // Condition takes true branch (B), skips false branch (C)
      // Propagate skip for C
      const unblocked = simulateSkipPropagation(
        ["C"],
        sourceMap,
        targetMap,
        arrivals
      );

      // C's arrival at E was signaled, but E still needs B's arrival
      expect(unblocked).toEqual([]);
      expect(arrivals.get("E")?.has("C")).toBe(true);
      expect(arrivals.get("E")?.size).toBe(1);

      // Now B arrives at E
      const result = simulateConvergenceBarrier(
        "B",
        ["E"],
        targetMap,
        arrivals
      );
      expect(result.ready).toEqual(["E"]);
    });

    it("should unblock convergence when skip is the last arrival", () => {
      // B already arrived, then C gets skipped
      const edges: EdgeLike[] = [
        { source: "B", target: "E" },
        { source: "C", target: "E" },
      ];
      const sourceMap = buildEdgesBySource(edges);
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();

      // B arrives first
      simulateConvergenceBarrier("B", ["E"], targetMap, arrivals);
      expect(arrivals.get("E")?.size).toBe(1);

      // C gets skipped and propagation signals its arrival
      const unblocked = simulateSkipPropagation(
        ["C"],
        sourceMap,
        targetMap,
        arrivals
      );
      expect(unblocked).toEqual(["E"]);
    });

    it("should propagate through chain of non-convergence nodes to reach convergence", () => {
      // Cond -> [true: B, false: C -> D] -> E
      // C is skipped, D is downstream of C and leads to E
      const edges: EdgeLike[] = [
        { source: "Cond", target: "B" },
        { source: "Cond", target: "C" },
        { source: "C", target: "D" },
        { source: "B", target: "E" },
        { source: "D", target: "E" },
      ];
      const sourceMap = buildEdgesBySource(edges);
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();

      // Skip C, which chains through D to E
      const unblocked = simulateSkipPropagation(
        ["C"],
        sourceMap,
        targetMap,
        arrivals
      );

      // D is not a convergence node so skip propagates through it
      // E gets arrival from D (via skip chain)
      expect(arrivals.get("E")?.has("D")).toBe(true);
      expect(unblocked).toEqual([]);

      // B arrives at E, completing the barrier
      const result = simulateConvergenceBarrier(
        "B",
        ["E"],
        targetMap,
        arrivals
      );
      expect(result.ready).toEqual(["E"]);
    });
  });

  describe("failure signaling at convergence nodes", () => {
    it("should allow manual arrival signaling for failed nodes", () => {
      // A -> [B, C] -> E where B fails
      const edges: EdgeLike[] = [
        { source: "B", target: "E" },
        { source: "C", target: "E" },
      ];
      const targetMap = buildEdgesByTarget(edges);
      const arrivals = new Map<string, Set<string>>();

      // B fails: manually signal arrival at E (mirrors catch block logic)
      const incomingSources = targetMap.get("E") ?? [];
      expect(incomingSources.length).toBeGreaterThan(1);

      let nodeArrivals = arrivals.get("E");
      if (nodeArrivals === undefined) {
        nodeArrivals = new Set<string>();
        arrivals.set("E", nodeArrivals);
      }
      nodeArrivals.add("B");

      // C completes and triggers barrier check
      const result = simulateConvergenceBarrier(
        "C",
        ["E"],
        targetMap,
        arrivals
      );
      expect(result.ready).toEqual(["E"]);
    });
  });
});
