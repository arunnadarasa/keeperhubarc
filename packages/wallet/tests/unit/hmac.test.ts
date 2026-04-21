import { describe, expect, it } from "vitest";
import { computeSignature as serverCompute } from "../../../../lib/agentic-wallet/hmac.js";
import { buildHmacHeaders, computeSignature } from "../../src/hmac.js";

const SIG_HEX_64 = /^[0-9a-f]{64}$/;

describe("hmac.ts (client mirror)", () => {
  it("computeSignature returns a 64-char lowercase hex string", () => {
    const sig = computeSignature(
      "supersecret",
      "POST",
      "/api/agentic-wallet/sign",
      "so_abc",
      '{"x":1}',
      "1714652400"
    );
    expect(sig).toMatch(SIG_HEX_64);
  });

  it("client signature matches server signature byte-for-byte", () => {
    const secret = "supersecret";
    const method = "POST";
    const path = "/api/agentic-wallet/sign";
    const subOrgId = "so_abc";
    const body = '{"x":1}';
    const timestamp = "1714652400";
    const client = computeSignature(
      secret,
      method,
      path,
      subOrgId,
      body,
      timestamp
    );
    const server = serverCompute(
      secret,
      method,
      path,
      subOrgId,
      body,
      timestamp
    );
    expect(client).toBe(server);
  });

  it("buildHmacHeaders emits the three X-KH-* headers with 64-hex signature", () => {
    const h = buildHmacHeaders(
      "supersecret",
      "POST",
      "/api/agentic-wallet/sign",
      "so_abc",
      "{}"
    );
    expect(h["X-KH-Sub-Org"]).toBe("so_abc");
    expect(Number.parseInt(h["X-KH-Timestamp"], 10)).toBeGreaterThan(
      1_700_000_000
    );
    expect(h["X-KH-Signature"]).toMatch(SIG_HEX_64);
  });
});
