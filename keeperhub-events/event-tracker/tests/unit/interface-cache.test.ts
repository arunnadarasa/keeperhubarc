import { ethers } from "ethers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearInterfaceCache,
  getInterface,
  getInterfaceCacheSize,
} from "../../src/chains/interface-cache";

const ERC20_EVENTS = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Approval",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "spender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
];

const OTHER_EVENTS = [
  {
    type: "event",
    name: "Emitted",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
  },
];

// Production call site (evm-chain.ts) passes `rawEventsAbi.map(buildEventAbi)`
// which returns `string[]` of signature strings, not the AbiEvent object
// array above. Both shapes are valid ethers.InterfaceAbi, but we cache on
// hashed content so the cache key spaces are disjoint. Tests here must
// exercise the string-array shape that real listeners pass.
const ERC20_EVENT_STRINGS = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)",
];

describe("interface-cache", () => {
  beforeEach(() => {
    clearInterfaceCache();
  });

  it("returns the same Interface instance for the same ABI", () => {
    const a = getInterface(ERC20_EVENTS);
    const b = getInterface(ERC20_EVENTS);
    expect(a).toBe(b);
    expect(getInterfaceCacheSize()).toBe(1);
  });

  it("returns the same Interface for a deep-cloned equivalent ABI", () => {
    const clone = JSON.parse(JSON.stringify(ERC20_EVENTS));
    const a = getInterface(ERC20_EVENTS);
    const b = getInterface(clone);
    expect(a).toBe(b);
    expect(getInterfaceCacheSize()).toBe(1);
  });

  it("creates separate Interface instances for different ABIs", () => {
    const a = getInterface(ERC20_EVENTS);
    const b = getInterface(OTHER_EVENTS);
    expect(a).not.toBe(b);
    expect(getInterfaceCacheSize()).toBe(2);
  });

  it("produces an Interface that decodes logs correctly", () => {
    const iface = getInterface(ERC20_EVENTS);
    const from = "0x0000000000000000000000000000000000000001";
    const to = "0x0000000000000000000000000000000000000002";
    const value = 123n;

    const encoded = iface.encodeEventLog("Transfer", [from, to, value]);
    const parsed = iface.parseLog({
      topics: encoded.topics,
      data: encoded.data,
    });
    expect(parsed?.name).toBe("Transfer");
    expect(parsed?.args.from.toLowerCase()).toBe(from);
    expect(parsed?.args.to.toLowerCase()).toBe(to);
    expect(parsed?.args.value).toBe(value);
  });

  it("decoding still works after a cache hit", () => {
    getInterface(ERC20_EVENTS); // populate
    const iface = getInterface(ERC20_EVENTS); // hit
    const topics = [
      ethers.id("Transfer(address,address,uint256)"),
      ethers.zeroPadValue("0x0000000000000000000000000000000000000001", 32),
      ethers.zeroPadValue("0x0000000000000000000000000000000000000002", 32),
    ];
    const data = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [7n]);
    const parsed = iface.parseLog({ topics, data });
    expect(parsed?.name).toBe("Transfer");
    expect(parsed?.args.value).toBe(7n);
  });

  it("clearInterfaceCache empties the cache", () => {
    getInterface(ERC20_EVENTS);
    getInterface(OTHER_EVENTS);
    expect(getInterfaceCacheSize()).toBe(2);
    clearInterfaceCache();
    expect(getInterfaceCacheSize()).toBe(0);
  });

  describe("production call shape (string[])", () => {
    it("caches by content for the signature-string array shape", () => {
      const a = getInterface(ERC20_EVENT_STRINGS);
      const b = getInterface(ERC20_EVENT_STRINGS);
      expect(a).toBe(b);
      expect(getInterfaceCacheSize()).toBe(1);
    });

    it("produces an Interface that decodes logs correctly", () => {
      const iface = getInterface(ERC20_EVENT_STRINGS);
      const from = "0x0000000000000000000000000000000000000001";
      const to = "0x0000000000000000000000000000000000000002";
      const value = 42n;

      const encoded = iface.encodeEventLog("Transfer", [from, to, value]);
      const parsed = iface.parseLog({
        topics: encoded.topics,
        data: encoded.data,
      });
      expect(parsed?.name).toBe("Transfer");
      expect(parsed?.args.value).toBe(value);
    });

    it("string shape and object shape hash to different cache keys", () => {
      // Same logical ABI in two different representations. Both valid,
      // but they serialise differently so they miss each other's cache.
      // Documented-as-overhead behaviour; the assertion here locks it in.
      const fromStrings = getInterface(ERC20_EVENT_STRINGS);
      const fromObjects = getInterface(ERC20_EVENTS);
      expect(fromStrings).not.toBe(fromObjects);
      expect(getInterfaceCacheSize()).toBe(2);
    });
  });
});
