import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mockAuthResult = {
  authenticated: true,
  service: "scheduler" as const,
};
vi.mock("@/keeperhub/lib/internal-service-auth", () => ({
  authenticateInternalService: vi.fn(() => mockAuthResult),
}));

let mockStaleExecutions: { id: string; workflowId: string; startedAt: Date }[] =
  [];
let mockLastLog: { completedAt: Date | null }[] = [];
const mockUpdateWhere = vi.fn();
const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
let selectCallCount = 0;

vi.mock("@/lib/db", () => {
  // The reaper calls db.select() twice per stale execution:
  // 1st: select().from(workflowExecutions).where() -> stale executions list
  // 2nd+: select().from(workflowExecutionLogs).where().orderBy().limit() -> last log
  const selectFn = vi.fn(() => {
    const callIndex = selectCallCount++;
    if (callIndex === 0) {
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => mockStaleExecutions),
        })),
      };
    }
    return {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => mockLastLog),
          })),
        })),
      })),
    };
  });

  return {
    db: {
      select: selectFn,
      update: vi.fn(() => ({ set: mockUpdateSet })),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  workflowExecutions: {
    id: "id",
    workflowId: "workflow_id",
    startedAt: "started_at",
    status: "status",
    completedAt: "completed_at",
    error: "error",
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
    mockStaleExecutions = [];
    mockLastLog = [];
    selectCallCount = 0;
    mockAuthResult.authenticated = true;
  });

  it("returns 401 when not authenticated", async () => {
    mockAuthResult.authenticated = false;

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBeDefined();
  });

  it("returns empty result when no stale executions exist", async () => {
    mockStaleExecutions = [];

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.reapedCount).toBe(0);
    expect(data.reapedIds).toEqual([]);
  });

  it("reaps executions with no step activity", async () => {
    const oldDate = new Date(Date.now() - 60 * 60 * 1000);
    mockStaleExecutions = [
      { id: "exec_1", workflowId: "wf_1", startedAt: oldDate },
    ];
    mockLastLog = [];

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.reapedCount).toBe(1);
    expect(data.reapedIds).toEqual(["exec_1"]);
    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        error: expect.stringContaining("timed out"),
      })
    );
  });

  it("skips executions with recent step activity", async () => {
    const oldDate = new Date(Date.now() - 60 * 60 * 1000);
    mockStaleExecutions = [
      { id: "exec_1", workflowId: "wf_1", startedAt: oldDate },
    ];
    mockLastLog = [{ completedAt: new Date(Date.now() - 5 * 60 * 1000) }];

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.reapedCount).toBe(0);
    expect(data.reapedIds).toEqual([]);
    expect(mockUpdateWhere).not.toHaveBeenCalled();
  });

  it("reaps multiple stale executions", async () => {
    const oldDate = new Date(Date.now() - 60 * 60 * 1000);
    mockStaleExecutions = [
      { id: "exec_1", workflowId: "wf_1", startedAt: oldDate },
      { id: "exec_2", workflowId: "wf_2", startedAt: oldDate },
    ];
    mockLastLog = [];

    const response = await GET(createRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.reapedCount).toBe(2);
    expect(data.reapedIds).toContain("exec_1");
    expect(data.reapedIds).toContain("exec_2");
  });

  it("uses configurable threshold from env var", async () => {
    process.env.STALE_EXECUTION_THRESHOLD_MINUTES = "60";
    mockStaleExecutions = [];

    const response = await GET(createRequest());
    expect(response.status).toBe(200);

    process.env.STALE_EXECUTION_THRESHOLD_MINUTES = undefined;
  });

  it("calls authenticateInternalService with the request", async () => {
    const request = createRequest();
    await GET(request);

    expect(authenticateInternalService).toHaveBeenCalledWith(request);
  });
});
