import { describe, expect, it } from "vitest";
import {
  buildEventAbiFragment,
  getProtocol,
  registerProtocol,
} from "@/keeperhub/lib/protocol-registry";
import safeWalletDef from "@/keeperhub/protocols/safe-wallet";

const KEBAB_CASE_REGEX = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

describe("Safe Wallet Protocol Definition", () => {
  it("imports without throwing", () => {
    expect(safeWalletDef).toBeDefined();
    expect(safeWalletDef.name).toBe("Safe");
    expect(safeWalletDef.slug).toBe("safe-wallet");
  });

  it("protocol slug is valid kebab-case", () => {
    expect(safeWalletDef.slug).toMatch(KEBAB_CASE_REGEX);
  });

  it("all action slugs are valid kebab-case", () => {
    for (const action of safeWalletDef.actions) {
      expect(action.slug).toMatch(KEBAB_CASE_REGEX);
    }
  });

  it("every action references an existing contract", () => {
    const contractKeys = new Set(Object.keys(safeWalletDef.contracts));
    for (const action of safeWalletDef.actions) {
      expect(
        contractKeys.has(action.contract),
        `action "${action.slug}" references unknown contract "${action.contract}"`
      ).toBe(true);
    }
  });

  it("has no duplicate action slugs", () => {
    const slugs = safeWalletDef.actions.map((a) => a.slug);
    const uniqueSlugs = new Set(slugs);
    expect(slugs.length).toBe(uniqueSlugs.size);
  });

  it("all read actions define outputs", () => {
    const readActions = safeWalletDef.actions.filter((a) => a.type === "read");
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
    for (const action of safeWalletDef.actions) {
      const contract = safeWalletDef.contracts[action.contract];
      expect(contract).toBeDefined();
      expect(
        Object.keys(contract.addresses).length,
        `contract "${action.contract}" for action "${action.slug}" must have at least one chain`
      ).toBeGreaterThan(0);
    }
  });

  it("has exactly 6 actions", () => {
    expect(safeWalletDef.actions).toHaveLength(6);
  });

  it("has 6 read actions and 0 write actions", () => {
    const readActions = safeWalletDef.actions.filter((a) => a.type === "read");
    const writeActions = safeWalletDef.actions.filter(
      (a) => a.type === "write"
    );
    expect(readActions).toHaveLength(6);
    expect(writeActions).toHaveLength(0);
  });

  it("has 1 contract", () => {
    expect(Object.keys(safeWalletDef.contracts)).toHaveLength(1);
  });

  it("safe contract has userSpecifiedAddress enabled", () => {
    expect(safeWalletDef.contracts.safe.userSpecifiedAddress).toBe(true);
  });

  it("safe contract is available on 4 chains", () => {
    const chains = Object.keys(safeWalletDef.contracts.safe.addresses);
    expect(chains).toHaveLength(4);
    expect(chains).toContain("1");
    expect(chains).toContain("8453");
    expect(chains).toContain("42161");
    expect(chains).toContain("10");
  });

  it("registers in the protocol registry and is retrievable", () => {
    registerProtocol(safeWalletDef);
    const retrieved = getProtocol("safe-wallet");
    expect(retrieved).toBeDefined();
    expect(retrieved?.slug).toBe("safe-wallet");
    expect(retrieved?.name).toBe("Safe");
  });

  it("has 12 events", () => {
    expect(safeWalletDef.events).toBeDefined();
    expect(safeWalletDef.events).toHaveLength(12);
  });

  it("all event slugs are valid kebab-case", () => {
    for (const event of safeWalletDef.events!) {
      expect(event.slug).toMatch(KEBAB_CASE_REGEX);
    }
  });

  it("every event references an existing contract", () => {
    const contractKeys = new Set(Object.keys(safeWalletDef.contracts));
    for (const event of safeWalletDef.events!) {
      expect(
        contractKeys.has(event.contract),
        `event "${event.slug}" references unknown contract "${event.contract}"`
      ).toBe(true);
    }
  });

  it("has no duplicate event slugs", () => {
    const slugs = safeWalletDef.events!.map((e) => e.slug);
    const uniqueSlugs = new Set(slugs);
    expect(slugs.length).toBe(uniqueSlugs.size);
  });

  it("buildEventAbiFragment produces valid JSON with correct structure", () => {
    const event = safeWalletDef.events![0];
    const fragment = buildEventAbiFragment(event);
    const parsed = JSON.parse(fragment);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe("event");
    expect(parsed[0].name).toBe(event.eventName);
    expect(parsed[0].inputs).toHaveLength(event.inputs.length);
  });
});
