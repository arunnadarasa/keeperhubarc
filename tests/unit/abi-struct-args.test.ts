import { describe, expect, it } from "vitest";
import { reshapeArgsForAbi } from "@/lib/abi-struct-args";

describe("reshapeArgsForAbi", () => {
  it("returns empty array unchanged", () => {
    const result = reshapeArgsForAbi([], {
      inputs: [{ name: "owner", type: "address" }],
    });
    expect(result).toEqual([]);
  });

  it("passes through simple params unchanged", () => {
    const args = ["0xABC", "0xDEF", "3000"];
    const result = reshapeArgsForAbi(args, {
      inputs: [
        { name: "tokenA", type: "address" },
        { name: "tokenB", type: "address" },
        { name: "fee", type: "uint24" },
      ],
    });
    expect(result).toEqual(["0xABC", "0xDEF", "3000"]);
  });

  it("reshapes a single tuple param from flat args", () => {
    const args = [
      "0xTokenIn",
      "0xTokenOut",
      "3000",
      "0xRecipient",
      "1000000",
      "0",
      "0",
    ];

    const result = reshapeArgsForAbi(args, {
      inputs: [
        {
          name: "params",
          type: "tuple",
          components: [
            { name: "tokenIn", type: "address" },
            { name: "tokenOut", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "recipient", type: "address" },
            { name: "amountIn", type: "uint256" },
            { name: "amountOutMinimum", type: "uint256" },
            { name: "sqrtPriceLimitX96", type: "uint160" },
          ],
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      tokenIn: "0xTokenIn",
      tokenOut: "0xTokenOut",
      fee: "3000",
      recipient: "0xRecipient",
      amountIn: "1000000",
      amountOutMinimum: "0",
      sqrtPriceLimitX96: "0",
    });
  });

  it("handles mixed simple + tuple params", () => {
    const args = ["42", "0xA", "0xB", "100"];

    const result = reshapeArgsForAbi(args, {
      inputs: [
        { name: "id", type: "uint256" },
        {
          name: "params",
          type: "tuple",
          components: [
            { name: "target", type: "address" },
            { name: "value", type: "address" },
          ],
        },
        { name: "deadline", type: "uint256" },
      ],
    });

    expect(result).toHaveLength(3);
    expect(result[0]).toBe("42");
    expect(result[1]).toEqual({ target: "0xA", value: "0xB" });
    expect(result[2]).toBe("100");
  });

  it("does not modify args when no tuple inputs exist", () => {
    const args = ["0xAddr"];
    const result = reshapeArgsForAbi(args, {
      inputs: [{ name: "owner", type: "address" }],
    });
    expect(result).toBe(args);
  });

  it("handles tuple with empty components as simple param", () => {
    const args = ["value1"];
    const result = reshapeArgsForAbi(args, {
      inputs: [{ name: "data", type: "tuple", components: [] }],
    });
    expect(result).toBe(args);
  });

  it("handles tuple without components field as simple param", () => {
    const args = ["value1"];
    const result = reshapeArgsForAbi(args, {
      inputs: [{ name: "data", type: "tuple" }],
    });
    expect(result).toBe(args);
  });
});
