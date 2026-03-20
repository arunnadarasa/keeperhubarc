import type { Edge, Node } from "@xyflow/react";

const NODE_WIDTH = 192;
const NODE_HEIGHT = 192;
const H_GAP = 60;
const V_GAP = 40;

type GraphData = {
  outEdges: Map<string, Edge[]>;
  inDegree: Map<string, number>;
};

function buildGraph(realNodes: Node[], forwardEdges: Edge[]): GraphData {
  const outEdges = new Map<string, Edge[]>();
  const inDegree = new Map<string, number>();

  for (const node of realNodes) {
    outEdges.set(node.id, []);
    inDegree.set(node.id, 0);
  }

  for (const edge of forwardEdges) {
    const out = outEdges.get(edge.source);
    if (out) {
      out.push(edge);
    }
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  return { outEdges, inDegree };
}

function findRoots(realNodes: Node[], inDegree: Map<string, number>): string[] {
  const roots: string[] = [];
  const triggerNode = realNodes.find((n) => n.type === "trigger");

  if (triggerNode && inDegree.get(triggerNode.id) === 0) {
    roots.push(triggerNode.id);
  }

  for (const node of realNodes) {
    if (inDegree.get(node.id) === 0 && !roots.includes(node.id)) {
      roots.push(node.id);
    }
  }

  return roots;
}

/**
 * Assign columns using longest-path from roots (topological order).
 * This correctly handles convergence: a node with multiple parents
 * gets placed at max(parent columns) + 1.
 */
function assignColumns(
  roots: string[],
  outEdges: Map<string, Edge[]>,
  inDegree: Map<string, number>
): Map<string, number> {
  const column = new Map<string, number>();
  const remaining = new Map<string, number>();

  for (const [id, deg] of inDegree) {
    remaining.set(id, deg);
  }

  const queue: string[] = [];
  for (const root of roots) {
    column.set(root, 0);
    queue.push(root);
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentCol = column.get(current) ?? 0;

    for (const edge of outEdges.get(current) ?? []) {
      const child = edge.target;
      const newCol = currentCol + 1;
      const existing = column.get(child);
      if (existing === undefined || newCol > existing) {
        column.set(child, newCol);
      }

      const rem = (remaining.get(child) ?? 1) - 1;
      remaining.set(child, rem);
      if (rem <= 0) {
        queue.push(child);
      }
    }
  }

  return column;
}

/**
 * Sort outgoing edges of each node so that:
 * - "true"/"loop" targets come first (top)
 * - normal targets in the middle
 * - "false"/"done" targets last (bottom)
 */
function sortedChildren(
  nodeId: string,
  outEdges: Map<string, Edge[]>
): string[] {
  const edges = outEdges.get(nodeId) ?? [];
  const top: string[] = [];
  const normal: string[] = [];
  const bottom: string[] = [];

  for (const edge of edges) {
    const handle = edge.sourceHandle;
    if (handle === "true" || handle === "loop") {
      top.push(edge.target);
    } else if (handle === "false" || handle === "done") {
      bottom.push(edge.target);
    } else {
      normal.push(edge.target);
    }
  }

  return [...top, ...normal, ...bottom];
}

/**
 * Compute the "owned subtree size" for each node.
 * A node's owned size is how many vertical rows it and its
 * exclusive descendants need. Shared nodes (convergence points)
 * are only counted once -- by the first DFS path that reaches them.
 */
function computeOwnedSize(
  nodeId: string,
  outEdges: Map<string, Edge[]>,
  claimed: Set<string>,
  cache: Map<string, number>
): number {
  if (cache.has(nodeId)) {
    return cache.get(nodeId) ?? 1;
  }
  if (claimed.has(nodeId)) {
    return 0;
  }
  claimed.add(nodeId);

  const children = sortedChildren(nodeId, outEdges);
  if (children.length === 0) {
    cache.set(nodeId, 1);
    return 1;
  }

  // Any node with multiple children fans out vertically (sum sizes).
  // Single-child nodes are linear (inherit the child's size).
  let size = 0;
  if (children.length > 1) {
    for (const child of children) {
      size += computeOwnedSize(child, outEdges, claimed, cache);
    }
  } else {
    for (const child of children) {
      const cs = computeOwnedSize(child, outEdges, claimed, cache);
      if (cs > size) {
        size = cs;
      }
    }
  }

  const result = Math.max(size, 1);
  cache.set(nodeId, result);
  return result;
}

type LayoutState = {
  positions: Map<string, { x: number; y: number }>;
  columns: Map<string, number>;
  outEdges: Map<string, Edge[]>;
  placed: Set<string>;
  ownedSizes: Map<string, number>;
};

/** Place a node at the given vertical band and recurse into children. */
function placeNode(
  nodeId: string,
  bandTop: number,
  bandHeight: number,
  state: LayoutState
): void {
  if (state.placed.has(nodeId)) {
    return;
  }
  state.placed.add(nodeId);

  const col = state.columns.get(nodeId) ?? 0;
  const x = col * (NODE_WIDTH + H_GAP);
  const centerY = bandTop + bandHeight / 2 - NODE_HEIGHT / 2;
  state.positions.set(nodeId, { x, y: centerY });

  const children = sortedChildren(nodeId, state.outEdges);
  if (children.length === 0) {
    return;
  }

  if (children.length > 1) {
    placeBranchChildren(children, bandTop, bandHeight, state);
  } else {
    placeLinearChildren(children, bandTop, bandHeight, state);
  }
}

/** Place children of a branching node, dividing vertical band by owned sizes */
function placeBranchChildren(
  children: string[],
  bandTop: number,
  bandHeight: number,
  state: LayoutState
): void {
  // Compute how much vertical space each child needs
  let totalSize = 0;
  const sizes: Array<{ id: string; size: number }> = [];
  for (const child of children) {
    const size = state.ownedSizes.get(child) ?? 1;
    sizes.push({ id: child, size });
    totalSize += size;
  }

  if (totalSize === 0) {
    return;
  }

  // Divide the band proportionally
  let currentTop = bandTop;
  for (const entry of sizes) {
    const childBandHeight = (entry.size / totalSize) * bandHeight;
    placeNode(entry.id, currentTop, childBandHeight, state);
    currentTop += childBandHeight;
  }
}

/** Place children of a linear node -- they all share the same band */
function placeLinearChildren(
  children: string[],
  bandTop: number,
  bandHeight: number,
  state: LayoutState
): void {
  for (const child of children) {
    placeNode(child, bandTop, bandHeight, state);
  }
}

/**
 * Compute a clean left-to-right DAG layout for workflow nodes.
 *
 * - Columns via longest-path topological sort (handles convergence)
 * - Vertical bands via DFS with owned-subtree sizing
 * - Branching nodes (Condition, ForEach) fan out: true/loop on top, false/done on bottom
 */
export function computeAutoLayout(
  nodes: Node[],
  edges: Edge[]
): Map<string, { x: number; y: number }> {
  const realNodes = nodes.filter((n) => n.type !== "add");
  const realNodeIds = new Set(realNodes.map((n) => n.id));

  const forwardEdges = edges.filter(
    (e) =>
      realNodeIds.has(e.source) &&
      realNodeIds.has(e.target) &&
      e.sourceHandle !== "loop"
  );

  const graph = buildGraph(realNodes, forwardEdges);
  const roots = findRoots(realNodes, graph.inDegree);
  const columns = assignColumns(roots, graph.outEdges, graph.inDegree);

  // Compute owned subtree sizes for vertical spacing
  const ownedSizes = new Map<string, number>();
  const claimed = new Set<string>();
  for (const root of roots) {
    computeOwnedSize(root, graph.outEdges, claimed, ownedSizes);
  }

  // Total vertical space needed
  let totalRows = 0;
  for (const root of roots) {
    totalRows += ownedSizes.get(root) ?? 1;
  }
  const totalHeight = totalRows * (NODE_HEIGHT + V_GAP);

  const state: LayoutState = {
    positions: new Map(),
    columns,
    outEdges: graph.outEdges,
    placed: new Set(),
    ownedSizes,
  };

  // Place each root in its vertical band
  let currentTop = 0;
  for (const root of roots) {
    const rootSize = ownedSizes.get(root) ?? 1;
    const bandHeight = (rootSize / totalRows) * totalHeight;
    placeNode(root, currentTop, bandHeight, state);
    currentTop += bandHeight;
  }

  // Place any unplaced nodes (cycles or truly disconnected)
  let unplacedY = currentTop;
  for (const node of realNodes) {
    if (!state.placed.has(node.id)) {
      const col = columns.get(node.id) ?? 0;
      state.positions.set(node.id, {
        x: col * (NODE_WIDTH + H_GAP),
        y: unplacedY,
      });
      unplacedY += NODE_HEIGHT + V_GAP;
    }
  }

  // Post-process: center convergence nodes between their placed parents
  centerConvergenceNodes(state.positions, forwardEdges, graph.inDegree);

  return state.positions;
}

/**
 * For nodes with multiple parents, reposition them to the vertical
 * center of their parents. This keeps convergence points aligned
 * with the visual midpoint of the branches feeding into them.
 * Also shifts all downstream nodes by the same delta.
 */
type AdjacencyLists = {
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
};

function buildAdjacencyLists(forwardEdges: Edge[]): AdjacencyLists {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();

  for (const edge of forwardEdges) {
    const p = parents.get(edge.target);
    if (p) {
      p.push(edge.source);
    } else {
      parents.set(edge.target, [edge.source]);
    }
    const c = children.get(edge.source);
    if (c) {
      c.push(edge.target);
    } else {
      children.set(edge.source, [edge.target]);
    }
  }

  return { parents, children };
}

function computeParentCenterY(
  nodeParents: string[],
  positions: Map<string, { x: number; y: number }>
): number | undefined {
  let sumY = 0;
  let count = 0;
  for (const parentId of nodeParents) {
    const parentPos = positions.get(parentId);
    if (parentPos) {
      sumY += parentPos.y;
      count++;
    }
  }
  return count > 0 ? sumY / count : undefined;
}

function centerConvergenceNodes(
  positions: Map<string, { x: number; y: number }>,
  forwardEdges: Edge[],
  inDegree: Map<string, number>
): void {
  const { parents, children } = buildAdjacencyLists(forwardEdges);

  for (const [nodeId, degree] of inDegree) {
    if (degree <= 1) {
      continue;
    }

    const nodeParents = parents.get(nodeId);
    const pos = positions.get(nodeId);
    if (!(nodeParents && pos)) {
      continue;
    }

    const targetY = computeParentCenterY(nodeParents, positions);
    if (targetY === undefined) {
      continue;
    }

    const deltaY = targetY - pos.y;
    if (Math.abs(deltaY) < 1) {
      continue;
    }

    shiftSubtree(nodeId, deltaY, positions, children, new Set());
  }
}

/** Shift a node and all its descendants by deltaY */
function shiftSubtree(
  nodeId: string,
  deltaY: number,
  positions: Map<string, { x: number; y: number }>,
  children: Map<string, string[]>,
  visited: Set<string>
): void {
  if (visited.has(nodeId)) {
    return;
  }
  visited.add(nodeId);

  const pos = positions.get(nodeId);
  if (pos) {
    positions.set(nodeId, { x: pos.x, y: pos.y + deltaY });
  }

  for (const child of children.get(nodeId) ?? []) {
    shiftSubtree(child, deltaY, positions, children, visited);
  }
}
