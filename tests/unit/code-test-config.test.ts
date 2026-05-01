import { describe, expect, it } from "vitest";
import { testCode } from "@/plugins/code/test";

describe("code/test - connection check", () => {
  it("succeeds without credentials", async () => {
    const result = await testCode({});
    expect(result).toEqual({ success: true });
  });

  it("accepts arbitrary credentials object", async () => {
    const result = await testCode({ key: "value", other: "thing" });
    expect(result).toEqual({ success: true });
  });
});
