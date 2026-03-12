import "server-only";
import { Environment, Para as ParaServer } from "@getpara/server-sdk";
import type { Address, Hex, LocalAccount, SignableMessage } from "viem";
import { hashMessage, hashTypedData, serializeTransaction } from "viem/utils";
import { decryptUserShare } from "@/keeperhub/lib/encryption";
import { ErrorCategory, logSystemError } from "@/keeperhub/lib/logging";
import { getOrganizationWallet } from "@/keeperhub/lib/para/wallet-helpers";

type ParaWalletRecord = {
  userId: string;
  walletId: string;
  walletAddress: string;
  userShare: string;
};

function hexToBase64(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(clean, "hex").toString("base64");
}

function parseSignature(sigHex: string): { r: Hex; s: Hex; v: bigint } {
  const clean = sigHex.startsWith("0x") ? sigHex.slice(2) : sigHex;
  const r = `0x${clean.slice(0, 64)}` as Hex;
  const s = `0x${clean.slice(64, 128)}` as Hex;
  const vByte = Number.parseInt(clean.slice(128, 130), 16);
  const v = BigInt(vByte < 27 ? vByte + 27 : vByte);
  return { r, s, v };
}

function initializeParaClient(): ParaServer {
  const apiKey = process.env.PARA_API_KEY;
  if (!apiKey) {
    throw new Error("PARA_API_KEY not configured");
  }
  const env = process.env.PARA_ENVIRONMENT || "beta";
  return new ParaServer(
    env === "prod" ? Environment.PROD : Environment.BETA,
    apiKey
  );
}

/**
 * Creates a viem LocalAccount backed by Para's MPC signing.
 *
 * The returned account delegates signMessage/signTypedData/signTransaction
 * to Para's server-side MPC protocol via user shares. This allows it to
 * be used as the `owner` for permissionless.js smart account clients.
 *
 * Note: signAuthorization is NOT implemented here because EIP-7702
 * authorization requires raw private key access (Para's MPC signing
 * adds EIP-191/712 prefixes). The delegation module handles this
 * separately via getPrivateKey().
 */
export async function createParaViemAccount(
  organizationId: string
): Promise<{ account: LocalAccount; walletRecord: ParaWalletRecord }> {
  const walletRecord = await getOrganizationWallet(organizationId);
  const paraClient = initializeParaClient();

  const decryptedShare = decryptUserShare(walletRecord.userShare);
  await paraClient.setUserShare(decryptedShare);

  const walletId = walletRecord.walletId;
  const address = walletRecord.walletAddress as Address;

  async function signRawHash(hash: Hex): Promise<Hex> {
    const res = await paraClient.signMessage({
      walletId,
      messageBase64: hexToBase64(hash),
    });
    if (!("signature" in res)) {
      throw new Error("Para signing was denied");
    }
    return `0x${res.signature}` as Hex;
  }

  const account: LocalAccount = {
    address,
    // publicKey is not recoverable from address alone; permissionless.js
    // only uses the address field from the owner account
    publicKey: "0x" as Hex,
    source: "para" as string,
    type: "local",

    async sign({ hash }: { hash: Hex }): Promise<Hex> {
      return await signRawHash(hash);
    },

    async signMessage({ message }: { message: SignableMessage }): Promise<Hex> {
      const hash = hashMessage(message);
      return await signRawHash(hash);
    },

    async signTransaction(transaction, _options?): Promise<Hex> {
      const serialized = serializeTransaction(transaction);
      const res = await paraClient.signMessage({
        walletId,
        messageBase64: hexToBase64(serialized),
      });
      if (!("signature" in res)) {
        throw new Error("Para transaction signing was denied");
      }
      const { r, s, v } = parseSignature(res.signature);
      const yParity = v === BigInt(28) ? 1 : 0;
      return serializeTransaction(transaction, {
        r,
        s,
        yParity,
      });
    },

    // biome-ignore lint/suspicious/noExplicitAny: viem TypedDataDefinition generic is complex
    async signTypedData(parameters: any): Promise<Hex> {
      const hash = hashTypedData(parameters);
      return await signRawHash(hash);
    },
  };

  return { account, walletRecord };
}

/**
 * Creates a Para client with user share set, ready for signing operations.
 * Used by the EIP-7702 delegation module which needs the raw Para client
 * for private key extraction.
 */
export async function createParaClientForOrg(organizationId: string): Promise<{
  paraClient: ParaServer;
  walletRecord: ParaWalletRecord;
  decryptedShare: string;
}> {
  const walletRecord = await getOrganizationWallet(organizationId);
  const paraClient = initializeParaClient();

  const decryptedShare = decryptUserShare(walletRecord.userShare);
  await paraClient.setUserShare(decryptedShare);

  try {
    await paraClient.setUserId(walletRecord.userId);
  } catch (error) {
    logSystemError(
      ErrorCategory.INFRASTRUCTURE,
      "[Para] Failed to set userId for private key operations",
      error instanceof Error ? error : new Error(String(error)),
      { component: "viem-adapter", organizationId }
    );
    throw error;
  }

  return { paraClient, walletRecord, decryptedShare };
}
