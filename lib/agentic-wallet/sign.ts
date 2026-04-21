/**
 * Agentic-wallet signing helpers.
 *
 * Phase 33 Wave 0: stub exports only. Plan 33-02 implements both signers:
 *
 *   signX402Challenge -- EIP-3009 TransferWithAuthorization on Base (chainId 8453),
 *   verifyingContract = Base USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913).
 *   Calls Turnkey signRawPayload with
 *     type:     "ACTIVITY_TYPE_SIGN_RAW_PAYLOAD_V2"
 *     encoding: "PAYLOAD_ENCODING_EIP712"
 *     hashFunction: "HASH_FUNCTION_NO_OP"
 *   Returned signature is the 132-char (0x + 65-byte) serialized signature with
 *   v-parity bumped by 27 (i.e. 1b/1c tail) per @turnkey/ethers::serializeSignature.
 *
 *   signMppProof -- zero-amount EIP-712 proof signing on Tempo (chainId 4217).
 *   Typed-data primaryType is "Proof"; domain = { name: "MPP", version: "1",
 *   chainId }. Same signRawPayload activity shape.
 *
 *   On Turnkey ACTIVITY_STATUS_CONSENSUS_NEEDED both helpers must map to a
 *   PolicyBlockedError (name "PolicyBlockedError", message contains "POLICY_BLOCKED")
 *   per RESEARCH Pitfall 7.
 */
export type X402Challenge = {
  payTo: string;
  amount: string;
  validAfter: number;
  validBefore: number;
  nonce: string;
};

export type MppProofChallenge = {
  chainId: number;
  challengeId: string;
};

export function signX402Challenge(
  _subOrgId: string,
  _walletAddress: string,
  _challenge: X402Challenge
): Promise<string> {
  throw new Error(
    "signX402Challenge: not yet implemented (Phase 33 plan 02)"
  );
}

export function signMppProof(
  _subOrgId: string,
  _walletAddress: string,
  _challenge: MppProofChallenge
): Promise<string> {
  throw new Error("signMppProof: not yet implemented (Phase 33 plan 02)");
}
