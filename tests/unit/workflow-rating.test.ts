/**
 * Unit tests for workflow rating API route
 *
 * Tests auth, validation, and anonymous user rejection.
 * Happy-path DB interactions are covered by integration tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock auth
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

// Mock database - return empty arrays by default (no duplication found)
vi.mock("@/lib/db", () => {
  const chainable = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    groupBy: vi.fn().mockResolvedValue([{ avg: null, count: 0 }]),
  };
  return {
    db: {
      select: vi.fn().mockReturnValue(chainable),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    },
  };
});

vi.mock("@/lib/api-error", () => ({
  apiError: vi.fn((_error: unknown, context: string) => {
    const { NextResponse: NR } = require("next/server");
    return NR.json({ error: context }, { status: 500 });
  }),
}));

import { DELETE, POST } from "@/app/api/workflows/[workflowId]/rate/route";
import { auth } from "@/lib/auth";

const mockGetSession = auth.api.getSession as unknown as ReturnType<
  typeof vi.fn
>;

function makeRequest(body?: Record<string, unknown>): Request {
  return new Request("http://localhost/api/workflows/wf_123/rate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeParams(workflowId = "wf_123"): {
  params: Promise<{ workflowId: string }>;
} {
  return { params: Promise.resolve({ workflowId }) };
}

const mockUser = {
  id: "user_123",
  email: "test@example.com",
  name: "Test User",
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockSession = {
  id: "session_123",
  createdAt: new Date(),
  updatedAt: new Date(),
  userId: "user_123",
  expiresAt: new Date(Date.now() + 86_400_000),
  token: "test-token",
  user: mockUser,
};

describe("POST /api/workflows/[workflowId]/rate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await POST(makeRequest({ rating: 4 }), makeParams());
    expect(response.status).toBe(401);
  });

  it("returns 403 for anonymous users with temp email", async () => {
    mockGetSession.mockResolvedValue({
      ...mockSession,
      user: { ...mockUser, email: "temp-abc123@example.com" },
    });

    const response = await POST(makeRequest({ rating: 4 }), makeParams());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain("Sign in with a real account");
  });

  it("returns 403 for anonymous users with http email", async () => {
    mockGetSession.mockResolvedValue({
      ...mockSession,
      user: { ...mockUser, email: "anon@http://localhost" },
    });

    const response = await POST(makeRequest({ rating: 4 }), makeParams());
    expect(response.status).toBe(403);
  });

  it("returns 400 for missing rating", async () => {
    mockGetSession.mockResolvedValue(mockSession);

    const response = await POST(makeRequest({}), makeParams());
    expect(response.status).toBe(400);
  });

  it("returns 400 for rating below minimum", async () => {
    mockGetSession.mockResolvedValue(mockSession);

    const response = await POST(makeRequest({ rating: 0 }), makeParams());
    expect(response.status).toBe(400);
  });

  it("returns 400 for rating above maximum", async () => {
    mockGetSession.mockResolvedValue(mockSession);

    const response = await POST(makeRequest({ rating: 6 }), makeParams());
    expect(response.status).toBe(400);
  });

  it("returns 400 for non-half-star increment", async () => {
    mockGetSession.mockResolvedValue(mockSession);

    const response = await POST(makeRequest({ rating: 1.3 }), makeParams());
    expect(response.status).toBe(400);
  });

  it("returns 403 when user has not duplicated the workflow", async () => {
    mockGetSession.mockResolvedValue(mockSession);
    // Default mock returns [] for limit() = no duplication found

    const response = await POST(makeRequest({ rating: 3 }), makeParams());
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toContain("must use this template");
  });
});

describe("DELETE /api/workflows/[workflowId]/rate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const request = new Request("http://localhost/api/workflows/wf_123/rate", {
      method: "DELETE",
    });
    const response = await DELETE(request, makeParams());

    expect(response.status).toBe(401);
  });
});
