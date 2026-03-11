import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

const mockGetSession = vi.fn();
const mockGetActiveMember = vi.fn();

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      getActiveMember: (...args: unknown[]) => mockGetActiveMember(...args),
    },
  },
}));

const mockGetOrgSubscription = vi.fn();

vi.mock("@/keeperhub/lib/billing/plans-server", () => ({
  getOrgSubscription: (...args: unknown[]) => mockGetOrgSubscription(...args),
}));

const mockListInvoices = vi.fn();

vi.mock("@/keeperhub/lib/billing/providers", () => ({
  getBillingProvider: () => ({
    listInvoices: mockListInvoices,
  }),
}));

import { GET } from "@/keeperhub/api/billing/invoices/route";

function makeRequest(query = ""): Request {
  return new Request(`http://localhost:3000/api/billing/invoices${query}`, {
    method: "GET",
  });
}

function mockSession(overrides: Record<string, unknown> = {}): void {
  mockGetSession.mockResolvedValue({
    user: { id: "usr_1", email: "user@test.com" },
    session: { activeOrganizationId: "org_1" },
    ...overrides,
  });
  mockGetActiveMember.mockResolvedValue({ role: "owner" });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_BILLING_ENABLED = "true";
});

describe("GET /api/billing/invoices", () => {
  it("returns invoices for org owner", async () => {
    mockSession();
    mockGetOrgSubscription.mockResolvedValue({
      providerCustomerId: "cus_1",
    });
    mockListInvoices.mockResolvedValue({
      invoices: [{ id: "inv_1" }],
      hasMore: false,
    });

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.invoices).toHaveLength(1);
  });

  it("returns 401 without auth", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
  });

  it("returns 400 without active org", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "usr_1", email: "user@test.com" },
      session: { activeOrganizationId: null },
    });

    const response = await GET(makeRequest());

    expect(response.status).toBe(400);
  });

  it("returns 403 for non-owner role", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "usr_1", email: "user@test.com" },
      session: { activeOrganizationId: "org_1" },
    });
    mockGetActiveMember.mockResolvedValue({ role: "member" });

    const response = await GET(makeRequest());

    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json.error).toBe("Only organization owners can manage billing");
  });

  it("returns 403 when activeMember is null", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "usr_1", email: "user@test.com" },
      session: { activeOrganizationId: "org_1" },
    });
    mockGetActiveMember.mockResolvedValue(null);

    const response = await GET(makeRequest());

    expect(response.status).toBe(403);
  });

  it("returns empty invoices when no customer ID", async () => {
    mockSession();
    mockGetOrgSubscription.mockResolvedValue({
      providerCustomerId: null,
    });

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.invoices).toEqual([]);
    expect(json.hasMore).toBe(false);
  });

  it("returns 404 when billing is disabled", async () => {
    process.env.NEXT_PUBLIC_BILLING_ENABLED = "false";

    const response = await GET(makeRequest());

    expect(response.status).toBe(404);
  });
});
