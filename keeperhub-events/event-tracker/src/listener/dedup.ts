/**
 * Transaction dedup store used by EventListener to avoid forwarding the same
 * on-chain event twice (across reconnects, reorg replay, and pod restarts).
 *
 * Kept behind an interface so Phase 5 can swap the Redis-backed
 * implementation for a Postgres-backed one without touching the listener
 * code. A single dedup instance is shared across every listener in a
 * process, replacing the one-connection-per-workflow pattern from the fork
 * model.
 *
 * This semantic is best-effort by design: `markProcessed` has a 24h TTL
 * (Redis impl) and individual failures must not stop event forwarding
 * (the downstream workflow executor is the idempotency authority).
 *
 * Deliberately contains no value imports: this module is loaded by
 * registry.ts, and registry's unit tests run in environments that do not
 * have `ioredis` installed (main-app workspace). The Redis-backed
 * implementation lives in `dedup-redis.ts` and is only loaded at runtime
 * through `factory.ts`.
 */

export interface DedupStore {
  isProcessed(workflowId: string, txHash: string): Promise<boolean>;
  markProcessed(workflowId: string, txHash: string): Promise<void>;
  disconnect(): Promise<void>;
}
