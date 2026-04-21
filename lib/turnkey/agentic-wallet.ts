/**
 * Agentic Wallet Turnkey module.
 *
 * MODULE BOUNDARY (v1.8 custody isolation):
 * This file MUST NOT import from `./turnkey-operations`. Creator wallets
 * (org-scoped, user-authenticated) and agentic wallets (KeeperHub-owned
 * sub-orgs, server-proxied signing) are separate custody models. Entangling
 * them re-introduces the coupling v1.8 was designed to prevent.
 *
 * If you are about to import a creator-wallet helper (wallet creation,
 * private-key export, or signer config) from `./turnkey-operations` -- stop.
 * Add the primitive you need to this file instead, or use the low-level
 * @turnkey/sdk-server client directly.
 *
 * Enforced by: tests/unit/agentic-wallet-boundary.test.ts (static string check)
 * and code review.
 */
import type { Turnkey } from "@turnkey/sdk-server";

/**
 * Passkey Relying Party ID for agentic-wallet passkey enrollment.
 *
 * Apex domain (NOT the `app.` subdomain) so credentials registered via the
 * webapp can be used by future subdomains without re-enrollment (ONBOARD-05).
 *
 * This is the ONLY definition of the agentic-wallet RPID in the codebase.
 */
export const AGENTIC_RPID = "keeperhub.com";

export type CreateAgenticWalletResult = {
  subOrgId: string;
  walletAddressBase: string;
  walletAddressTempo: string;
};

/**
 * Create a KeeperHub-owned Turnkey sub-org for an agentic wallet.
 * Phase 32: stub. Phase 33 implements.
 *
 * The `async` modifier is load-bearing: this is the published contract
 * Phase 33 will satisfy with real `await` calls against the Turnkey SDK.
 * Callers in Phase 33 and beyond will `await createAgenticWallet(...)`;
 * dropping `async` now would force a breaking API change later.
 */
// biome-ignore lint/suspicious/useAwait: stub preserves the Phase-33 async contract; removing `async` would break the published Promise<CreateAgenticWalletResult> signature and require rewriting every future caller.
export async function createAgenticWallet(): Promise<CreateAgenticWalletResult> {
  throw new Error("createAgenticWallet: not yet implemented (Phase 33)");
}

/**
 * Factory returning a Turnkey client scoped to a specific agentic sub-org.
 * Used by the signing proxy to stamp requests as the sub-org.
 * Phase 32: stub. Phase 33 implements.
 */
export function getTurnkeyClientForOrg(_subOrgId: string): Turnkey {
  throw new Error("getTurnkeyClientForOrg: not yet implemented (Phase 33)");
}
