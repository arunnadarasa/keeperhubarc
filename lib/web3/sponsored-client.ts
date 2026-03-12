import "server-only";
import { createSmartAccountClient } from "permissionless";
import { to7702SimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import type { Address } from "viem";
import { createPublicClient, http } from "viem";
import { ErrorCategory, logSystemError } from "@/keeperhub/lib/logging";
import { createParaViemAccount } from "@/keeperhub/lib/para/viem-account-adapter";
import { ensureDelegated } from "@/keeperhub/lib/web3/eip7702-delegation";
import {
  ENTRYPOINT_V07_ADDRESS,
  ENTRYPOINT_VERSION,
  getPimlicoUrl,
  isSponsorshipSupported,
} from "@/keeperhub/lib/web3/pimlico-config";

type SponsoredClientResult = {
  // biome-ignore lint/suspicious/noExplicitAny: SmartAccountClient generic signature is deeply nested across permissionless.js types
  smartAccountClient: any;
  walletAddress: Address;
};

/**
 * Creates a sponsored smart account client for an organization.
 *
 * This:
 * 1. Creates a viem account backed by Para MPC signing
 * 2. Ensures EIP-7702 delegation is active (one-time per chain)
 * 3. Creates a Pimlico-sponsored smart account client
 *
 * Returns null if sponsorship cannot be set up (unsupported chain,
 * delegation failed, etc). Callers should fall back to direct signing.
 */
export async function createSponsoredClient(
  organizationId: string,
  chainId: number,
  rpcUrl: string
): Promise<SponsoredClientResult | null> {
  if (!isSponsorshipSupported(chainId)) {
    return null;
  }

  try {
    const { account, walletRecord } =
      await createParaViemAccount(organizationId);
    const walletAddress = walletRecord.walletAddress as Address;

    const delegated = await ensureDelegated(
      organizationId,
      chainId,
      rpcUrl,
      walletAddress
    );

    if (!delegated) {
      return null;
    }

    const publicClient = createPublicClient({
      transport: http(rpcUrl),
    });

    const pimlicoUrl = getPimlicoUrl(chainId);

    const pimlicoClient = createPimlicoClient({
      transport: http(pimlicoUrl),
      entryPoint: {
        address: ENTRYPOINT_V07_ADDRESS,
        version: ENTRYPOINT_VERSION,
      },
    });

    const smartAccount = await to7702SimpleSmartAccount({
      client: publicClient,
      owner: account,
    });

    const gasPrices = await pimlicoClient.getUserOperationGasPrice();

    const smartAccountClient = createSmartAccountClient({
      account: smartAccount,
      bundlerTransport: http(pimlicoUrl),
      paymaster: pimlicoClient,
      userOperation: {
        estimateFeesPerGas: async () => gasPrices.fast,
      },
    });

    return { smartAccountClient, walletAddress };
  } catch (error) {
    logSystemError(
      ErrorCategory.TRANSACTION,
      "[Sponsorship] Failed to create sponsored client",
      error instanceof Error ? error : new Error(String(error)),
      {
        organizationId,
        chainId: chainId.toString(),
      }
    );
    return null;
  }
}
