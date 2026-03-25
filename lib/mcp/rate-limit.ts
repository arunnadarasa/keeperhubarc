// In-memory per pod. In a multi-replica deployment, each pod tracks its own window.
// Effective limit is LIMIT * num_replicas. Replace with Redis-backed solution
// when replica count grows.

const WINDOW_MS = 60_000; // 1 minute
const LIMIT = 120; // requests per window (higher than execute endpoint; MCP sessions are chatty)

const requestLog = new Map<string, number[]>();

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfter: number };

export function checkMcpRateLimit(organizationId: string): RateLimitResult {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const timestamps = requestLog.get(organizationId);
  const recent = timestamps ? timestamps.filter((t) => t > windowStart) : [];

  if (recent.length >= LIMIT) {
    // Oldest timestamp in window determines when the first slot opens
    const oldestInWindow = recent[0];
    const retryAfter = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
  }

  recent.push(now);
  requestLog.set(organizationId, recent);

  return { allowed: true };
}
