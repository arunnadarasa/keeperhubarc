/**
 * @security HMAC request-authentication primitive for /sign, /approval-request, /link.
 *
 * Signing string format (CONTEXT line 29 / RESEARCH Pattern 5):
 *   signingString = `${method}\n${pathname}\n${sha256_hex(body)}\n${timestamp}`
 *   signature     = hex(hmac_sha256(secret, signingString))
 *
 * Headers: X-KH-Sub-Org, X-KH-Timestamp (unix seconds), X-KH-Signature (hex).
 * Replay window: 300 seconds, symmetric (|now - ts| <= 300).
 *
 * Replay within the 300-second window is INTENTIONALLY accepted — see
 * 33-RESEARCH.md Pitfall 4 Option A. The underlying x402/MPP protocol nonce
 * prevents double-spend; adding a server-side nonce cache here would be
 * defense-in-depth with measurable latency cost. Revisit if a security review
 * requires strict single-use.
 *
 * T-33-01 (Spoofing) mitigations: all three headers required, timestamp
 * window, length pre-check before timingSafeEqual (avoid length-leak),
 * constant-time compare on the hex strings.
 *
 * T-33-02 (Information Disclosure) mitigation: never log the secret,
 * signature, or timestamp in error paths.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { lookupHmacSecret } from "./hmac-secret-store";

const REPLAY_WINDOW_SECONDS = 300;

export function computeSignature(
  secret: string,
  method: string,
  path: string,
  body: string,
  timestamp: string
): string {
  const bodyDigest = createHash("sha256").update(body).digest("hex");
  const signingString = `${method}\n${path}\n${bodyDigest}\n${timestamp}`;
  return createHmac("sha256", secret).update(signingString).digest("hex");
}

export type VerifyHmacResult =
  | { ok: true; subOrgId: string }
  | { ok: false; status: number; error: string };

export async function verifyHmacRequest(
  request: Request,
  body: string
): Promise<VerifyHmacResult> {
  const subOrgId = request.headers.get("X-KH-Sub-Org");
  const timestamp = request.headers.get("X-KH-Timestamp");
  const signature = request.headers.get("X-KH-Signature");

  if (!(subOrgId && timestamp && signature)) {
    return { ok: false, status: 401, error: "Missing HMAC headers" };
  }

  const now = Math.floor(Date.now() / 1000);
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, status: 401, error: "Timestamp outside replay window" };
  }

  const secret = await lookupHmacSecret(subOrgId);
  if (!secret) {
    return { ok: false, status: 404, error: "Unknown sub-org" };
  }

  const url = new URL(request.url);
  const expected = computeSignature(
    secret,
    request.method,
    url.pathname,
    body,
    timestamp
  );

  // Length pre-check avoids the Buffer.from(...)-length-mismatch throw in
  // timingSafeEqual and prevents a length-based side channel.
  if (signature.length !== expected.length) {
    return { ok: false, status: 401, error: "Invalid signature" };
  }
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: "Invalid signature" };
  }

  return { ok: true, subOrgId };
}
