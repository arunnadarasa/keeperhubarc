import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuthenticateApiKey, mockGetSession, mockGetOrgContext } =
  vi.hoisted(() => ({
    mockAuthenticateApiKey: vi.fn(),
    mockGetSession: vi.fn(),
    mockGetOrgContext: vi.fn(),
  }));

vi.mock("@/keeperhub/lib/api-key-auth", () => ({
  authenticateApiKey: mockAuthenticateApiKey,
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

vi.mock("@/keeperhub/lib/middleware/org-context", () => ({
  getOrgContext: mockGetOrgContext,
}));

import { getDualAuthContext } from "@/keeperhub/lib/middleware/auth-helpers";

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/test", {
    headers: new Headers(headers),
  });
}

describe("getDualAuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("API key authentication", () => {
    it("returns userId and organizationId from API key", async () => {
      mockAuthenticateApiKey.mockResolvedValue({
        authenticated: true,
        organizationId: "org_123",
        userId: "user_creator",
      });

      const result = await getDualAuthContext(
        makeRequest({ Authorization: "Bearer kh_test" })
      );

      expect(result).toEqual({
        userId: "user_creator",
        organizationId: "org_123",
      });
      expect(mockGetSession).not.toHaveBeenCalled();
    });

    it("returns null userId when API key has no creator", async () => {
      mockAuthenticateApiKey.mockResolvedValue({
        authenticated: true,
        organizationId: "org_123",
      });

      const result = await getDualAuthContext(makeRequest());

      expect(result).toEqual({
        userId: null,
        organizationId: "org_123",
      });
    });
  });

  describe("session authentication", () => {
    beforeEach(() => {
      mockAuthenticateApiKey.mockResolvedValue({ authenticated: false });
    });

    it("returns userId and organizationId from session", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user_session" },
      });
      mockGetOrgContext.mockResolvedValue({
        organization: { id: "org_session" },
      });

      const result = await getDualAuthContext(makeRequest());

      expect(result).toEqual({
        userId: "user_session",
        organizationId: "org_session",
      });
    });

    it("returns null organizationId when user has no org", async () => {
      mockGetSession.mockResolvedValue({
        user: { id: "user_no_org" },
      });
      mockGetOrgContext.mockResolvedValue({ organization: null });

      const result = await getDualAuthContext(makeRequest());

      expect(result).toEqual({
        userId: "user_no_org",
        organizationId: null,
      });
    });
  });

  describe("no authentication", () => {
    beforeEach(() => {
      mockAuthenticateApiKey.mockResolvedValue({ authenticated: false });
      mockGetSession.mockResolvedValue(null);
    });

    it("returns 401 error when required (default)", async () => {
      const result = await getDualAuthContext(makeRequest());

      expect(result).toEqual({ error: "Unauthorized", status: 401 });
    });

    it("returns null values when not required", async () => {
      const result = await getDualAuthContext(makeRequest(), {
        required: false,
      });

      expect(result).toEqual({
        userId: null,
        organizationId: null,
      });
    });
  });

  describe("auth priority", () => {
    it("prefers API key over session when both present", async () => {
      mockAuthenticateApiKey.mockResolvedValue({
        authenticated: true,
        organizationId: "org_apikey",
        userId: "user_apikey",
      });
      mockGetSession.mockResolvedValue({
        user: { id: "user_session" },
      });

      const result = await getDualAuthContext(makeRequest());

      expect(result).toEqual({
        userId: "user_apikey",
        organizationId: "org_apikey",
      });
      expect(mockGetSession).not.toHaveBeenCalled();
    });
  });
});
