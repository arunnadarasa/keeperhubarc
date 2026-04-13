import { describe, expect, it, vi } from "vitest";

vi.mock("@x402/next", () => ({ withX402: vi.fn() }));
vi.mock("@/lib/x402/payment-gate", () => ({
  buildPaymentConfig: vi.fn(),
  extractPayerAddress: vi.fn(),
  findExistingPayment: vi.fn(),
  hashPaymentSignature: vi.fn(),
}));
vi.mock("@/lib/x402/server", () => ({ server: {} }));
vi.mock("@/lib/x402/reconcile", () => ({
  isTimeoutError: vi.fn(),
  pollForPaymentConfirmation: vi.fn(),
}));
vi.mock("@/lib/mpp/server", () => ({
  extractMppPayerAddress: vi.fn(),
  hashMppCredential: vi.fn(),
  getMppServer: vi.fn(),
}));

import { buildDual402Response, detectProtocol } from "@/lib/payments/router";

describe("detectProtocol", () => {
  it("returns 'mpp' when Authorization: Payment header is present", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Payment eyJjaGFsbGVuZ2UiOnt9fQ" },
    });
    expect(detectProtocol(req)).toBe("mpp");
  });

  it("returns 'x402' when PAYMENT-SIGNATURE header is present", () => {
    const req = new Request("http://localhost", {
      headers: { "PAYMENT-SIGNATURE": "base64sig" },
    });
    expect(detectProtocol(req)).toBe("x402");
  });

  it("returns null when no payment headers are present", () => {
    const req = new Request("http://localhost");
    expect(detectProtocol(req)).toBeNull();
  });

  it("returns 'error' when both headers are present", () => {
    const req = new Request("http://localhost", {
      headers: {
        Authorization: "Payment eyJ...",
        "PAYMENT-SIGNATURE": "base64sig",
      },
    });
    expect(detectProtocol(req)).toBe("error");
  });

  it("ignores Authorization headers that are not Payment scheme", () => {
    const req = new Request("http://localhost", {
      headers: { Authorization: "Bearer token123" },
    });
    expect(detectProtocol(req)).toBeNull();
  });
});

describe("buildDual402Response", () => {
  it("returns a 402 response", () => {
    const response = buildDual402Response({
      price: "0.01",
      creatorWalletAddress: "0xCreator",
      workflowName: "Test Workflow",
    });
    expect(response.status).toBe(402);
  });

  it("includes CORS headers", () => {
    const response = buildDual402Response({
      price: "0.01",
      creatorWalletAddress: "0xCreator",
      workflowName: "Test Workflow",
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
