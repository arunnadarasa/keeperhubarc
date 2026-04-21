/**
 * Agentic-wallet provisioning pipeline.
 *
 * Full flow (ONBOARD-01 / ONBOARD-02 / ONBOARD-03 / GUARD-06):
 *   1. Turnkey createSubOrganization (KeeperHub-operator, single root user,
 *      anonymous disable* flags = true, single EVM derivation path per
 *      CONTEXT Resolution #1)
 *   2. Apply 3 baseline Turnkey policies via applyBaselinePolicies (parallelized
 *      inside that helper)
 *   3. DB insert into agentic_wallets (with hmac_secret) + agentic_wallet_credits
 *      ($0.50 seed credit) in parallel
 *   4. Return { subOrgId, walletAddress, hmacSecret } — single wallet address
 *      per CONTEXT Resolution #1 (Base + Tempo share the same EVM address)
 *
 * T-33-02 (Information Disclosure): hmacSecret NEVER surfaces in logs or
 * errors. The return value is the only channel. logSystemError metadata
 * carries only service name + subOrgId.
 *
 * T-33-leaked-suborg (Repudiation): if sub-org creation succeeds but DB
 * insert fails, log AGENTIC_WALLET_LEAKED_SUBORG with the sub-org id so
 * ops can clean up manually (RESEARCH Pitfall 6).
 */
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { agenticWallets } from "@/lib/db/schema";
import { ErrorCategory, logSystemError } from "@/lib/logging";
import {
  getTurnkeyClientForOrg,
  getTurnkeyParentClient,
} from "@/lib/turnkey/agentic-wallet";
import { generateId } from "@/lib/utils/id";
import { grantInitialCredit } from "./credit";
import { applyBaselinePolicies, PolicyIncompleteError } from "./policy";

export type ProvisionAgenticWalletResult = {
  subOrgId: string;
  walletAddress: string;
  hmacSecret: string;
};

export async function provisionAgenticWallet(): Promise<ProvisionAgenticWalletResult> {
  const apiPublicKey = process.env.TURNKEY_API_PUBLIC_KEY;
  const organizationId = process.env.TURNKEY_ORGANIZATION_ID;
  if (!(apiPublicKey && organizationId)) {
    throw new Error(
      "TURNKEY_API_PUBLIC_KEY and TURNKEY_ORGANIZATION_ID must be set"
    );
  }

  const parentClient = getTurnkeyParentClient().apiClient();

  let subOrgId: string | undefined;
  let walletAddress: string | undefined;

  try {
    const subOrg = await parentClient.createSubOrganization({
      organizationId,
      subOrganizationName: `keeperhub-agentic-${generateId()}`,
      rootQuorumThreshold: 1,
      rootUsers: [
        {
          userName: "keeperhub-operator",
          apiKeys: [
            {
              apiKeyName: "keeperhub-server",
              publicKey: apiPublicKey,
              curveType: "API_KEY_CURVE_P256" as const,
            },
          ],
          authenticators: [],
          oauthProviders: [],
        },
      ],
      disableEmailAuth: true,
      disableEmailRecovery: true,
      disableSmsAuth: true,
      disableOtpEmailAuth: true,
      wallet: {
        walletName: "Default Wallet",
        accounts: [
          {
            curve: "CURVE_SECP256K1" as const,
            pathFormat: "PATH_FORMAT_BIP32" as const,
            path: "m/44'/60'/0'/0/0",
            addressFormat: "ADDRESS_FORMAT_ETHEREUM" as const,
          },
        ],
      },
    });

    subOrgId = subOrg.subOrganizationId;
    walletAddress = subOrg.wallet?.addresses?.[0];

    if (!(subOrgId && walletAddress)) {
      throw new Error("Turnkey sub-org creation returned incomplete data");
    }

    // T-33-02: never log this value. 32 random bytes -> 64 hex chars.
    const hmacSecret = randomBytes(32).toString("hex");

    // Apply the three baseline DENY policies to the newly-created sub-org
    // before returning the secret to the caller. Parallelized inside
    // applyBaselinePolicies (RESEARCH Pitfall 1 latency mitigation).
    //
    // REVIEW HI-04: applyBaselinePolicies now throws PolicyIncompleteError
    // on any partial failure. We log the orphaned sub-org distinctly so ops
    // can clean it up manually; the DB insert is skipped (the outer catch
    // re-throws) so the wallet is never returned to the caller. GUARD-06
    // requires the Turnkey policy to be the hard limit, so a sub-org with
    // partial coverage must be treated as unusable.
    try {
      await applyBaselinePolicies(
        getTurnkeyClientForOrg(subOrgId).apiClient(),
        subOrgId
      );
    } catch (policyError) {
      if (policyError instanceof PolicyIncompleteError) {
        logSystemError(
          ErrorCategory.EXTERNAL_SERVICE,
          "[Agentic] AGENTIC_WALLET_ORPHANED_SUBORG — policies incomplete, sub-org abandoned",
          policyError,
          {
            service: "agentic-wallet",
            subOrgId,
            failures: policyError.failures.join(","),
          }
        );
      }
      throw policyError;
    }

    // REVIEW ME-06: the wallet row must land before the credit FK check.
    // Previously these ran in parallel via Promise.all; if the credit insert
    // happened to begin before the wallet insert committed, the FK check
    // could fail with a violation message that included the sub-org id.
    // Serialising is effectively free (<10ms extra on the 10s ONBOARD-01
    // budget) and removes the ordering hazard. A future transaction wrap
    // (db.transaction) would be strictly better but requires deeper test
    // mock refactoring -- deferred per review.
    try {
      await db.insert(agenticWallets).values({
        subOrgId,
        // CONTEXT Resolution #1: single path => same address on both chains.
        walletAddressBase: walletAddress,
        walletAddressTempo: walletAddress,
        hmacSecret,
      });
      await grantInitialCredit(subOrgId);
    } catch (dbError) {
      logSystemError(
        ErrorCategory.DATABASE,
        "[Agentic] AGENTIC_WALLET_LEAKED_SUBORG — Turnkey sub-org created but DB insert failed",
        dbError,
        { service: "agentic-wallet", subOrgId }
      );
      throw dbError;
    }

    return { subOrgId, walletAddress, hmacSecret };
  } catch (error) {
    logSystemError(
      ErrorCategory.EXTERNAL_SERVICE,
      "[Agentic] Failed to provision agentic wallet",
      error,
      { service: "agentic-wallet", subOrgId: subOrgId ?? "unknown" }
    );
    throw error;
  }
}
