/**
 * Uniswap V3 On-Chain Integration Tests
 *
 * Verifies that the ABI-driven Uniswap V3 protocol definition produces
 * valid calldata that real contracts accept. Runs against a live Sepolia
 * RPC endpoint.
 *
 * Gated on INTEGRATION_TEST_RPC_URL env var - skipped in CI without it.
 *
 * Test philosophy: verify the derived calldata is valid ABI, not that
 * business operations succeed. Pools may lack liquidity on Sepolia and
 * position token IDs may not exist; the try/catch paths accept those
 * reverts as long as the error is not an ABI encoding failure.
 */

import { ethers } from "ethers";
import { describe, expect, it } from "vitest";
import { reshapeArgsForAbi } from "@/lib/abi-struct-args";
import type {
  ProtocolAction,
  ProtocolContract,
  ProtocolDefinition,
} from "@/lib/protocol-registry";
import uniswapDef from "@/protocols/uniswap-v3";

const RPC_URL = process.env.INTEGRATION_TEST_RPC_URL;
const CHAIN_ID = "11155111";
const TEST_ADDRESS = "0x0000000000000000000000000000000000000001";
const HEX_ADDRESS_REGEX = /^0x[\dA-Fa-f]{40}$/;

// Sepolia token addresses used for read-path tests. The WETH/USDC 0.3%
// pool on Sepolia has had liquidity historically; if it does not at test
// time, the quote calls revert with a business error and we still assert
// the calldata was well-formed.
const SEPOLIA_WETH = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const FEE_TIER_030 = "3000";
const ONE_ETH = "1000000000000000000";

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

function isAbiEncodingError(error: unknown): string | null {
  const msg = String(error);
  if (msg.includes("INVALID_ARGUMENT")) {
    return "INVALID_ARGUMENT";
  }
  if (msg.includes("could not decode")) {
    return "could not decode";
  }
  if (msg.includes("invalid function")) {
    return "invalid function";
  }
  return null;
}

