import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { logMcpEvent } from "@/lib/mcp/logging";

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

type SessionEntry = {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  organizationId: string;
  apiKeyId: string;
  scope?: string;
  createdAt: number;
  lastActivity: number;
};

const sessions = new Map<string, SessionEntry>();

const CLEANUP_KEY = Symbol.for("keeperhub-mcp-cleanup-timer");

type GlobalThisWithTimer = typeof globalThis & Record<symbol, unknown>;

function getGlobalTimer(): ReturnType<typeof setInterval> | null {
  const g = globalThis as GlobalThisWithTimer;
  return (g[CLEANUP_KEY] as ReturnType<typeof setInterval> | null) ?? null;
}

function setGlobalTimer(timer: ReturnType<typeof setInterval> | null): void {
  const g = globalThis as GlobalThisWithTimer;
  g[CLEANUP_KEY] = timer;
}

export function getSession(sessionId: string): SessionEntry | undefined {
  return sessions.get(sessionId);
}

export function setSession(sessionId: string, entry: SessionEntry): void {
  sessions.set(sessionId, entry);
  logMcpEvent("mcp.session.created", {
    sessionId,
    orgId: entry.organizationId,
  });
}

export function deleteSession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  sessions.delete(sessionId);
  logMcpEvent("mcp.session.terminated", {
    sessionId,
    orgId: entry?.organizationId,
  });
}

export function touchSession(sessionId: string): void {
  const entry = sessions.get(sessionId);
  if (entry) {
    entry.lastActivity = Date.now();
  }
}

export function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [sessionId, entry] of sessions) {
    if (now - entry.lastActivity > SESSION_TTL_MS) {
      entry.server.close().catch(() => undefined);
      entry.transport.close().catch(() => undefined);
      sessions.delete(sessionId);
      logMcpEvent("mcp.session.expired", {
        sessionId,
        orgId: entry.organizationId,
      });
    }
  }
}

export function getSessionCount(): number {
  return sessions.size;
}

export function startCleanupInterval(): void {
  const existing = getGlobalTimer();
  if (existing !== null) {
    clearInterval(existing);
  }
  const timer = setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS);
  if (timer && typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }
  setGlobalTimer(timer);
}

export function stopCleanupInterval(): void {
  const timer = getGlobalTimer();
  if (timer !== null) {
    clearInterval(timer);
    setGlobalTimer(null);
  }
}
