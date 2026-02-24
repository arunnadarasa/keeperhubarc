/**
 * Explorer service for building URLs and fetching ABIs
 *
 * Supports multiple explorer types:
 * - etherscan: Etherscan API v2 (Ethereum, Base, Arbitrum, etc.)
 * - blockscout: Blockscout API (Tempo, etc.)
 * - solscan: Solana (IDL fetch not supported via API)
 */

import type { ExplorerConfig } from "@/lib/db/schema";
import {
  type BlockscoutTransaction,
  fetchBlockscoutAbi,
  fetchBlockscoutTransactions,
} from "./blockscout";
import type { AbiResult } from "./etherscan";
import {
  type EtherscanTransaction,
  fetchEtherscanAbi,
  fetchEtherscanTransactions,
} from "./etherscan";

export type { BlockscoutTransaction } from "./blockscout";
export type { AbiResult, EtherscanTransaction } from "./etherscan";

export type NormalizedTransaction = {
  hash: string;
  from: string;
  to: string;
  value: string;
  input: string;
  blockNumber: number;
  timestamp: string;
  isError: boolean;
};

type TransactionListResult =
  | { success: true; transactions: NormalizedTransaction[] }
  | { success: false; error: string };

/**
 * Build transaction URL for the explorer
 */
export function getTransactionUrl(
  config: ExplorerConfig,
  txHash: string
): string {
  if (!config.explorerUrl) {
    return "";
  }
  const path = config.explorerTxPath || "/tx/{hash}";
  return `${config.explorerUrl}${path.replace("{hash}", txHash)}`;
}

/**
 * Build address URL for the explorer
 */
export function getAddressUrl(config: ExplorerConfig, address: string): string {
  if (!config.explorerUrl) {
    return "";
  }
  const path = config.explorerAddressPath || "/address/{address}";
  return `${config.explorerUrl}${path.replace("{address}", address)}`;
}

/**
 * Build contract/ABI URL for the explorer
 */
export function getContractUrl(
  config: ExplorerConfig,
  address: string
): string {
  if (!config.explorerUrl) {
    return "";
  }

  if (config.explorerContractPath) {
    return `${config.explorerUrl}${config.explorerContractPath.replace("{address}", address)}`;
  }

  // Fallback defaults based on chain type
  if (config.chainType === "solana") {
    return `${config.explorerUrl}/account/${address}#anchorProgramIDL`;
  }
  return `${config.explorerUrl}/address/${address}#code`;
}

/**
 * Fetch ABI for a contract from the explorer API
 *
 * @param config - Explorer configuration from database
 * @param contractAddress - Contract address to fetch ABI for
 * @param chainId - Chain ID (required for Etherscan v2)
 * @param apiKey - Optional API key (required for Etherscan)
 */
export async function fetchContractAbi(
  config: ExplorerConfig,
  contractAddress: string,
  chainId: number,
  apiKey?: string
): Promise<AbiResult> {
  if (!(config.explorerApiUrl && config.explorerApiType)) {
    return {
      success: false,
      error: "Explorer API not configured for this chain",
    };
  }

  switch (config.explorerApiType) {
    case "etherscan":
      return await fetchEtherscanAbi(
        config.explorerApiUrl,
        chainId,
        contractAddress,
        apiKey
      );

    case "blockscout":
      return await fetchBlockscoutAbi(config.explorerApiUrl, contractAddress);

    case "solscan":
      return {
        success: false,
        error:
          "Solana IDL fetch not supported via API. Use Anchor CLI instead.",
      };

    default:
      return {
        success: false,
        error: `Unknown explorer type: ${config.explorerApiType}`,
      };
  }
}

function normalizeEtherscanTx(tx: EtherscanTransaction): NormalizedTransaction {
  return {
    hash: tx.hash,
    from: tx.from,
    to: tx.to,
    value: tx.value,
    input: tx.input,
    blockNumber: Number.parseInt(tx.blockNumber, 10),
    timestamp: tx.timeStamp,
    isError: tx.isError === "1",
  };
}

function normalizeBlockscoutTx(
  tx: BlockscoutTransaction
): NormalizedTransaction {
  return {
    hash: tx.hash,
    from: tx.from.hash,
    to: tx.to.hash,
    value: tx.value,
    input: tx.raw_input,
    blockNumber: tx.block,
    timestamp: tx.timestamp,
    isError: tx.status !== "ok",
  };
}

/**
 * Fetch transaction list for a contract address from the appropriate explorer
 *
 * @param config - Explorer configuration from database
 * @param contractAddress - Contract address to list transactions for
 * @param chainId - Chain ID (required for Etherscan v2)
 * @param startBlock - Start block number
 * @param endBlock - End block number
 * @param apiKey - Optional API key (required for Etherscan)
 */
export async function fetchContractTransactions(
  config: ExplorerConfig,
  contractAddress: string,
  chainId: number,
  startBlock: number,
  endBlock: number,
  apiKey?: string
): Promise<TransactionListResult> {
  if (!(config.explorerApiUrl && config.explorerApiType)) {
    return {
      success: false,
      error: "Explorer API not configured for this chain",
    };
  }

  switch (config.explorerApiType) {
    case "etherscan": {
      const result = await fetchEtherscanTransactions(
        config.explorerApiUrl,
        chainId,
        contractAddress,
        startBlock,
        endBlock,
        apiKey
      );
      if (!result.success) {
        return result;
      }
      return {
        success: true,
        transactions: result.transactions.map(normalizeEtherscanTx),
      };
    }

    case "blockscout": {
      const result = await fetchBlockscoutTransactions(
        config.explorerApiUrl,
        contractAddress,
        startBlock,
        endBlock
      );
      if (!result.success) {
        return result;
      }
      return {
        success: true,
        transactions: result.transactions.map(normalizeBlockscoutTx),
      };
    }

    default:
      return {
        success: false,
        error: `Transaction listing not supported for explorer type: ${config.explorerApiType}`,
      };
  }
}
