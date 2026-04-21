import type { Edge as XYFlowEdge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { hasDuplicateEdge, normalizeHandle } from "@/lib/workflow/edge-helpers";

function edge(
  id: string,
  source: string,
  target: string,
  sourceHandle?: string | null,
  targetHandle?: string | null
): XYFlowEdge {
  return { id, source, target, sourceHandle, targetHandle };
}

describe("edge-helpers", () => {
  describe("normalizeHandle", () => {
    it("returns empty string for null", () => {
      expect(normalizeHandle(null)).toBe("");
    });

    it("returns empty string for undefined", () => {
      expect(normalizeHandle(undefined)).toBe("");
    });

    it("passes through a string value", () => {
      expect(normalizeHandle("true")).toBe("true");
    });

    it("preserves empty string", () => {
      expect(normalizeHandle("")).toBe("");
    });
  });

  describe("hasDuplicateEdge", () => {
    it("returns false when no edges exist", () => {
      expect(
        hasDuplicateEdge([], { source: "a", target: "b" })
      ).toBe(false);
    });

    it("detects duplicate when both handles are null/undefined on both sides", () => {
      const existing = [edge("e1", "a", "b")];
      expect(
        hasDuplicateEdge(existing, { source: "a", target: "b" })
      ).toBe(true);
    });

    it("treats null, undefined, and empty string handles as equivalent", () => {
      const existing = [edge("e1", "a", "b", null, null)];
      expect(
        hasDuplicateEdge(existing, {
          source: "a",
          target: "b",
          sourceHandle: "",
          targetHandle: undefined,
        })
      ).toBe(true);
    });

    it("allows different targets from the same source", () => {
      const existing = [edge("e1", "a", "b")];
      expect(
        hasDuplicateEdge(existing, { source: "a", target: "c" })
      ).toBe(false);
    });

    it("allows different sources to the same target", () => {
      const existing = [edge("e1", "a", "c")];
      expect(
        hasDuplicateEdge(existing, { source: "b", target: "c" })
      ).toBe(false);
    });

    it("allows same source->target on different source handles (Condition true/false)", () => {
      const existing = [edge("e1", "cond", "target", "true")];
      expect(
        hasDuplicateEdge(existing, {
          source: "cond",
          target: "target",
          sourceHandle: "false",
        })
      ).toBe(false);
    });

    it("rejects same source->target on the same source handle", () => {
      const existing = [edge("e1", "cond", "target", "true")];
      expect(
        hasDuplicateEdge(existing, {
          source: "cond",
          target: "target",
          sourceHandle: "true",
        })
      ).toBe(true);
    });

    it("allows same source->target on different target handles", () => {
      const existing = [edge("e1", "a", "b", null, "in-1")];
      expect(
        hasDuplicateEdge(existing, {
          source: "a",
          target: "b",
          targetHandle: "in-2",
        })
      ).toBe(false);
    });

    it("rejects when any prior edge in the list matches", () => {
      const existing = [
        edge("e1", "x", "y"),
        edge("e2", "a", "b"),
        edge("e3", "m", "n"),
      ];
      expect(
        hasDuplicateEdge(existing, { source: "a", target: "b" })
      ).toBe(true);
    });
  });
});
