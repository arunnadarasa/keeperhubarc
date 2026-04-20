/**
 * Utility functions for fetching wallet balances via RPC
 */

import { ErrorCategory, logUserError } from "@/lib/logging";
import type {
  ChainBalance,
  ChainData,
  SupportedToken,
  SupportedTokenBalance,
  TokenBalance,
  TokenData,
} from "./types";

/**
 * Maximum balance threshold (1 trillion tokens) - balances above this are considered
 * testnet mock balances and treated as zero (not meaningful)
 */
const MAX_DISPLAY_BALANCE = BigInt("1000000000000"); // 1 trillion
const BIGINT_ZERO = BigInt(0);
const BIGINT_ONE = BigInt(1);
const BIGINT_FIVE = BigInt(5);
const BIGINT_TEN = BigInt(10);

/**
 * Format a BigInt wei value to a decimal string with proper precision.
 * Handles arbitrarily large values without JavaScript Number precision loss.
 *
 * @param weiValue - The balance in wei as BigInt
 * @param decimals - Number of decimals (18 for ETH, varies for tokens)
 * @param displayDecimals - Number of decimal places to show in output (default 6)
 * @returns Formatted balance string, or "0.000000" for testnet mock balances
 */
export function formatWeiToBalance(
  weiValue: bigint,
  decimals: number,
  displayDecimals = 6
): string {
  // Handle zero case
  if (weiValue === BIGINT_ZERO) {
    return `0.${"0".repeat(displayDecimals)}`;
  }

  const divisor = BIGINT_TEN ** BigInt(decimals);
  const wholePart = weiValue / divisor;

  // Testnet mock balances (unrealistically large values) are not meaningful - show as zero
  if (wholePart > MAX_DISPLAY_BALANCE) {
    return `0.${"0".repeat(displayDecimals)}`;
  }

  // Calculate fractional part with extra precision for rounding
  const remainder = weiValue % divisor;
  const scaleFactor = BIGINT_TEN ** BigInt(displayDecimals + 1); // +1 for rounding digit
  const scaledFraction = (remainder * scaleFactor) / divisor;

  // Round the last digit
  const roundedFraction = (scaledFraction + BIGINT_FIVE) / BIGINT_TEN;

  // Handle carry from rounding
  const maxFraction = BIGINT_TEN ** BigInt(displayDecimals);
  let finalWhole = wholePart;
  let finalFraction = roundedFraction;

  if (finalFraction >= maxFraction) {
    finalWhole += BIGINT_ONE;
    finalFraction = BIGINT_ZERO;
  }

  // Format the fractional part with leading zeros
  const fractionStr = finalFraction.toString().padStart(displayDecimals, "0");

  return `${finalWhole}.${fractionStr}`;
}

/**
 * Build explorer address URL for a chain
 */
function buildExplorerAddressUrl(
  chain: ChainData,
  address: string
): string | null {
  if (!chain.explorerUrl) {
    return null;
  }
  const path = chain.explorerAddressPath || "/address/{address}";
  return `${chain.explorerUrl}${path.replace("{address}", address)}`;
}

/**
 * Encode an ERC20 `balanceOf(address)` call payload.
 */
function encodeBalanceOfCallData(address: string): string {
  const balanceOfSelector = "0x70a08231";
  const stripped = address.startsWith("0x") ? address.slice(2) : address;
  const padded = stripped.toLowerCase().padStart(64, "0");
  return `${balanceOfSelector}${padded}`;
}

/**
 * Parse a hex wei string into BigInt, treating empty `"0x"` as zero.
 * Caller must ensure hex is a non-empty string (rpcCall guarantees this).
 */
function hexWeiToBigInt(hex: string): bigint {
  return hex === "0x" ? BIGINT_ZERO : BigInt(hex);
}

type JsonRpcPayload = {
  jsonrpc: "2.0";
  method: string;
  params: unknown[];
  id: number;
};

/**
 * RPC retry configuration.
 *
 * Two exponential-backoff schedules, picked by failure type:
 *
 * - `STANDARD`: network errors, HTTP 5xx, and malformed responses (missing
 *   `result` field). Short backoff because these usually clear quickly.
 * - `RATE_LIMIT`: HTTP 429. Longer backoff because the server is actively
 *   throttling us; retrying too soon just extends the throttle.
 *
 * Schedule = `min(BASE_MS * 2^attempt, CAP_MS)`.
 *
 * With MAX_RETRIES = 3:
 *   - STANDARD delays:   500ms, 1s, 2s     (total ~3.5s across 4 attempts)
 *   - RATE_LIMIT delays: 1s,    2s, 4s     (total ~7s across 4 attempts)
 */