describe.skipIf(!RPC_URL)("Uniswap V3 on-chain integration", () => {
  const getProvider = (): ethers.JsonRpcProvider =>
    new ethers.JsonRpcProvider(RPC_URL);

  // -- factory ---------------------------------------------------------------

  it("get-pool: eth_call returns a decodable address", async () => {
    const { to, data, contract } = buildCalldata(uniswapDef, "get-pool", {
      tokenA: SEPOLIA_WETH,
      tokenB: SEPOLIA_USDC,
      fee: FEE_TIER_030,
    });

    const provider = getProvider();
    const result = await provider.call({ to, data });

    const iface = new ethers.Interface(JSON.parse(contract.abi as string));
    const decoded = iface.decodeFunctionResult("getPool", result);
    expect(decoded).toBeDefined();
    expect(typeof decoded[0]).toBe("string");
    expect(decoded[0]).toMatch(HEX_ADDRESS_REGEX);
  }, 15_000);

  // -- positionManager -------------------------------------------------------

  it("balance-of: eth_call returns a decodable uint256", async () => {
    const { to, data, contract } = buildCalldata(uniswapDef, "balance-of", {
      owner: TEST_ADDRESS,
    });

    const provider = getProvider();
    const result = await provider.call({ to, data });

    const iface = new ethers.Interface(JSON.parse(contract.abi as string));
    const decoded = iface.decodeFunctionResult("balanceOf", result);
    expect(decoded).toBeDefined();
    expect(typeof decoded[0]).toBe("bigint");
  }, 15_000);

  it("owner-of: calldata encodes correctly (business revert expected for invalid tokenId)", async () => {
    const { to, data } = buildCalldata(uniswapDef, "owner-of", {
      tokenId: "1",
    });

    const provider = getProvider();
    try {
      await provider.call({ to, data });
    } catch (error) {
      expect(isAbiEncodingError(error)).toBeNull();
    }
  }, 15_000);

  it("get-position: calldata encodes correctly (business revert expected for invalid tokenId)", async () => {
    const { to, data } = buildCalldata(uniswapDef, "get-position", {
      tokenId: "1",
    });

    const provider = getProvider();
    try {
      await provider.call({ to, data });
    } catch (error) {
      expect(isAbiEncodingError(error)).toBeNull();
    }
  }, 15_000);

  it("approve-position: estimateGas calldata is valid (business revert expected)", async () => {
    const { to, data } = buildCalldata(uniswapDef, "approve-position", {
      to: TEST_ADDRESS,
      tokenId: "1",
    });

    const provider = getProvider();
    try {
      await provider.estimateGas({ to, data, from: TEST_ADDRESS });
    } catch (error) {
      expect(isAbiEncodingError(error)).toBeNull();
    }
  }, 15_000);

  it("transfer-position: estimateGas calldata is valid (business revert expected)", async () => {
    const { to, data } = buildCalldata(uniswapDef, "transfer-position", {
      from: TEST_ADDRESS,
      to: TEST_ADDRESS,
      tokenId: "1",
    });

    const provider = getProvider();
    try {
      await provider.estimateGas({ to, data, from: TEST_ADDRESS });
    } catch (error) {
      expect(isAbiEncodingError(error)).toBeNull();
    }
  }, 15_000);

  it("burn-position: estimateGas calldata is valid (business revert expected)", async () => {
    const { to, data } = buildCalldata(uniswapDef, "burn-position", {
      tokenId: "1",
    });

    const provider = getProvider();
    try {
      await provider.estimateGas({ to, data, from: TEST_ADDRESS });
    } catch (error) {
      expect(isAbiEncodingError(error)).toBeNull();
    }
  }, 15_000);

  // -- quoter (tuple-flattened inputs) ---------------------------------------

  it("quote-exact-input: calldata encodes correctly (business revert OK if pool lacks liquidity)", async () => {
    const { to, data } = buildCalldata(uniswapDef, "quote-exact-input", {
      tokenIn: SEPOLIA_WETH,
      tokenOut: SEPOLIA_USDC,
      amountIn: ONE_ETH,
      fee: FEE_TIER_030,
      sqrtPriceLimitX96: "0",
    });

    const provider = getProvider();
    try {
      await provider.call({ to, data });
    } catch (error) {
      expect(isAbiEncodingError(error)).toBeNull();
    }
  }, 15_000);

  it("quote-exact-output: calldata encodes correctly (business revert OK if pool lacks liquidity)", async () => {
    const { to, data } = buildCalldata(uniswapDef, "quote-exact-output", {
      tokenIn: SEPOLIA_WETH,
      tokenOut: SEPOLIA_USDC,
      amount: ONE_ETH,
      fee: FEE_TIER_030,
      sqrtPriceLimitX96: "0",
    });

    const provider = getProvider();
    try {
      await provider.call({ to, data });
    } catch (error) {
      expect(isAbiEncodingError(error)).toBeNull();
    }
  }, 15_000);

  // -- swapRouter (tuple-flattened inputs) -----------------------------------

  it("swap-exact-input: estimateGas calldata is valid (business revert expected - no approval)", async () => {
    const { to, data } = buildCalldata(uniswapDef, "swap-exact-input", {
      tokenIn: SEPOLIA_WETH,
      tokenOut: SEPOLIA_USDC,
      fee: FEE_TIER_030,
      recipient: TEST_ADDRESS,
      amountIn: ONE_ETH,
      amountOutMinimum: "0",
      sqrtPriceLimitX96: "0",
    });

    const provider = getProvider();
    try {
      await provider.estimateGas({ to, data, from: TEST_ADDRESS });
    } catch (error) {
      expect(isAbiEncodingError(error)).toBeNull();
    }
  }, 15_000);

  it("swap-exact-output: estimateGas calldata is valid (business revert expected - no approval)", async () => {
    const { to, data } = buildCalldata(uniswapDef, "swap-exact-output", {
      tokenIn: SEPOLIA_WETH,
      tokenOut: SEPOLIA_USDC,
      fee: FEE_TIER_030,
      recipient: TEST_ADDRESS,
      amountOut: ONE_ETH,
      amountInMaximum: ONE_ETH,
      sqrtPriceLimitX96: "0",
    });

    const provider = getProvider();
    try {
      await provider.estimateGas({ to, data, from: TEST_ADDRESS });
    } catch (error) {
      expect(isAbiEncodingError(error)).toBeNull();
    }
  }, 15_000);
});
