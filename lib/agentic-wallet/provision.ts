/**
 * Agentic-wallet provisioning helper.
 *
 * Phase 33 Wave 0: stub only. Plan 33-01b fleshes out the full flow:
 *   1. Turnkey createSubOrganization (KeeperHub-operator, single root user,
 *      disable* flags = true, one EVM derivation path per CONTEXT Resolution #1)
 *   2. Apply baseline Turnkey policies (33-00 Wave 0 scaffolds them; 01a
 *      implements the DSL strings)
 *   3. DB insert into agentic_wallets (with hmac_secret) + agentic_wallet_credits
 *      ($0.50 seed credit per ONBOARD-03)
 *   4. Return { subOrgId, walletAddress, hmacSecret } (single wallet address per
 *      CONTEXT Resolution #1 -- Base + Tempo share the same EVM address)
 */
export type ProvisionAgenticWalletResult = {
  subOrgId: string;
  walletAddress: string;
  hmacSecret: string;
};

export function provisionAgenticWallet(): Promise<ProvisionAgenticWalletResult> {
  throw new Error(
    "provisionAgenticWallet: not yet implemented (Phase 33 plan 01b)"
  );
}
