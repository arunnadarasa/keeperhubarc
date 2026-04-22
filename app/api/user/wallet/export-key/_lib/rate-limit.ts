// Per-user in-memory rate limiter for wallet export endpoints. Per pod, so
// the effective limit is LIMIT * num_replicas; acceptable at current replica
// count. Redis-backed is a project-wide decision (see the same caveat on
// app/api/execute/_lib/rate-limit.ts).

type Bucket = { limit: number; windowMs: number };

const REQUEST_BUCKET: Bucket = { limit: 3, windowMs: 5 * 60_000 };
const VERIFY_BUCKET: Bucket = { limit: 10, windowMs: 5 * 60_000 };

const requestLog = new Map<string, number[]>();
const verifyLog = new Map<string, number[]>();

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfter: number };

function check(
  store: Map<string, number[]>,
  bucket: Bucket,
  key: string
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - bucket.windowMs;

  const timestamps = store.get(key);
  const recent = timestamps ? timestamps.filter((t) => t > windowStart) : [];

  if (recent.length >= bucket.limit) {
    const oldestInWindow = recent[0];
    const retryAfter = Math.ceil(
      (oldestInWindow + bucket.windowMs - now) / 1000
    );
    return { allowed: false, retryAfter: Math.max(retryAfter, 1) };
  }

  recent.push(now);
  store.set(key, recent);
  return { allowed: true };
}

export function checkRequestRateLimit(userId: string): RateLimitResult {
  return check(requestLog, REQUEST_BUCKET, userId);
}

export function checkVerifyRateLimit(userId: string): RateLimitResult {
  return check(verifyLog, VERIFY_BUCKET, userId);
}
