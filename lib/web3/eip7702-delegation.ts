import "server-only";
import { getPrivateKey } from "@getpara/server-sdk/dist/esm/wallet/privateKey.js";
import { and, eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { gasSponsorshipDelegations } from "@/keeperhub/db/schema-extensions";
import { ErrorCategory, logSystemError } from "@/keeperhub/lib/logging";
import { createParaClientForOrg } from "@/keeperhub/lib/para/viem-account-adapter";
import { getSimpleAccount7702Address } from "@/keeperhub/lib/web3/pimlico-config";
import { db } from "@/lib/db";

/**
 * Check if an EOA already has EIP-7702 delegation active on a given chain.
 * Looks at on-chain code at the EOA address -- if bytecode exists,
 * the delegation is already in place.
 */
async function checkOnChainDelegation(
  rpcUrl: string,
  walletAddress: Address
): Promise<boolean> {
  const client = createPublicClient({
    transport: http(rpcUrl),
  });

  const code = await client.getCode({ address: walletAddress });
  // EIP-7702 delegated EOAs have a small delegation designator bytecode
  return code !== undefined && code !== "0x";
}

/**
 * Check if we have a DB record of a successful delegation for this org+chain.
 */
async function checkDbDelegation(
  organizationId: string,
  chainId: number
): Promise<boolean> {
  const records = await db
    .select()
    .from(gasSponsorshipDelegations)
    .where(
      and(
        eq(gasSponsorshipDelegations.organizationId, organizationId),
        eq(gasSponsorshipDelegations.chainId, chainId),
        eq(gasSponsorshipDelegations.status, "active")
      )
    )
    .limit(1);

  return records.length > 0;
}

/**
 * Perform the one-time EIP-7702 delegation for an organization's EOA.
 *
 * This upgrades the EOA to also function as a smart account by delegating
 * to a SimpleAccount7702 implementation. The EOA keeps its address, balances,
 * and approvals -- it just gains smart account capabilities for ERC-4337.
 *
 * Requires extracting the private key from Para (via getPrivateKey) because
 * EIP-7702 authorization signing requires signing a raw hash that Para's
 * MPC signMessage cannot handle (it adds EIP-191 prefix).
 *
 * This is a ONE-TIME operation per EOA per chain.
 */
async function performDelegation(
  organizationId: string,
  chainId: number,
  rpcUrl: string
): Promise<{ txHash: Hex; walletAddress: Address }> {
  const { paraClient, walletRecord, decryptedShare } =
    await createParaClientForOrg(organizationId);

  // biome-ignore lint/suspicious/noExplicitAny: accessing internal Para SDK ctx for private key extraction
  const ctx = (paraClient as any).ctx;

  let privateKeyHex: string | undefined;

  try {
    privateKeyHex = await getPrivateKey(
      ctx,
      walletRecord.userId,
      walletRecord.walletId,
      decryptedShare
    );

    const viemAccount = privateKeyToAccount(`0x${privateKeyHex}` as Hex);

    const walletAddress = viemAccount.address;

    const client = createPublicClient({
      transport: http(rpcUrl),
    });

    const accountNonce = await client.getTransactionCount({
      address: walletAddress,
    });

    const authorization = await viemAccount.signAuthorization({
      address: getSimpleAccount7702Address(),
      chainId,
      nonce: accountNonce,
    });

    const txHash = await buildAndSendDelegationTx(
      viemAccount,
      walletAddress,
      authorization,
      rpcUrl
    );

    const receipt = await client.waitForTransactionReceipt({
      hash: txHash,
    });

    if (receipt.status !== "success") {
      throw new Error(`Delegation tx reverted: ${txHash}`);
    }

    return { txHash, walletAddress };
  } finally {
    // Zero the private key immediately
    if (privateKeyHex !== undefined) {
      privateKeyHex = undefined;
    }
  }
}

/**
 * Build and send a type-4 (EIP-7702) delegation transaction via wallet client.
 */
async function buildAndSendDelegationTx(
  account: ReturnType<typeof privateKeyToAccount>,
  walletAddress: Address,
  // biome-ignore lint/suspicious/noExplicitAny: viem SignedAuthorization type varies across versions
  authorization: any,
  rpcUrl: string
): Promise<Hex> {
  const { createWalletClient } = await import("viem");

  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  });

  const txHash = await walletClient.sendTransaction({
    to: walletAddress,
    value: BigInt(0),
    authorizationList: [authorization],
    chain: null,
  });

  return txHash;
}

/**
 * Ensure the organization's EOA has EIP-7702 delegation on the given chain.
 *
 * This is idempotent -- if delegation already exists (checked on-chain
 * and in DB), it returns immediately. If not, performs the one-time
 * delegation and records it in the database.
 *
 * Returns true if delegation is active (either pre-existing or newly created),
 * false if delegation failed.
 */
export async function ensureDelegated(
  organizationId: string,
  chainId: number,
  rpcUrl: string,
  walletAddress: Address
): Promise<boolean> {
  // Fast path: check DB record first (avoids RPC call)
  const hasDbRecord = await checkDbDelegation(organizationId, chainId);
  if (hasDbRecord) {
    return true;
  }

  // Check on-chain delegation status
  const hasOnChainDelegation = await checkOnChainDelegation(
    rpcUrl,
    walletAddress
  );

  if (hasOnChainDelegation) {
    // On-chain delegation exists but we don't have a DB record.
    // Record it so future checks are faster.
    await recordDelegation(
      organizationId,
      walletAddress,
      chainId,
      "0x" as Hex, // Unknown tx hash for pre-existing delegation
      "active"
    );
    return true;
  }

  // Perform the delegation
  try {
    const { txHash } = await performDelegation(organizationId, chainId, rpcUrl);

    await recordDelegation(
      organizationId,
      walletAddress,
      chainId,
      txHash,
      "active"
    );

    return true;
  } catch (error) {
    logSystemError(
      ErrorCategory.TRANSACTION,
      "[EIP-7702] Delegation failed",
      error instanceof Error ? error : new Error(String(error)),
      {
        organizationId,
        chainId: chainId.toString(),
        walletAddress,
      }
    );
    return false;
  }
}

async function recordDelegation(
  organizationId: string,
  walletAddress: Address,
  chainId: number,
  delegationTxHash: Hex,
  status: string
): Promise<void> {
  await db
    .insert(gasSponsorshipDelegations)
    .values({
      organizationId,
      walletAddress,
      chainId,
      delegationTxHash,
      implementationAddress: getSimpleAccount7702Address(),
      status,
      delegatedAt: new Date(),
    })
    .onConflictDoNothing();
}
