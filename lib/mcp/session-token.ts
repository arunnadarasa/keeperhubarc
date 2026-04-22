import { errors, jwtVerify, SignJWT } from "jose";

export type SessionPayload = {
  org: string;
  key: string;
  scope?: string;
  iat: number;
  exp: number;
  original_iat?: number;
};

export const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24 hours
export const MAX_RENEWAL_GRACE_SECONDS = 48 * 60 * 60; // 48 hours
export const MAX_SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60; // 30 days

function getSessionSecret(): Uint8Array {
  const secret =
    process.env.MCP_SESSION_SECRET ??
    process.env.OAUTH_JWT_SECRET ??
    process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "No session secret configured. Set MCP_SESSION_SECRET, OAUTH_JWT_SECRET, or BETTER_AUTH_SECRET."
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  payload: Omit<SessionPayload, "iat" | "exp">
): Promise<string> {
  const secret = getSessionSecret();
  const now = Math.floor(Date.now() / 1000);
  const originalIat = payload.original_iat ?? now;
  return await new SignJWT({
    org: payload.org,
    key: payload.key,
    scope: payload.scope,
    original_iat: originalIat,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(secret);
}

export type VerifyOptions = {
  allowExpired?: boolean;
};

export type VerifyResult =
  | { payload: SessionPayload; expired: false }
  | { payload: SessionPayload; expired: true }
  | {
      payload: null;
      expired: false;
      reason:
        | "invalid_signature"
        | "malformed"
        | "too_old"
        | "max_lifetime_exceeded";
    };

export async function verifySessionToken(
  token: string,
  options?: VerifyOptions
): Promise<SessionPayload | null> {
  const result = await verifySessionTokenDetailed(token);
  if (!result.payload) {
    return null;
  }
  if (result.expired && !options?.allowExpired) {
    return null;
  }
  return result.payload;
}

export async function verifySessionTokenDetailed(
  token: string
): Promise<VerifyResult> {
  try {
    const secret = getSessionSecret();
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      clockTolerance: MAX_RENEWAL_GRACE_SECONDS,
    });

    const claims = payload as unknown as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    const sessionOrigin = claims.original_iat ?? claims.iat;
    if (now - sessionOrigin > MAX_SESSION_LIFETIME_SECONDS) {
      return { payload: null, expired: false, reason: "max_lifetime_exceeded" };
    }

    if (claims.exp < now) {
      return { payload: claims, expired: true };
    }
    return { payload: claims, expired: false };
  } catch (err) {
    if (err instanceof errors.JWTExpired) {
      return { payload: null, expired: false, reason: "too_old" };
    }
    if (err instanceof errors.JWSSignatureVerificationFailed) {
      return { payload: null, expired: false, reason: "invalid_signature" };
    }
    return { payload: null, expired: false, reason: "malformed" };
  }
}
