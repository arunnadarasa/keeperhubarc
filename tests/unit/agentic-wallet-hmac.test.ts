/**
 * Wave 0 RED scaffold for lib/agentic-wallet/hmac.ts.
 *
 * Contract anchor: .planning/phases/33-provisioning-signing-apis/33-RESEARCH.md
 * Pattern 5 (lines 474-531).
 *
 *   signingString = `${method}\n${path}\n${sha256_hex(body)}\n${timestamp}`
 *   signature     = hex(hmac_sha256(secret, signingString))
 *
 * Replay window: 300 s. Required headers: X-KH-Sub-Org, X-KH-Timestamp, X-KH-Signature.
 * Baseline: every `it` block throws because the helper bodies throw
 * "not yet implemented" stubs. Plan 33-01a flips this suite GREEN.
 */
import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockLookupSecret } = vi.hoisted(() => ({
  mockLookupSecret: vi.fn<(subOrgId: string) => Promise<string | null>>(),
}));

vi.mock("@/lib/agentic-wallet/hmac-secret-store", () => ({
  lookupHmacSecret: mockLookupSecret,
}));

const { computeSignature, verifyHmacRequest } = await import(
  "@/lib/agentic-wallet/hmac"
);

const TEST_SECRET = "deadbeef";
const TEST_SUB_ORG = "subOrg_test_123";
const TEST_PATH = "/api/agentic-wallet/sign";
const FROZEN_NOW_ISO = "2026-04-21T00:00:00Z";
const FROZEN_NOW_UNIX = Math.floor(
  new Date(FROZEN_NOW_ISO).getTime() / 1000
).toString();

// REVIEW HI-05: subOrgId is bound into the signed string.
function signingString(
  method: string,
  path: string,
  subOrgId: string,
  body: string,
  ts: string
): string {
  const digest = createHash("sha256").update(body).digest("hex");
  return `${method}\n${path}\n${subOrgId}\n${digest}\n${ts}`;
}

function expectedSig(secret: string, str: string): string {
  return createHmac("sha256", secret).update(str).digest("hex");
}

function buildRequest(opts: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
}): Request {
  const method = opts.method ?? "POST";
  const path = opts.path ?? TEST_PATH;
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: opts.headers ?? {},
  });
}

describe("computeSignature", () => {
  it("returns a lowercase hex string of 64 characters (sha256 length)", () => {
    const sig = computeSignature(
      TEST_SECRET,
      "POST",
      TEST_PATH,
      TEST_SUB_ORG,
      '{"chain":"base"}',
      FROZEN_NOW_UNIX
    );
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches a node:crypto-computed HMAC-SHA256 over the signing string", () => {
    const body = '{"chain":"base"}';
    const ts = "1713600000";
    const expected = expectedSig(
      TEST_SECRET,
      signingString("POST", TEST_PATH, TEST_SUB_ORG, body, ts)
    );
    const actual = computeSignature(
      TEST_SECRET,
      "POST",
      TEST_PATH,
      TEST_SUB_ORG,
      body,
      ts
    );
    expect(actual).toBe(expected);
  });

  it("produces different signatures for different bodies (sha256 sensitivity)", () => {
    const ts = "1713600000";
    const a = computeSignature(
      TEST_SECRET,
      "POST",
      TEST_PATH,
      TEST_SUB_ORG,
      "{}",
      ts
    );
    const b = computeSignature(
      TEST_SECRET,
      "POST",
      TEST_PATH,
      TEST_SUB_ORG,
      '{"x":1}',
      ts
    );
    expect(a).not.toBe(b);
  });

  it("produces different signatures for different subOrgIds (HI-05 binding)", () => {
    const body = '{"chain":"base"}';
    const ts = "1713600000";
    const a = computeSignature(
      TEST_SECRET,
      "POST",
      TEST_PATH,
      "subOrg_A",
      body,
      ts
    );
    const b = computeSignature(
      TEST_SECRET,
      "POST",
      TEST_PATH,
      "subOrg_B",
      body,
      ts
    );
    expect(a).not.toBe(b);
  });
});

