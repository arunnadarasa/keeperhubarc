/**
 * HMAC request authentication for agentic-wallet API surface.
 *
 * Phase 33 Wave 0: stub exports only. Plan 33-01a implements the helper
 * bodies per RESEARCH.md Pattern 5 (lines 474-531):
 *
 *   signingString = `${method}\n${path}\n${sha256_hex(body)}\n${timestamp}`
 *   signature     = hex(hmac_sha256(secret, signingString))
 *
 * Replay window: 300 seconds. Required headers: X-KH-Sub-Org, X-KH-Timestamp,
 * X-KH-Signature. Constant-time compare via crypto.timingSafeEqual.
 */

export function computeSignature(
  _secret: string,
  _method: string,
  _path: string,
  _body: string,
  _timestamp: string
): string {
  throw new Error("computeSignature: not yet implemented (Phase 33 plan 01a)");
}

export type VerifyHmacResult =
  | { ok: true; subOrgId: string }
  | { ok: false; status: number; error: string };

export function verifyHmacRequest(
  _request: Request,
  _body: string
): Promise<VerifyHmacResult> {
  throw new Error(
    "verifyHmacRequest: not yet implemented (Phase 33 plan 01a)"
  );
}
