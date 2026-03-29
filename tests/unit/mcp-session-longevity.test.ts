import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSessionToken,
  MAX_RENEWAL_GRACE_SECONDS,
  SESSION_TTL_SECONDS,
  verifySessionToken,
  verifySessionTokenDetailed,
} from "@/lib/mcp/session-token";
import { SESSION_TTL_MS } from "@/lib/mcp/sessions";

const TEST_SECRET = "test-session-secret-for-unit-tests";

beforeEach(() => {
  process.env.MCP_SESSION_SECRET = TEST_SECRET;
});

afterEach(() => {
  // biome-ignore lint/performance/noDelete: delete is required to remove env vars (undefined assignment coerces to string)
  delete process.env.MCP_SESSION_SECRET;
});

describe("TTL constants", () => {
  it("SESSION_TTL_SECONDS is 86400 (24 hours)", () => {
    expect(SESSION_TTL_SECONDS).toBe(86_400);
  });

  it("SESSION_TTL_MS is 86400000 (24 hours)", () => {
    expect(SESSION_TTL_MS).toBe(86_400_000);
  });
});

describe("createSessionToken produces 24-hour expiry", () => {
  it("sets exp = iat + 86400", () => {
    const token = createSessionToken({
      org: "org-1",
      key: "key-1",
      scope: "read",
    });

    const result = verifySessionTokenDetailed(token);
    expect(result.payload).not.toBeNull();
    if (!result.payload) {
      return;
    }

    expect(result.expired).toBe(false);
    expect(result.payload.exp - result.payload.iat).toBe(86_400);
  });
});

/**
 * Creates a token with exp set to `hoursAgo` hours in the past.
 * Re-signs with TEST_SECRET so the signature remains valid.
 */
function createTokenExpiredAgo(hoursAgo: number): string {
  const token = createSessionToken({
    org: "org-1",
    key: "key-1",
    scope: "read",
  });

  const parts = token.split(".");
  const header = parts[0];
  const body = JSON.parse(
    Buffer.from(
      parts[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8"),
  );

  body.exp = Math.floor(Date.now() / 1000) - hoursAgo * 60 * 60;

  const newBody = Buffer.from(JSON.stringify(body))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  // biome-ignore lint/style/noCommaOperator: re-sign requires inline import in test context
  const { createHmac } =
    require("node:crypto") as typeof import("node:crypto");
  const signingInput = `${header}.${newBody}`;
  const signature = createHmac("sha256", TEST_SECRET)
    .update(signingInput)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return `${signingInput}.${signature}`;
}

describe("verifySessionToken with expired but valid signature", () => {
  it("returns null by default for expired tokens", () => {
    const token = createTokenExpiredAgo(25);
    const result = verifySessionToken(token);
    expect(result).toBeNull();
  });

  it("returns payload with allowExpired for expired but valid signature", () => {
    const token = createTokenExpiredAgo(25);
    const result = verifySessionToken(token, { allowExpired: true });
    expect(result).not.toBeNull();
    expect(result?.org).toBe("org-1");
    expect(result?.key).toBe("key-1");
  });

  it("verifySessionTokenDetailed marks token as expired", () => {
    const token = createTokenExpiredAgo(25);
    const result = verifySessionTokenDetailed(token);
    expect(result.expired).toBe(true);
    expect(result.payload).not.toBeNull();
    expect(result.payload?.org).toBe("org-1");
  });
});

describe("renewal grace window", () => {
  it("MAX_RENEWAL_GRACE_SECONDS is 172800 (48 hours)", () => {
    expect(MAX_RENEWAL_GRACE_SECONDS).toBe(172_800);
  });

  it("accepts expired token within grace window", () => {
    const token = createTokenExpiredAgo(47);
    const result = verifySessionTokenDetailed(token);
    expect(result.expired).toBe(true);
    expect(result.payload).not.toBeNull();
  });

  it("rejects expired token beyond grace window as too_old", () => {
    const token = createTokenExpiredAgo(49);
    const result = verifySessionTokenDetailed(token);
    expect(result.payload).toBeNull();
    if (!result.payload) {
      expect(result.reason).toBe("too_old");
    }
  });

  it("verifySessionToken returns null for too_old tokens even with allowExpired", () => {
    const token = createTokenExpiredAgo(49);
    const result = verifySessionToken(token, { allowExpired: true });
    expect(result).toBeNull();
  });
});

describe("verifySessionToken rejects invalid signature", () => {
  it("returns null for tampered tokens", () => {
    const token = createSessionToken({
      org: "org-1",
      key: "key-1",
    });

    // Tamper with the signature
    const tampered = `${token.slice(0, -4)}XXXX`;
    const result = verifySessionToken(tampered, { allowExpired: true });
    expect(result).toBeNull();
  });

  it("verifySessionTokenDetailed returns invalid_signature reason", () => {
    const token = createSessionToken({
      org: "org-1",
      key: "key-1",
    });

    const tampered = `${token.slice(0, -4)}XXXX`;
    const result = verifySessionTokenDetailed(tampered);
    expect(result.payload).toBeNull();
    expect(result.expired).toBe(false);
    if (!result.payload) {
      expect(result.reason).toBe("invalid_signature");
    }
  });

  it("returns malformed for garbage input", () => {
    const result = verifySessionTokenDetailed("not-a-jwt");
    expect(result.payload).toBeNull();
    if (!result.payload) {
      expect(result.reason).toBe("malformed");
    }
  });
});
