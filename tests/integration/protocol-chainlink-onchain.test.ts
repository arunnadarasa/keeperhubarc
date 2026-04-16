/**
 * Chainlink CCIP On-Chain Integration Tests
 *
 * Verifies that the Chainlink protocol's CCIP action definitions produce
 * calldata the real Sepolia CCIP router and CCIP-BnM token accept. Runs
 * against a live RPC endpoint.
 *
 * Gated on INTEGRATION_TEST_RPC_URL env var (Sepolia) - skipped in CI
 * without it. Matches the pattern established by WETH in
 * protocol-weth-onchain.test.ts.
 *
 * Coverage: 6 of 9 CCIP actions. The non-covered three
 * (ccip-check-fee-balance, ccip-check-fee-allowance, ccip-approve-fee-token)
 * are structurally identical to their bridge-token siblings; one each is
 * enough to validate the ABI path.
 */

import { ethers } from "ethers";
import { describe, expect, it } from "vitest";
import { reshapeArgsForAbi } from "@/lib/abi-struct-args";
import type {
  ProtocolAction,
  ProtocolContract,
  ProtocolDefinition,
} from "@/lib/protocol-registry";
import chainlinkDef from "@/protocols/chainlink";

const RPC_URL = process.env.INTEGRATION_TEST_RPC_URL;
const CHAIN_ID = "11155111"; // Sepolia
const TEST_ADDRESS = "0x0000000000000000000000000000000000000001";
const CCIP_BNM_SEPOLIA = "0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05";
const BASE_SEPOLIA_CHAIN_SELECTOR = "10344971235874465080";
// Chainlink's extra args V1 encoding with gasLimit=0 (EOA token transfer default).
const EXTRA_ARGS_V1_GAS_LIMIT_ZERO =
  "0x97a657c90000000000000000000000000000000000000000000000000000000000000000";

// Canonical CCIP message inputs for getFee and ccipSend. Reused across tests
// so a business revert in one call isn't caused by a shape drift from another.
const CCIP_MESSAGE_SAMPLE: Record<string, string> = {
  destinationChainSelector: BASE_SEPOLIA_CHAIN_SELECTOR,
  // `receiver` is `bytes`, set to the abi-encoded TEST_ADDRESS.
  receiver: ethers.zeroPadValue(TEST_ADDRESS, 32),
  data: "0x",
  tokenAmounts: "[]",
  feeToken: ethers.ZeroAddress,
  extraArgs: EXTRA_ARGS_V1_GAS_LIMIT_ZERO,
};

type Calldata = {
  to: string;
  data: string;
  action: ProtocolAction;
  contract: ProtocolContract;
};

// Builds calldata from a protocol action. For contracts with
// userSpecifiedAddress: true, pass `toOverride` so the request targets a real
// runtime token address rather than the reference address baked into the
// protocol definition.
function buildCalldata(
  protocol: ProtocolDefinition,
  actionSlug: string,
  sampleInputs: Record<string, string>,
  toOverride?: string
): Calldata {
  const action = protocol.actions.find((a) => a.slug === actionSlug);
  if (!action) {
    throw new Error(`Action ${actionSlug} not found`);
  }

  const contract = protocol.contracts[action.contract];
  if (!contract.abi) {
    throw new Error(`Contract ${action.contract} has no ABI`);
  }

  const to = toOverride ?? contract.addresses[CHAIN_ID];
  if (!to) {
    throw new Error(
      `No address for contract ${action.contract} on chain ${CHAIN_ID}`
    );
  }

  const rawArgs = action.inputs.map(
    (inp) => sampleInputs[inp.name] ?? inp.default ?? ""
  );

  const abi = JSON.parse(contract.abi);
  const functionAbi = abi.find(
    (f: { name: string; type: string }) =>
      f.type === "function" && f.name === action.function
  );
  const args = reshapeArgsForAbi(rawArgs, functionAbi);
  const iface = new ethers.Interface(abi);
  const data = iface.encodeFunctionData(action.function, args);

  return { to, data, action, contract };
}

