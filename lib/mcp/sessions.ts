import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

type SessionEntry = {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  organizationId: string;
  apiKeyId: string;
  createdAt: number;
  lastActivity: number;
};

const sessions = new Map<string, SessionEntry>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function getSession(sessionId: string): SessionEntry | undefined {
  return sessions.get(sessionId);
}

export function setSession(sessionId: string, entry: SessionEntry): void {
  sessions.set(sessionId, entry);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
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
      entry.transport.close().catch(() => {
        // Ignore close errors during cleanup
      });
      sessions.delete(sessionId);
    }
  }
}

export function getSessionCount(): number {
  return sessions.size;
}

export function startCleanupInterval(): void {
  if (cleanupTimer !== null) {
    return;
  }
  cleanupTimer = setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS);
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

export function stopCleanupInterval(): void {
  if (cleanupTimer !== null) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
