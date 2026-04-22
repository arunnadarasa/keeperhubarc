import crypto from "node:crypto";
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

const mockGetActiveOrgId = vi.fn();

vi.mock("@/lib/middleware/org-context", () => ({
  getActiveOrgId: (...args: unknown[]) => mockGetActiveOrgId(...args),
}));

const mockSendEmail = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

const mockWalletSelectLimit = vi.fn();
const mockCodeSelectLimit = vi.fn();
const mockDelete = vi.fn();
const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockUpdateSetWhere = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => ({
        where: vi.fn(() => ({
          limit: (n: number) =>
            table === "key_export_codes_table"
              ? mockCodeSelectLimit(n)
              : mockWalletSelectLimit(n),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: (...args: unknown[]) => mockDelete(...args),
    })),
    insert: vi.fn(() => ({
      values: (...args: unknown[]) => mockInsertValues(...args),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: (...args: unknown[]) => mockUpdateSetWhere(...args),
      })),
    })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  organizationWallets: {
    id: "id",
    userId: "user_id",
    email: "email",
    organizationId: "organization_id",
    provider: "provider",
  },
  keyExportCodes: "key_export_codes_table",
}));

const mockExportTurnkeyPrivateKey = vi.fn();

vi.mock("@/lib/turnkey/turnkey-client", () => ({
  exportTurnkeyPrivateKey: (...args: unknown[]) =>
    mockExportTurnkeyPrivateKey(...args),
}));

vi.mock("@/lib/logging", () => ({
  ErrorCategory: { EXTERNAL_SERVICE: "EXTERNAL_SERVICE" },
  logSystemError: vi.fn(),
}));

import { POST as requestPost } from "@/app/api/user/wallet/export-key/request/route";
import { POST as verifyPost } from "@/app/api/user/wallet/export-key/verify/route";

const CREATOR_ID = "user-creator";
const OTHER_ADMIN_ID = "user-other-admin";
const ORG_ID = "org-1";
const WALLET_EMAIL = "vault@example.com";

function mockCreatorSession(): void {
  mockGetSession.mockResolvedValue({
    user: { id: CREATOR_ID, email: "creator@account.com" },
    session: { activeOrganizationId: ORG_ID },
  });
  mockGetActiveOrgId.mockReturnValue(ORG_ID);
  mockGetActiveMember.mockResolvedValue({ role: "owner" });
}

function mockOtherAdminSession(): void {
  mockGetSession.mockResolvedValue({
    user: { id: OTHER_ADMIN_ID, email: "other@account.com" },
    session: { activeOrganizationId: ORG_ID },
  });
  mockGetActiveOrgId.mockReturnValue(ORG_ID);
  mockGetActiveMember.mockResolvedValue({ role: "admin" });
}

function createJsonRequest(body?: Record<string, unknown>): Request {
  return new Request("http://localhost/api/user/wallet/export-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/user/wallet/export-key/request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWalletSelectLimit.mockReset();
    mockSendEmail.mockClear();
  });

  it("returns 401 when no session", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await requestPost(createJsonRequest());
    expect(res.status).toBe(401);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns 403 when user is not a member of the active org", async () => {
    mockCreatorSession();
    mockGetActiveMember.mockResolvedValueOnce(null);

    const res = await requestPost(createJsonRequest());
    expect(res.status).toBe(403);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns 403 when session user is not the wallet creator", async () => {
    mockOtherAdminSession();
    mockWalletSelectLimit.mockResolvedValueOnce([
      { id: "wallet-1", userId: CREATOR_ID, email: WALLET_EMAIL },
    ]);

    const res = await requestPost(createJsonRequest());
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe(
      "Only the wallet creator can export its private key"
    );
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends OTP to wallet recovery email (not session email) for the creator", async () => {
    mockCreatorSession();
    mockWalletSelectLimit.mockResolvedValueOnce([
      { id: "wallet-1", userId: CREATOR_ID, email: WALLET_EMAIL },
    ]);

    const res = await requestPost(createJsonRequest());
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data).toEqual({ sent: true, email: WALLET_EMAIL });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const emailArgs = mockSendEmail.mock.calls[0][0] as { to: string };
    expect(emailArgs.to).toBe(WALLET_EMAIL);
    expect(emailArgs.to).not.toBe("creator@account.com");
  });
});

describe("POST /api/user/wallet/export-key/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWalletSelectLimit.mockReset();
    mockCodeSelectLimit.mockReset();
    mockExportTurnkeyPrivateKey.mockReset();
  });

  it("returns 403 when session user is not the wallet creator", async () => {
    mockOtherAdminSession();

    const code = "123456";
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    mockCodeSelectLimit.mockResolvedValueOnce([
      {
        id: "code-1",
        organizationId: ORG_ID,
        codeHash,
        attempts: 0,
        expiresAt: new Date(Date.now() + 60_000),
      },
    ]);
    mockWalletSelectLimit.mockResolvedValueOnce([
      {
        id: "wallet-1",
        userId: CREATOR_ID,
        email: WALLET_EMAIL,
        provider: "turnkey",
        turnkeySubOrgId: "sub-org-1",
        walletAddress: "0x0000000000000000000000000000000000000001",
      },
    ]);

    const res = await verifyPost(createJsonRequest({ code }));

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe(
      "Only the wallet creator can export its private key"
    );
    expect(mockExportTurnkeyPrivateKey).not.toHaveBeenCalled();
  });
});
