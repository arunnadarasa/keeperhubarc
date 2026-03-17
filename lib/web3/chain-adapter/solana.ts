import type { ethers } from "ethers";
import type { NonceSession } from "../nonce-manager";
import type {
  ChainAdapter,
  ContractCallRequest,
  SendTransactionRequest,
  TransactionOptions,
  TransactionReceipt,
} from "./types";

export class SolanaChainAdapter implements ChainAdapter {
  readonly chainFamily = "solana";
  private readonly chainId: number;

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  sendTransaction(
    _signer: ethers.Signer,
    _request: SendTransactionRequest,
    _session: NonceSession,
    _options: TransactionOptions
  ): Promise<TransactionReceipt> {
    return Promise.reject(
      new Error(
        `Solana sendTransaction not implemented (chainId: ${this.chainId})`
      )
    );
  }

  executeContractCall(
    _signer: ethers.Signer,
    _request: ContractCallRequest,
    _session: NonceSession,
    _options: TransactionOptions
  ): Promise<TransactionReceipt> {
    return Promise.reject(
      new Error(
        `Solana executeContractCall not implemented (chainId: ${this.chainId})`
      )
    );
  }

  getTransactionUrl(_txHash: string): Promise<string> {
    return Promise.reject(
      new Error(
        `Solana getTransactionUrl not implemented (chainId: ${this.chainId})`
      )
    );
  }

  getAddressUrl(_address: string): Promise<string> {
    return Promise.reject(
      new Error(
        `Solana getAddressUrl not implemented (chainId: ${this.chainId})`
      )
    );
  }
}
