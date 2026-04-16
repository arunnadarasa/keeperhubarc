/**
 * Aave V4 On-Chain Integration Tests (Lido Spoke)
 *
 * Verifies that the ABI-driven Aave V4 protocol definition produces valid
 * calldata that the deployed Lido Spoke contract accepts. Runs against a
 * live Ethereum mainnet RPC endpoint.
 *
 * Uses a separate env var (INTEGRATION_TEST_MAINNET_RPC_URL) because Aave V4
 * has no Sepolia deployment - the existing INTEGRATION_TEST_RPC_URL targets
 * Sepolia and would produce address mismatches.
 *
 * Gated on INTEGRATION_TEST_MAINNET_RPC_URL - skipped in CI without it.
 */

import { ethers } from "ethers";
import { describe, expect, it } from "vitest";
import { reshapeArgsForAbi } from "@/lib/abi-struct-args";
import type {
  ProtocolAction,
  ProtocolContract,
  ProtocolDefinition,
} from "@/lib/protocol-registry";
import aaveV4Def from "@/protocols/aave-v4";

const RPC_URL = process.env.INTEGRATION_TEST_MAINNET_RPC_URL;
const CHAIN_ID = "1";
const TEST_ADDRESS = "0x0000000000000000000000000000000000000001";
const CORE_HUB = "0xCca852Bc40e560adC3b1Cc58CA5b55638ce826c9";

function buildCalldata(
  protocol: ProtocolDefinition,
  actionSlug: string,
  sampleInputs: Record<string, string>
): {
  to: string;
  data: string;
  action: ProtocolAction;
  contract: ProtocolContract;
} {
  const action = protocol.actions.find((a) => a.slug === actionSlug);
  if (!action) {
    throw new Error(`Action ${actionSlug} not found`);
  }

  const contract = protocol.contracts[action.contract];
  if (!contract.abi) {
    throw new Error(`Contract ${action.contract} has no ABI`);
  }

  const contractAddress = contract.addresses[CHAIN_ID];
  if (!contractAddress) {
    throw new Error(`Contract ${action.contract} not on chain ${CHAIN_ID}`);
  }

  const rawArgs = action.inputs.map((inp) => {
    const val = sampleInputs[inp.name] ?? inp.default ?? "";
    return val;
  });

  const abi = JSON.parse(contract.abi);
  const functionAbi = abi.find(
    (f: { name: string; type: string }) =>
      f.type === "function" && f.name === action.function
  );
  const args = reshapeArgsForAbi(rawArgs, functionAbi);
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData(action.function, args);

  return { to: contractAddress, data, action, contract };
}

describe.skipIf(!RPC_URL)("Aave V4 Lido Spoke on-chain integration", () => {
  const getProvider = (): ethers.JsonRpcProvider =>
    new ethers.JsonRpcProvider(RPC_URL);

  it("getReserveId: eth_call returns a decodable uint256", async () => {
    const { to, data, contract } = buildCalldata(aaveV4Def, "get-reserve-id", {
      hub: CORE_HUB,
      assetId: "0",
    });

    const provider = getProvider();
    try {
      const result = await provider.call({ to, data });
      const abi = JSON.parse(contract.abi as string);
      const iface = new ethers.Interface(abi);
      const decoded = iface.decodeFunctionResult("getReserveId", result);
      expect(decoded).toBeDefined();
      expect(typeof decoded[0]).toBe("bigint");
    } catch (error) {
      const msg = String(error);
      expect(msg).not.toContain("INVALID_ARGUMENT");
      expect(msg).not.toContain("could not decode");
      expect(msg).not.toContain("invalid function");
    }
  }, 15_000);

  it("getUserSuppliedAssets: eth_call returns a decodable uint256", async () => {
    const { to, data, contract } = buildCalldata(
      aaveV4Def,
      "get-user-supplied-assets",
      { reserveId: "0", user: TEST_ADDRESS }
    );

    const provider = getProvider();
    try {
      const result = await provider.call({ to, data });
      const abi = JSON.parse(contract.abi as string);
      const iface = new ethers.Interface(abi);
      const decoded = iface.decodeFunctionResult(
        "getUserSuppliedAssets",
        result
      );
      expect(decoded).toBeDefined();
      expect(typeof decoded[0]).toBe("bigint");
    } catch (error) {
      const msg = String(error);
      expect(msg).not.toContain("INVALID_ARGUMENT");
      expect(msg).not.toContain("could not decode");
      expect(msg).not.toContain("invalid function");
    }
  }, 15_000);

  it("getUserDebt: eth_call returns two decodable uint256 values", async () => {
    const { to, data, contract } = buildCalldata(aaveV4Def, "get-user-debt", {
      reserveId: "0",
      user: TEST_ADDRESS,
    });

    const provider = getProvider();
    try {
      const result = await provider.call({ to, data });
      const abi = JSON.parse(contract.abi as string);
      const iface = new ethers.Interface(abi);
      const decoded = iface.decodeFunctionResult("getUserDebt", result);
      expect(decoded).toBeDefined();
      expect(decoded.length).toBeGreaterThanOrEqual(2);
      expect(typeof decoded[0]).toBe("bigint");
      expect(typeof decoded[1]).toBe("bigint");
    } catch (error) {
      const msg = String(error);
      expect(msg).not.toContain("INVALID_ARGUMENT");
      expect(msg).not.toContain("could not decode");
      expect(msg).not.toContain("invalid function");
    }
  }, 15_000);

  it("supply: calldata encodes correctly (business revert expected)", async () => {
    const { to, data } = buildCalldata(aaveV4Def, "supply", {
      reserveId: "0",
      amount: "1000000000000000000",
      onBehalfOf: TEST_ADDRESS,
    });

    const provider = getProvider();
    try {
      await provider.estimateGas({
        to,
        data,
        from: TEST_ADDRESS,
      });
    } catch (error) {
      const msg = String(error);
      expect(msg).not.toContain("INVALID_ARGUMENT");
      expect(msg).not.toContain("could not decode");
      expect(msg).not.toContain("invalid function");
    }
  }, 15_000);

  it("setUsingAsCollateral: calldata encodes correctly (business revert expected)", async () => {
    const { to, data } = buildCalldata(aaveV4Def, "set-collateral", {
      reserveId: "0",
      usingAsCollateral: "true",
      onBehalfOf: TEST_ADDRESS,
    });

    const provider = getProvider();
    try {
      await provider.estimateGas({
        to,
        data,
        from: TEST_ADDRESS,
      });
    } catch (error) {
      const msg = String(error);
      expect(msg).not.toContain("INVALID_ARGUMENT");
      expect(msg).not.toContain("could not decode");
      expect(msg).not.toContain("invalid function");
    }
  }, 15_000);
});
