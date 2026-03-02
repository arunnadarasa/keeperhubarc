import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockAuthResult = {
  authenticated: true,
  service: "scheduler" as const,
};
vi.mock("@/keeperhub/lib/internal-service-auth", () => ({
  authenticateInternalService: vi.fn(() => mockAuthResult),
}));

let mockActiveExecutionIds: { executionId: string }[] = [];
let mockReapedRows: { id: string }[] = [];
const mockUpdateReturning = vi.fn(() => mockReapedRows);
const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }));
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          groupBy: vi.fn(() => mockActiveExecutionIds),
        })),
      })),
    })),
    update: vi.fn(() => ({ set: mockUpdateSet })),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  workflowExecutions: {
    id: "id",
    workflowId: "workflow_id",
    startedAt: "started_at",
    status: "status",
    completedAt: "completed_at",
    error: "error",
    duration: "duration",
  },
  workflowExecutionLogs: {
    executionId: "execution_id",
    completedAt: "completed_at",
  },
}));

import { GET } from "@/keeperhub/api/internal/reaper/route";
import { authenticateInternalService } from "@/keeperhub/lib/internal-service-auth";

function createRequest(): Request {
  return new Request("http://localhost:3000/api/internal/reaper", {
    headers: { "X-Service-Key": "test-key" },
  });
}

describe("/api/internal/reaper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveExecutionIds = [];
    mockReapedRows = [];
    mockAuthResult.authenticated = true;
  });

  afterEach(() => {
    process.env.STALE_EXECUTION_THRESHOLD_MINUTES = undefined;
  });

  it("returns 401 when not authenticated", async () => {
    mockAuthResult.authenticated = false;

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBeDefined();
  });

  it("returns empty result when no stale executions exist", async () => {
    mockReapedRows = [];

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.reapedCount).toBe(0);
    expect(data.reapedIds).toEqual([]);
  });

  it("reaps stale executions and returns their IDs", async () => {
    mockReapedRows = [{ id: "exec_1" }];

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.reapedCount).toBe(1);
    expect(data.reapedIds).toEqual(["exec_1"]);
  });

  it("sets error status and timeout message on reaped executions", async () => {
    mockReapedRows = [{ id: "exec_1" }];

    await GET(createRequest());

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        error: expect.stringContaining("timed out"),
        completedAt: expect.any(Date),
      })
    );
  });

  it("sets duration on reaped executions", async () => {
    mockReapedRows = [{ id: "exec_1" }];

    await GET(createRequest());

    const calls = mockUpdateSet.mock.calls as unknown[][];
    const setArg = calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(setArg?.duration).toBeDefined();
  });

  it("excludes executions with recent step activity", async () => {
    mockActiveExecutionIds = [{ executionId: "exec_active" }];
    mockReapedRows = [];

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.reapedCount).toBe(0);
  });

  it("reaps multiple stale executions in a single query", async () => {
    mockReapedRows = [{ id: "exec_1" }, { id: "exec_2" }, { id: "exec_3" }];

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.reapedCount).toBe(3);
    expect(data.reapedIds).toEqual(["exec_1", "exec_2", "exec_3"]);
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
  });

  it("uses configurable threshold from env var", async () => {
    process.env.STALE_EXECUTION_THRESHOLD_MINUTES = "60";
    mockReapedRows = [{ id: "exec_1" }];

    await GET(createRequest());

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining("60 minutes"),
      })
    );
  });

  it("calls authenticateInternalService with the request", async () => {
    const request = createRequest();
    await GET(request);

    expect(authenticateInternalService).toHaveBeenCalledWith(request);
  });
});
