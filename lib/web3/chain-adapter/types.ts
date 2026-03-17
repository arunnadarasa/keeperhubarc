import type { ethers } from "ethers";
import type { NonceSession } from "../nonce-manager";
import type { TriggerType } from "../transaction-manager";

export type TransactionReceipt = {
  hash: string;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  blockNumber: number;
};

export type GasOverrides = {
  multiplierOverride?: number;
  gasLimitOverride?: bigint;
};

export type SendTransactionRequest = {
  to: string;
  value?: bigint;
  data?: string;
};

export type ContractCallRequest = {
  contractAddress: string;
  abi: ethers.InterfaceAbi;
  functionKey: string;
  args: unknown[];
  value?: bigint;
};

export interface ChainAdapter {
  readonly chainFamily: string;

  sendTransaction(
    signer: ethers.Signer,
    request: SendTransactionRequest,
    session: NonceSession,
    options: TransactionOptions
  ): Promise<TransactionReceipt>;

  executeContractCall(
    signer: ethers.Signer,
    request: ContractCallRequest,
    session: NonceSession,
    options: TransactionOptions
  ): Promise<TransactionReceipt>;

  getTransactionUrl(txHash: string): Promise<string>;

  getAddressUrl(address: string): Promise<string>;
}

export type TransactionOptions = {
  triggerType: TriggerType;
  gasOverrides: GasOverrides;
  workflowId?: string;
};