describe.skipIf(!RPC_URL)(
  "Chainlink CCIP on-chain integration (Sepolia)",
  () => {
    const getProvider = (): ethers.JsonRpcProvider =>
      new ethers.JsonRpcProvider(RPC_URL);

    it("ccip-get-fee: eth_call returns decodable uint256", async () => {
      const { to, data, contract } = buildCalldata(
        chainlinkDef,
        "ccip-get-fee",
        CCIP_MESSAGE_SAMPLE
      );

      const provider = getProvider();
      try {
        const result = await provider.call({ to, data });
        const abi = JSON.parse(contract.abi as string);
        const iface = new ethers.Interface(abi);
        const decoded = iface.decodeFunctionResult("getFee", result);
        expect(decoded).toBeDefined();
        expect(typeof decoded[0]).toBe("bigint");
      } catch (error) {
        // getFee can revert for business reasons (e.g. unsupported lane),
        // but the error must not be an ABI-level encoding/decoding failure.
        const msg = String(error);
        expect(msg).not.toContain("INVALID_ARGUMENT");
        expect(msg).not.toContain("could not decode");
        expect(msg).not.toContain("invalid function");
      }
    }, 15_000);

    it("ccip-check-bridge-balance: eth_call returns decodable uint256", async () => {
      const { to, data, contract } = buildCalldata(
        chainlinkDef,
        "ccip-check-bridge-balance",
        { account: TEST_ADDRESS },
        CCIP_BNM_SEPOLIA
      );

      const provider = getProvider();
      const result = await provider.call({ to, data });
      const abi = JSON.parse(contract.abi as string);
      const iface = new ethers.Interface(abi);
      const decoded = iface.decodeFunctionResult("balanceOf", result);
      expect(decoded).toBeDefined();
      expect(typeof decoded[0]).toBe("bigint");
    }, 15_000);

    it("ccip-check-bridge-allowance: eth_call returns decodable uint256", async () => {
      const { to, data, contract } = buildCalldata(
        chainlinkDef,
        "ccip-check-bridge-allowance",
        { owner: TEST_ADDRESS, spender: ethers.ZeroAddress },
        CCIP_BNM_SEPOLIA
      );

      const provider = getProvider();
      const result = await provider.call({ to, data });
      const abi = JSON.parse(contract.abi as string);
      const iface = new ethers.Interface(abi);
      const decoded = iface.decodeFunctionResult("allowance", result);
      expect(decoded).toBeDefined();
      expect(typeof decoded[0]).toBe("bigint");
    }, 15_000);

    it("ccip-approve-bridge-token: calldata encodes (business revert expected)", async () => {
      const { to, data } = buildCalldata(
        chainlinkDef,
        "ccip-approve-bridge-token",
        { spender: ethers.ZeroAddress, amount: "1000000000000000000" },
        CCIP_BNM_SEPOLIA
      );

      const provider = getProvider();
      try {
        await provider.estimateGas({ to, data, from: TEST_ADDRESS });
      } catch (error) {
        const msg = String(error);
        expect(msg).not.toContain("INVALID_ARGUMENT");
        expect(msg).not.toContain("could not decode");
        expect(msg).not.toContain("invalid function");
      }
    }, 15_000);

    it("ccip-send: calldata encodes (business revert expected)", async () => {
      const { to, data } = buildCalldata(
        chainlinkDef,
        "ccip-send",
        CCIP_MESSAGE_SAMPLE
      );

      const provider = getProvider();
      try {
        await provider.estimateGas({
          to,
          data,
          // Pay native for fee; any non-zero value is fine - estimateGas will
          // revert for real-world reasons (fee mismatch, no balance) but the
          // calldata itself must be ABI-valid.
          value: ethers.parseEther("0.01"),
          from: TEST_ADDRESS,
        });
      } catch (error) {
        const msg = String(error);
        expect(msg).not.toContain("INVALID_ARGUMENT");
        expect(msg).not.toContain("could not decode");
        expect(msg).not.toContain("invalid function");
      }
    }, 15_000);

    it("ccip-bnm-drip: calldata encodes (business revert expected)", async () => {
      const { to, data } = buildCalldata(chainlinkDef, "ccip-bnm-drip", {
        to: TEST_ADDRESS,
      });

      const provider = getProvider();
      try {
        await provider.estimateGas({ to, data, from: TEST_ADDRESS });
      } catch (error) {
        const msg = String(error);
        expect(msg).not.toContain("INVALID_ARGUMENT");
        expect(msg).not.toContain("could not decode");
        expect(msg).not.toContain("invalid function");
      }
    }, 15_000);
  }
);
