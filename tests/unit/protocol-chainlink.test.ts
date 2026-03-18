import { describe, expect, it } from "vitest";
import { getProtocol, registerProtocol } from "@/lib/protocol-registry";
import chainlinkDef from "@/protocols/chainlink";

const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const HEX_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

describe("Chainlink Protocol Definition", () => {
  it("imports without throwing", () => {
    expect(chainlinkDef).toBeDefined();
    expect(chainlinkDef.name).toBe("Chainlink");
    expect(chainlinkDef.slug).toBe("chainlink");
  });

  it("protocol slug is valid kebab-case", () => {
    expect(chainlinkDef.slug).toMatch(KEBAB_CASE_REGEX);
  });

  it("all action slugs are valid kebab-case", () => {
    for (const action of chainlinkDef.actions) {
      expect(action.slug).toMatch(KEBAB_CASE_REGEX);
    }
  });

  it("every action references an existing contract", () => {
    const contractKeys = new Set(Object.keys(chainlinkDef.contracts));
    for (const action of chainlinkDef.actions) {
      expect(
        contractKeys.has(action.contract),
        `action "${action.slug}" references unknown contract "${action.contract}"`
      ).toBe(true);
    }
  });

  it("has no duplicate action slugs", () => {
    const slugs = chainlinkDef.actions.map((a) => a.slug);
    const uniqueSlugs = new Set(slugs);
    expect(slugs.length).toBe(uniqueSlugs.size);
  });

  it("all read actions define outputs", () => {
    const readActions = chainlinkDef.actions.filter((a) => a.type === "read");
    for (const action of readActions) {
      expect(
        action.outputs,
        `read action "${action.slug}" must have outputs`
      ).toBeDefined();
      expect(
        action.outputs?.length,
        `read action "${action.slug}" must have at least one output`
      ).toBeGreaterThan(0);
    }
  });

  it("each action's contract has at least one chain address", () => {
    for (const action of chainlinkDef.actions) {
      const contract = chainlinkDef.contracts[action.contract];
      expect(contract).toBeDefined();
      expect(
        Object.keys(contract.addresses).length,
        `contract "${action.contract}" for action "${action.slug}" must have at least one chain`
      ).toBeGreaterThan(0);
    }
  });

  it("all contract addresses are valid hex format", () => {
    for (const [key, contract] of Object.entries(chainlinkDef.contracts)) {
      for (const [chain, address] of Object.entries(contract.addresses)) {
        expect(
          address,
          `contract "${key}" chain "${chain}" address must be 42-char hex`
        ).toMatch(HEX_ADDRESS_REGEX);
      }
    }
  });

  it("has exactly 6 actions", () => {
    expect(chainlinkDef.actions).toHaveLength(6);
  });

  it("has 6 read actions and 0 write actions", () => {
    const readActions = chainlinkDef.actions.filter((a) => a.type === "read");
    const writeActions = chainlinkDef.actions.filter((a) => a.type === "write");
    expect(readActions).toHaveLength(6);
    expect(writeActions).toHaveLength(0);
  });

  it("has 1 contract", () => {
    expect(Object.keys(chainlinkDef.contracts)).toHaveLength(1);
  });

  it("priceFeed contract has userSpecifiedAddress enabled", () => {
    expect(chainlinkDef.contracts.priceFeed.userSpecifiedAddress).toBe(true);
  });

  it("priceFeed contract is available on 5 chains", () => {
    const chains = Object.keys(chainlinkDef.contracts.priceFeed.addresses);
    expect(chains).toHaveLength(5);
    expect(chains).toContain("1");
    expect(chains).toContain("8453");
    expect(chains).toContain("42161");
    expect(chains).toContain("10");
    expect(chains).toContain("11155111");
  });

  it("latestRoundData action has 5 outputs", () => {
    const action = chainlinkDef.actions.find(
      (a) => a.slug === "latest-round-data"
    );
    expect(action).toBeDefined();
    expect(action?.outputs).toHaveLength(5);
  });

  it("getRoundData action has 1 input and 5 outputs", () => {
    const action = chainlinkDef.actions.find(
      (a) => a.slug === "get-round-data"
    );
    expect(action).toBeDefined();
    expect(action?.inputs).toHaveLength(1);
    expect(action?.outputs).toHaveLength(5);
  });

  it("registers in the protocol registry and is retrievable", () => {
    registerProtocol(chainlinkDef);
    const retrieved = getProtocol("chainlink");
    expect(retrieved).toBeDefined();
    expect(retrieved?.slug).toBe("chainlink");
    expect(retrieved?.name).toBe("Chainlink");
  });
});
