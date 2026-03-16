import { eq } from "drizzle-orm";
import { ethers } from "ethers";
import { NextResponse } from "next/server";
import { apiError } from "@/keeperhub/lib/api-error";
import { resolveOrganizationId } from "@/keeperhub/lib/middleware/auth-helpers";
import { getOrganizationWallet } from "@/keeperhub/lib/para/wallet-helpers";
import ERC20_ABI from "@/lib/contracts/abis/erc20.json";
import { db } from "@/lib/db";
import { chains, organizationTokens } from "@/lib/db/schema";
import { getRpcProvider } from "@/lib/rpc/provider-factory";

type TokenBalance = {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: string;
  balanceRaw: string;
  logoUrl?: string;
};

type ChainBalance = {
  chainId: number;
  chainName: string;
  symbol: string;
  isTestnet: boolean;
  nativeBalance: string;
  nativeBalanceRaw: string;
  tokens: TokenBalance[];
  loading?: boolean;
  error?: string;
};

/**
 * GET /api/user/wallet/balances
 *
 * Fetches native token and ERC20 token balances across all enabled chains
 * for the organization's wallet.
 */
export async function GET(request: Request) {
  try {
    const authCtx = await resolveOrganizationId(request);
    if ("error" in authCtx) {
      return NextResponse.json(
        { error: authCtx.error },
        { status: authCtx.status }
      );
    }
    const { organizationId: activeOrgId } = authCtx;

    // Get the organization's wallet
    const wallet = await getOrganizationWallet(activeOrgId).catch(() => null);
    if (!wallet) {
      return NextResponse.json(
        { error: "No wallet found for this organization" },
        { status: 404 }
      );
    }

    const walletAddress = wallet.walletAddress;

    // Get all enabled chains
    const enabledChains = await db
      .select()
      .from(chains)
      .where(eq(chains.isEnabled, true));

    // Get tracked tokens for this organization
    const trackedTokens = await db
      .select()
      .from(organizationTokens)
      .where(eq(organizationTokens.organizationId, activeOrgId));

    // Group tokens by chainId
    const tokensByChain = new Map<number, typeof trackedTokens>();
    for (const token of trackedTokens) {
      const existing = tokensByChain.get(token.chainId) || [];
      existing.push(token);
      tokensByChain.set(token.chainId, existing);
    }

    // Fetch balances for each chain in parallel
    const balancePromises = enabledChains.map(
      async (chain): Promise<ChainBalance> => {
        const isTestnet = chain.isTestnet === true;

        try {
          const rpcManager = await getRpcProvider({
            chainId: chain.chainId,
          });

          // Fetch native balance with retry/failover
          const nativeBalanceRaw = await rpcManager.executeWithFailover(
            (provider) => provider.getBalance(walletAddress)
          );
          const nativeBalance = ethers.formatEther(nativeBalanceRaw);

          // Fetch ERC20 token balances for this chain
          const chainTokens = tokensByChain.get(chain.chainId) || [];
          const tokenBalances: TokenBalance[] = [];

          for (const token of chainTokens) {
            try {
              const balanceRaw = await rpcManager.executeWithFailover(
                async (provider) => {
                  const contract = new ethers.Contract(
                    token.tokenAddress,
                    ERC20_ABI,
                    provider
                  );
                  return (await contract.balanceOf(walletAddress)) as bigint;
                }
              );
              const balance = ethers.formatUnits(balanceRaw, token.decimals);

              tokenBalances.push({
                address: token.tokenAddress,
                symbol: token.symbol,
                name: token.name,
                decimals: token.decimals,
                balance,
                balanceRaw: balanceRaw.toString(),
                logoUrl: token.logoUrl || undefined,
              });
            } catch (tokenError) {
              console.error(
                `[Balances] Failed to fetch balance for token ${token.symbol}:`,
                tokenError
              );
              tokenBalances.push({
                address: token.tokenAddress,
                symbol: token.symbol,
                name: token.name,
                decimals: token.decimals,
                balance: "0",
                balanceRaw: "0",
                logoUrl: token.logoUrl || undefined,
              });
            }
          }

          return {
            chainId: chain.chainId,
            chainName: chain.name,
            symbol: chain.symbol,
            isTestnet,
            nativeBalance,
            nativeBalanceRaw: nativeBalanceRaw.toString(),
            tokens: tokenBalances,
          };
        } catch (error) {
          console.error(
            `[Balances] Failed to fetch balance for chain ${chain.name}:`,
            error
          );
          return {
            chainId: chain.chainId,
            chainName: chain.name,
            symbol: chain.symbol,
            isTestnet,
            nativeBalance: "0",
            nativeBalanceRaw: "0",
            tokens: [],
            error:
              error instanceof Error
                ? error.message
                : "Failed to fetch balance",
          };
        }
      }
    );

    const balances = await Promise.all(balancePromises);

    // Sort: mainnets first, then testnets
    balances.sort((a, b) => {
      if (a.isTestnet !== b.isTestnet) {
        return a.isTestnet ? 1 : -1;
      }
      return a.chainName.localeCompare(b.chainName);
    });

    return NextResponse.json({
      walletAddress,
      balances,
    });
  } catch (error) {
    return apiError(error, "Failed to fetch wallet balances");
  }
}
