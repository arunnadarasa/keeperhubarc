import { beforeEach, describe, expect, it } from "vitest";
import {
  authenticateAdmin,
  validateTestEmail,
} from "@/keeperhub/lib/admin-auth";

const TEST_KEY = "kha_test-secret-key-12345";

function createRequest(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token !== undefined) {
    headers.Authorization = token;
  }
  return new Request("http://localhost:3000/api/admin/test/otp", { headers });
}

describe("authenticateAdmin", () => {
  beforeEach(() => {
    // biome-ignore lint/performance/noDelete: delete is required to remove env vars (undefined assignment coerces to string)
    delete process.env.TEST_API_KEY;
  });

  it("should reject when TEST_API_KEY is not configured", () => {
    const result = authenticateAdmin(createRequest(`Bearer ${TEST_KEY}`));
    expect(result).toEqual({
      authenticated: false,
      error: "Admin API not configured",
    });
  });

  it("should reject when Authorization header is missing", () => {
    process.env.TEST_API_KEY = TEST_KEY;
    const result = authenticateAdmin(createRequest());
    expect(result).toEqual({
      authenticated: false,
      error: "Missing or invalid Authorization header",
    });
  });

  it("should reject non-Bearer auth scheme", () => {
    process.env.TEST_API_KEY = TEST_KEY;
    const result = authenticateAdmin(createRequest("Basic dXNlcjpwYXNz"));
    expect(result).toEqual({
      authenticated: false,
      error: "Missing or invalid Authorization header",
    });
  });

  it("should reject wrong key", () => {
    process.env.TEST_API_KEY = TEST_KEY;
    const result = authenticateAdmin(createRequest("Bearer wrong-key"));
    expect(result).toEqual({
      authenticated: false,
      error: "Invalid admin API key",
    });
  });

  it("should reject key with different length", () => {
    process.env.TEST_API_KEY = TEST_KEY;
    const result = authenticateAdmin(createRequest("Bearer short"));
    expect(result).toEqual({
      authenticated: false,
      error: "Invalid admin API key",
    });
  });

  it("should accept correct key", () => {
    process.env.TEST_API_KEY = TEST_KEY;
    const result = authenticateAdmin(createRequest(`Bearer ${TEST_KEY}`));
    expect(result).toEqual({ authenticated: true });
  });
});

describe("validateTestEmail", () => {
  it("should accept @techops.services emails", () => {
    expect(validateTestEmail("user@techops.services")).toBeNull();
    expect(validateTestEmail("test+signup@techops.services")).toBeNull();
  });

  it("should reject non-techops emails", () => {
    expect(validateTestEmail("user@gmail.com")).toBe(
      "Email must end with @techops.services"
    );
  });

  it("should reject empty string", () => {
    expect(validateTestEmail("")).toBe("Email must end with @techops.services");
  });
});
