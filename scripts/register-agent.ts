/**
 * Idempotent ERC-8004 identity registration script for KeeperHub
 *
 * Mints the KeeperHub identity NFT on Ethereum mainnet by calling register(agentURI)
 * on the ERC-8004 Identity Registry. Checks the DB first -- if a registration row
 * already exists, exits 0 without sending any transaction.
 *
 * Requires:
 *   REGISTRATION_PRIVATE_KEY - Private key of a funded Ethereum mainnet EOA (~0.003 ETH for gas)
 *   DATABASE_URL              - Database connection string
 *   CHAIN_ETH_MAINNET_PRIMARY_RPC - (recommended) Paid RPC endpoint (Alchemy/Infura)
 *
 * Run with: npx tsx scripts/register-agent.ts
 */

import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { ethers } from "ethers";
import postgres from "postgres";
import { getDatabaseUrl } from "../lib/db/connection-utils";
import { agentRegistrations } from "../lib/db/schema";
import { getRpcUrlByChainId } from "../lib/rpc/rpc-config";

export const IDENTITY_REGISTRY_ADDRESS =
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
export const AGENT_URI = "https://app.keeperhub.com/api/agent-registry";
export const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const IDENTITY_REGISTRY_ABI = [
  {
    inputs: [{ name: "agentURI", type: "string" }],
    name: "register",
    outputs: [{ name: "agentId", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

type TransactionLike = {
  hash: string;
  wait: () => Promise<ReceiptLike>;
};

type ReceiptLike = {
  logs: Array<{ topics: string[]; address: string }>;
};

type ContractLike = {
  register: (uri: string) => Promise<TransactionLike>;
};

type DbLike = {
  select: () => { from: (table: unknown) => { limit: (n: number) => Promise<unknown[]> } };
  insert: (table: unknown) => { values: (data: unknown) => Promise<void> };
};

export type RegisterDeps = {
  db: DbLike;
  buildContract: (address: string, abi: unknown, wallet: unknown) => ContractLike;
  buildProvider: (rpcUrl: string) => unknown;
  buildWallet: (privateKey: string, provider: unknown) => unknown;
};

export type RegisterResult =
  | { alreadyRegistered: true; agentId: string }
  | { agentId: string; txHash: string };

export async function registerAgent(deps?: RegisterDeps): Promise<RegisterResult> {
  const privateKey = process.env.REGISTRATION_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("REGISTRATION_PRIVATE_KEY environment variable is required");
  }

  let db: DbLike;
  let buildContract: RegisterDeps["buildContract"];
  let buildProvider: RegisterDeps["buildProvider"];
  let buildWallet: RegisterDeps["buildWallet"];
  let client: ReturnType<typeof postgres> | null = null;

  if (deps) {
    db = deps.db;
    buildContract = deps.buildContract;
    buildProvider = deps.buildProvider;
    buildWallet = deps.buildWallet;
  } else {
    const databaseUrl = getDatabaseUrl();
    client = postgres(databaseUrl, { max: 1 });
    db = drizzle(client) as unknown as DbLike;
    buildContract = (address, _abi, wallet) =>
      // biome-ignore lint/suspicious/noExplicitAny: ethers Contract ABI param accepts many forms; cast needed for DI pattern
      new ethers.Contract(address, IDENTITY_REGISTRY_ABI as any, wallet as ethers.ContractRunner) as unknown as ContractLike;
    buildProvider = (rpcUrl) => new ethers.JsonRpcProvider(rpcUrl);
    buildWallet = (pk, provider) =>
      new ethers.Wallet(pk, provider as ethers.JsonRpcProvider);
  }

  try {
    const rows = await db.select().from(agentRegistrations).limit(1);
    const existing = (rows[0] as { agentId: string; txHash: string } | undefined) ?? null;

    if (existing) {
      console.log(
        `Already registered: agentId=${existing.agentId}, txHash=${existing.txHash}`
      );
      return { alreadyRegistered: true, agentId: existing.agentId };
    }

    const rpcUrl = getRpcUrlByChainId(1);
    const provider = buildProvider(rpcUrl);
    const wallet = buildWallet(privateKey, provider);
    const registry = buildContract(
      IDENTITY_REGISTRY_ADDRESS,
      IDENTITY_REGISTRY_ABI,
      wallet
    );

    console.log(`Registering KeeperHub agent at ${AGENT_URI}...`);
    const tx = await registry.register(AGENT_URI);
    console.log(`Transaction sent: ${tx.hash}`);

    const receipt = await tx.wait();

    const transferLog = receipt.logs.find(
      (log) =>
        log.topics[0] === TRANSFER_TOPIC &&
        log.address.toLowerCase() === IDENTITY_REGISTRY_ADDRESS.toLowerCase()
    );

    if (!transferLog) {
      throw new Error("Transfer event not found in transaction receipt");
    }

    const agentId = BigInt(transferLog.topics[3]).toString();

    await db.insert(agentRegistrations).values({
      agentId,
      txHash: tx.hash,
      chainId: 1,
      registryAddress: IDENTITY_REGISTRY_ADDRESS,
    });

    console.log(`Registration complete: agentId=${agentId}, txHash=${tx.hash}`);
    return { agentId, txHash: tx.hash };
  } finally {
    if (client) {
      await client.end();
    }
  }
}

async function main(): Promise<void> {
  try {
    await registerAgent();
  } catch (err) {
    console.error(
      "Registration failed:",
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  }
}

// Only execute when run directly (not when imported in tests)
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("register-agent.ts") ||
    process.argv[1].endsWith("register-agent.js"));

if (isMain) {
  main();
}