const RPC_RETRY_CONFIG = {
  MAX_RETRIES: 3,
  STANDARD: {
    BASE_MS: 500,
    CAP_MS: 3000,
  },
  RATE_LIMIT: {
    BASE_MS: 1000,
    CAP_MS: 5000,
  },
} as const;

type RpcFailureKind = "standard" | "rate_limit";

function getRpcBackoffMs(attempt: number, kind: RpcFailureKind): number {
  const schedule =
    kind === "rate_limit"
      ? RPC_RETRY_CONFIG.RATE_LIMIT
      : RPC_RETRY_CONFIG.STANDARD;
  return Math.min(schedule.BASE_MS * 2 ** attempt, schedule.CAP_MS);
}

/**
 * Execute a JSON-RPC POST with retry/backoff for transient failures.
 *
 * Retries: HTTP 429, HTTP 5xx, network errors, and missing `result` fields
 * (malformed gateway responses — the root cause behind `BigInt(undefined)`).
 * Does not retry HTTP 4xx (except 429) or RPC-reported errors — those are
 * deterministic and would fail again.
 *
 * Returns the raw `result` string (guaranteed non-empty). Callers interpret
 * `"0x"` per their context via {@link hexWeiToBigInt}.
 */
async function rpcCall(
  rpcUrl: string,
  payload: JsonRpcPayload
): Promise<string> {
  let lastError: Error = new Error("RPC call failed");
  let lastFailureKind: RpcFailureKind = "standard";

  for (let attempt = 0; attempt <= RPC_RETRY_CONFIG.MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await delay(getRpcBackoffMs(attempt - 1, lastFailureKind));
    }

    let response: Response;
    try {
      response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      lastFailureKind = "standard";
      continue;
    }

    if (response.status === 429) {
      lastError = new Error("HTTP 429: rate limited");
      lastFailureKind = "rate_limit";
      continue;
    }

    if (response.status >= 500) {
      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      lastFailureKind = "standard";
      continue;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message || "RPC error");
    }

    if (data.result === undefined || data.result === null) {
      lastError = new Error("RPC returned no result");
      lastFailureKind = "standard";
      continue;
    }

    return data.result;
  }

  throw lastError;
}

/**
 * Fetch native token balance for a single chain
 */
export async function fetchNativeBalance(
  address: string,
  chain: ChainData
): Promise<ChainBalance> {
  try {
    const resultHex = await rpcCall(chain.defaultPrimaryRpc, {
      jsonrpc: "2.0",
      method: "eth_getBalance",
      params: [address, "latest"],
      id: 1,
    });

    const balanceWei = hexWeiToBigInt(resultHex);

    return {
      chainId: chain.chainId,
      name: chain.name,
      symbol: chain.symbol,
      balance: formatWeiToBalance(balanceWei, 18),
      loading: false,
      isTestnet: chain.isTestnet,
      explorerUrl: buildExplorerAddressUrl(chain, address),
    };
  } catch (error) {
    logUserError(
      ErrorCategory.NETWORK_RPC,
      `Failed to fetch balance for ${chain.name}:`,
      error,
      {
        chain_id: chain.chainId.toString(),
        chain_name: chain.name,
      }
    );
    return {
      chainId: chain.chainId,
      name: chain.name,
      symbol: chain.symbol,
      balance: "0",
      loading: false,
      isTestnet: chain.isTestnet,
      explorerUrl: buildExplorerAddressUrl(chain, address),
      error: error instanceof Error ? error.message : "Failed to fetch",
    };
  }
}

/**
 * Fetch ERC20 token balance for a single token
 */
export async function fetchTokenBalance(
  address: string,
  token: TokenData,
  chain: ChainData
): Promise<TokenBalance> {
  try {
    const resultHex = await rpcCall(chain.defaultPrimaryRpc, {
      jsonrpc: "2.0",
      method: "eth_call",
      params: [
        { to: token.tokenAddress, data: encodeBalanceOfCallData(address) },
        "latest",
      ],
      id: 1,
    });

    const balanceWei = hexWeiToBigInt(resultHex);

    return {
      tokenId: token.id,
      chainId: token.chainId,
      tokenAddress: token.tokenAddress,
      symbol: token.symbol,
      name: token.name,
      balance: formatWeiToBalance(balanceWei, token.decimals),
      loading: false,
    };
  } catch (error) {
    logUserError(
      ErrorCategory.NETWORK_RPC,
      `Failed to fetch balance for ${token.symbol}:`,
      error,
      {
        chain_id: token.chainId.toString(),
        token_symbol: token.symbol,
        token_address: token.tokenAddress,
      }
    );
    return {
      tokenId: token.id,
      chainId: token.chainId,
      tokenAddress: token.tokenAddress,
      symbol: token.symbol,
      name: token.name,
      balance: "0",
      loading: false,
      error: error instanceof Error ? error.message : "Failed to fetch",
    };
  }
}

