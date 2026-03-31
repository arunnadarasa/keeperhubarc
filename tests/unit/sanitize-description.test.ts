import { describe, expect, it } from "vitest";
import { sanitizeDescription } from "@/lib/sanitize-description";

describe("sanitizeDescription", () => {
  it("strips markdown headers and bold markers", () => {
    expect(sanitizeDescription("## Hello **world**")).toBe("Hello world");
  });

  it("strips 'you must' instruction phrase", () => {
    expect(sanitizeDescription("You must call this API")).toBe("Call this API");
  });

  it("strips 'always' instruction phrase", () => {
    expect(sanitizeDescription("Always check the balance")).toBe(
      "Check the balance"
    );
  });

  it("strips 'never' instruction phrase", () => {
    expect(sanitizeDescription("Never skip validation")).toBe(
      "Skip validation"
    );
  });

  it("strips 'you should' instruction phrase", () => {
    expect(sanitizeDescription("You should verify first")).toBe("Verify first");
  });

  it("strips 'make sure to' instruction phrase", () => {
    expect(sanitizeDescription("Make sure to confirm")).toBe("Confirm");
  });

  it("caps output at 200 characters", () => {
    const result = sanitizeDescription("a".repeat(300));
    expect(result.length).toBe(200);
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeDescription("")).toBe("");
  });

  it("returns unchanged text when no transformation needed", () => {
    expect(sanitizeDescription("Simple text")).toBe("Simple text");
  });

  it("strips bullet chars and collapses whitespace", () => {
    expect(sanitizeDescription("- list item\n- another")).toBe(
      "list item another"
    );
  });

  it("strips backticks from inline code", () => {
    expect(sanitizeDescription("`code`")).toBe("code");
  });
});
