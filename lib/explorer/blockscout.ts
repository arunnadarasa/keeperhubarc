/**
 * Blockscout API integration
 *
 * Provides ABI fetching and transaction listing for Blockscout-based
 * explorers (e.g., Tempo). No API key required.
 */

type BlockscoutResponse = {
  status: string;
  message: string;
  result: string;
};

export type AbiResult = {
  success: boolean;
  abi?: unknown[];
  error?: string;
};

/**
 * Fetch ABI from Blockscout API
 *
 * @param apiUrl - Base API URL (e.g., "https://explorer.tempo.xyz/api")
 * @param contractAddress - Contract address to fetch ABI for
 */
export async function fetchBlockscoutAbi(
  apiUrl: string,
  contractAddress: string
): Promise<AbiResult> {
  const params = new URLSearchParams({
    module: "contract",
    action: "getabi",
    address: contractAddress,
  });

  try {
    const response = await fetch(`${apiUrl}?${params}`);
    const data: BlockscoutResponse = await response.json();

    if (data.status !== "1") {
      // Parse common Blockscout error messages
      const errorMessage = parseBlockscoutError(data.result || data.message);
      return {
        success: false,
        error: errorMessage,
      };
    }

    const abi = JSON.parse(data.result);
    return { success: true, abi };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export type BlockscoutTransaction = {
  hash: string;
  from: { hash: string };
  to: { hash: string };
  value: string;
  raw_input: string;
  block: number;
  timestamp: string;
  status: string;
  method: string | null;
};

type BlockscoutTxListResponse = {
  items: BlockscoutTransaction[];
  next_page_params: { block_number: number; index: number } | null;
};

const BLOCKSCOUT_TX_PAGE_SIZE = 50;
const MAX_TX_RESULTS = 50_000;
const API_V1_SUFFIX_PATTERN = /\/api\/?$/;

type BlockscoutCursor = { block_number: number; index: number };

function buildBlockscoutTxUrl(
  baseUrl: string,
  contractAddress: string,
  cursor: BlockscoutCursor | null
): string {
  const url = new URL(`${baseUrl}/addresses/${contractAddress}/transactions`);
  url.searchParams.set("filter", "to");

  if (cursor) {
    url.searchParams.set("block_number", cursor.block_number.toString());
    url.searchParams.set("index", cursor.index.toString());
  }

  return url.toString();
}

function shouldStopPaginating(
  data: BlockscoutTxListResponse,
  totalCollected: number,
  startBlock: number
): boolean {
  if (totalCollected >= MAX_TX_RESULTS) {
    return true;
  }
  if (!data.next_page_params || data.items.length < BLOCKSCOUT_TX_PAGE_SIZE) {
    return true;
  }
  const lastBlock = data.items.at(-1)?.block ?? 0;
  return lastBlock < startBlock;
}

/**
 * Fetch transaction list for a contract address from Blockscout API v2
 *
 * Uses the `/addresses/:address/transactions` endpoint.
 * Paginates automatically using cursor-based pagination.
 *
 * @param apiUrl - Base API URL (e.g., "https://explorer.tempo.xyz/api")
 * @param contractAddress - Contract address to list transactions for
 * @param startBlock - Start block number (used for client-side filtering)
 * @param endBlock - End block number (used for client-side filtering)
 */
export async function fetchBlockscoutTransactions(
  apiUrl: string,
  contractAddress: string,
  startBlock: number,
  endBlock: number
): Promise<
  | { success: true; transactions: BlockscoutTransaction[] }
  | { success: false; error: string }
> {
  const allTransactions: BlockscoutTransaction[] = [];
  let cursor: BlockscoutCursor | null = null;

  try {
    const baseUrl = apiUrl.replace(API_V1_SUFFIX_PATTERN, "/api/v2");

    for (;;) {
      const url = buildBlockscoutTxUrl(baseUrl, contractAddress, cursor);
      const response = await fetch(url);

      if (!response.ok) {
        return {
          success: false,
          error: `Blockscout API returned status ${response.status}`,
        };
      }

      const data: BlockscoutTxListResponse = await response.json();

      for (const tx of data.items) {
        if (tx.block >= startBlock && tx.block <= endBlock) {
          allTransactions.push(tx);
        }
      }

      if (shouldStopPaginating(data, allTransactions.length, startBlock)) {
        break;
      }

      cursor = data.next_page_params;
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error fetching transactions",
    };
  }

  return { success: true, transactions: allTransactions };
}

/**
 * Parse Blockscout error messages into user-friendly messages
 */
function parseBlockscoutError(message: string): string {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("contract source code not verified")) {
    return "Contract source code is not verified on the block explorer";
  }

  if (lowerMessage.includes("invalid address")) {
    return "Invalid contract address";
  }

  return message || "Failed to fetch ABI from Blockscout";
}