describe("verifyHmacRequest", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FROZEN_NOW_ISO));
    mockLookupSecret.mockReset();
    mockLookupSecret.mockResolvedValue(TEST_SECRET);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns ok:true with subOrgId when headers and signature match", async () => {
    const body = '{"chain":"base"}';
    const sig = expectedSig(
      TEST_SECRET,
      signingString("POST", TEST_PATH, TEST_SUB_ORG, body, FROZEN_NOW_UNIX)
    );
    const request = buildRequest({
      headers: {
        "X-KH-Sub-Org": TEST_SUB_ORG,
        "X-KH-Timestamp": FROZEN_NOW_UNIX,
        "X-KH-Signature": sig,
      },
    });
    const result = await verifyHmacRequest(request, body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subOrgId).toBe(TEST_SUB_ORG);
    }
  });

  it("returns ok:false status:401 when signature was computed with a different subOrgId (HI-05)", async () => {
    const body = '{"chain":"base"}';
    // Caller signs binding subOrg_B but sends subOrg_A in the header. Even if
    // the same secret were accepted by lookup (it isn't today, but HI-05 guards
    // the refactor), the signature must not verify.
    const sig = expectedSig(
      TEST_SECRET,
      signingString("POST", TEST_PATH, "subOrg_B", body, FROZEN_NOW_UNIX)
    );
    const request = buildRequest({
      headers: {
        "X-KH-Sub-Org": TEST_SUB_ORG,
        "X-KH-Timestamp": FROZEN_NOW_UNIX,
        "X-KH-Signature": sig,
      },
    });
    const result = await verifyHmacRequest(request, body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it("returns ok:false status:401 when X-KH-Signature header is missing", async () => {
    const body = '{"chain":"base"}';
    const request = buildRequest({
      headers: {
        "X-KH-Sub-Org": TEST_SUB_ORG,
        "X-KH-Timestamp": FROZEN_NOW_UNIX,
      },
    });
    const result = await verifyHmacRequest(request, body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it("returns ok:false status:401 when timestamp is more than 300s old", async () => {
    const body = '{"chain":"base"}';
    const staleTs = String(Number(FROZEN_NOW_UNIX) - 301);
    const sig = expectedSig(
      TEST_SECRET,
      signingString("POST", TEST_PATH, TEST_SUB_ORG, body, staleTs)
    );
    const request = buildRequest({
      headers: {
        "X-KH-Sub-Org": TEST_SUB_ORG,
        "X-KH-Timestamp": staleTs,
        "X-KH-Signature": sig,
      },
    });
    const result = await verifyHmacRequest(request, body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it("returns ok:false status:401 when timestamp is more than 300s in the future", async () => {
    const body = '{"chain":"base"}';
    const futureTs = String(Number(FROZEN_NOW_UNIX) + 301);
    const sig = expectedSig(
      TEST_SECRET,
      signingString("POST", TEST_PATH, TEST_SUB_ORG, body, futureTs)
    );
    const request = buildRequest({
      headers: {
        "X-KH-Sub-Org": TEST_SUB_ORG,
        "X-KH-Timestamp": futureTs,
        "X-KH-Signature": sig,
      },
    });
    const result = await verifyHmacRequest(request, body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it("returns ok:false status:404 when sub-org lookup returns null", async () => {
    mockLookupSecret.mockResolvedValueOnce(null);
    const body = '{"chain":"base"}';
    const sig = expectedSig(
      TEST_SECRET,
      signingString(
        "POST",
        TEST_PATH,
        "subOrg_does_not_exist",
        body,
        FROZEN_NOW_UNIX
      )
    );
    const request = buildRequest({
      headers: {
        "X-KH-Sub-Org": "subOrg_does_not_exist",
        "X-KH-Timestamp": FROZEN_NOW_UNIX,
        "X-KH-Signature": sig,
      },
    });
    const result = await verifyHmacRequest(request, body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
    }
  });

  it("returns ok:false status:401 when signature is same length but wrong bytes (timingSafeEqual path)", async () => {
    const body = '{"chain":"base"}';
    // 64 hex chars = same length as a valid sha256 HMAC, but wrong bytes.
    const wrongSig = "a".repeat(64);
    const request = buildRequest({
      headers: {
        "X-KH-Sub-Org": TEST_SUB_ORG,
        "X-KH-Timestamp": FROZEN_NOW_UNIX,
        "X-KH-Signature": wrongSig,
      },
    });
    const result = await verifyHmacRequest(request, body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it("returns ok:false status:401 when signature length differs from expected (guard clause)", async () => {
    const body = '{"chain":"base"}';
    // Wrong length — must not throw inside timingSafeEqual; guard clause trips first.
    const shortSig = "deadbeef";
    const request = buildRequest({
      headers: {
        "X-KH-Sub-Org": TEST_SUB_ORG,
        "X-KH-Timestamp": FROZEN_NOW_UNIX,
        "X-KH-Signature": shortSig,
      },
    });
    const result = await verifyHmacRequest(request, body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it("returns ok:false status:401 when X-KH-Sub-Org header is missing", async () => {
    const body = '{"chain":"base"}';
    const sig = expectedSig(
      TEST_SECRET,
      signingString("POST", TEST_PATH, TEST_SUB_ORG, body, FROZEN_NOW_UNIX)
    );
    const request = buildRequest({
      headers: {
        "X-KH-Timestamp": FROZEN_NOW_UNIX,
        "X-KH-Signature": sig,
      },
    });
    const result = await verifyHmacRequest(request, body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it("returns ok:false status:401 when X-KH-Timestamp is non-numeric garbage", async () => {
    const body = '{"chain":"base"}';
    const sig = expectedSig(
      TEST_SECRET,
      signingString("POST", TEST_PATH, TEST_SUB_ORG, body, "not-a-number")
    );
    const request = buildRequest({
      headers: {
        "X-KH-Sub-Org": TEST_SUB_ORG,
        "X-KH-Timestamp": "not-a-number",
        "X-KH-Signature": sig,
      },
    });
    const result = await verifyHmacRequest(request, body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });
});
