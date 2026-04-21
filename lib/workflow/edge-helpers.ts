import type { Edge as XYFlowEdge } from "@xyflow/react";

/** Normalize handle IDs so null/undefined/"" compare equal. */
export function normalizeHandle(handle: string | null | undefined): string {
  return handle ?? "";
}

/** True if an edge with the same source/sourceHandle -> target/targetHandle
 * already exists. Allows multiple connections between the same pair when
 * they use different handles (e.g. Condition true/false to the same target). */
export function hasDuplicateEdge(
  edges: readonly XYFlowEdge[],
  candidate: {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }
): boolean {
  const sh = normalizeHandle(candidate.sourceHandle);
  const th = normalizeHandle(candidate.targetHandle);
  return edges.some(
    (e) =>
      e.source === candidate.source &&
      e.target === candidate.target &&
      normalizeHandle(e.sourceHandle) === sh &&
      normalizeHandle(e.targetHandle) === th
  );
}