/**
 * Fetch native balances for all chains
 */
export function fetchAllNativeBalances(
  address: string,
  chains: ChainData[]
): Promise<ChainBalance[]> {
  const promises = chains.map((chain) => fetchNativeBalance(address, chain));
  return Promise.all(promises);
}

/**
 * Fetch token balances for all tokens
 */
export function fetchAllTokenBalances(
  address: string,
  tokens: TokenData[],
  chains: ChainData[]
): Promise<TokenBalance[]> {
  const promises = tokens.map((token) => {
    const chain = chains.find((c) => c.chainId === token.chainId);
    if (!chain) {
      return Promise.resolve({
        tokenId: token.id,
        chainId: token.chainId,
        tokenAddress: token.tokenAddress,
        symbol: token.symbol,
        name: token.name,
        balance: "0",
        loading: false,
        error: `Chain ${token.chainId} not found`,
      });
    }
    return fetchTokenBalance(address, token, chain);
  });
  return Promise.all(promises);
}

/**
 * Fetch balance for a single supported token with retry logic
 */
export async function fetchSupportedTokenBalance(
  address: string,
  token: SupportedToken,
  chain: ChainData
): Promise<SupportedTokenBalance> {
  try {
    const resultHex = await rpcCall(chain.defaultPrimaryRpc, {
      jsonrpc: "2.0",
      method: "eth_call",
      params: [
        { to: token.tokenAddress, data: encodeBalanceOfCallData(address) },
        "latest",
      ],
      id: 1,
    });

    const balanceWei = hexWeiToBigInt(resultHex);

    return {
      chainId: token.chainId,
      tokenAddress: token.tokenAddress,
      symbol: token.symbol,
      name: token.name,
      logoUrl: token.logoUrl,
      balance: formatWeiToBalance(balanceWei, token.decimals),
      loading: false,
      explorerUrl: buildExplorerAddressUrl(chain, token.tokenAddress),
    };
  } catch (error) {
    logUserError(
      ErrorCategory.NETWORK_RPC,
      `Failed to fetch balance for ${token.symbol}:`,
      error,
      {
        chain_id: token.chainId.toString(),
        token_symbol: token.symbol,
        token_address: token.tokenAddress,
      }
    );
    return {
      chainId: token.chainId,
      tokenAddress: token.tokenAddress,
      symbol: token.symbol,
      name: token.name,
      logoUrl: token.logoUrl,
      balance: "0",
      loading: false,
      error: error instanceof Error ? error.message : "Failed to fetch",
      explorerUrl: buildExplorerAddressUrl(chain, token.tokenAddress),
    };
  }
}

/**
 * Helper to add delay between requests
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process items in batches with delay between batches to avoid rate limits
 */
async function processBatched<T, R>(
  items: T[],
  processor: (item: T) => Promise<R>,
  batchSize = 3,
  delayMs = 100
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);

    // Add delay between batches (but not after the last batch)
    if (i + batchSize < items.length) {
      await delay(delayMs);
    }
  }

  return results;
}

/**
 * Fetch balances for all supported tokens (with rate limiting)
 */
export async function fetchAllSupportedTokenBalances(
  address: string,
  tokens: SupportedToken[],
  chains: ChainData[]
): Promise<SupportedTokenBalance[]> {
  // Group tokens by chain to minimize RPC switches
  const tokensByChain = new Map<number, SupportedToken[]>();
  for (const token of tokens) {
    const existing = tokensByChain.get(token.chainId) || [];
    existing.push(token);
    tokensByChain.set(token.chainId, existing);
  }

  // Process each chain's tokens
  const allResults: SupportedTokenBalance[] = [];

  for (const [chainId, chainTokens] of tokensByChain) {
    const chain = chains.find((c) => c.chainId === chainId);

    if (!chain) {
      // Add error results for tokens on missing chains
      for (const token of chainTokens) {
        allResults.push({
          chainId: token.chainId,
          tokenAddress: token.tokenAddress,
          symbol: token.symbol,
          name: token.name,
          logoUrl: token.logoUrl,
          balance: "0",
          loading: false,
          error: `Chain ${token.chainId} not found`,
        });
      }
      continue;
    }

    // Process tokens for this chain sequentially to avoid rate limits
    const chainResults = await processBatched(
      chainTokens,
      (token) => fetchSupportedTokenBalance(address, token, chain),
      1, // 1 request at a time (sequential)
      200 // 200ms delay between requests
    );

    allResults.push(...chainResults);
  }

  return allResults;
}
