import { Redis } from "ioredis";
import {
  REDIS_HOST,
  REDIS_PASSWORD,
  REDIS_PORT,
} from "../../lib/config/environment";
import { DEDUP_TTL_SECONDS, type DedupStore, buildDedupKey } from "./dedup";

/**
 * Redis-backed DedupStore. Split from dedup.ts so that registry.ts can
 * depend on the `DedupStore` interface without pulling ioredis into test
 * environments that do not have it installed. Phase 5 replaces this with a
 * Postgres-backed implementation; the factory swap happens in `factory.ts`.
 */

export class RedisDedupStore implements DedupStore {
  constructor(private readonly redis: Redis) {}

  async isProcessed(workflowId: string, txHash: string): Promise<boolean> {
    return (await this.redis.exists(buildDedupKey(workflowId, txHash))) === 1;
  }

  async markProcessed(workflowId: string, txHash: string): Promise<void> {
    await this.redis.set(
      buildDedupKey(workflowId, txHash),
      "1",
      "EX",
      DEDUP_TTL_SECONDS,
    );
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

export function createRedisDedupStore(): RedisDedupStore {
  const redis = new Redis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    ...(REDIS_PASSWORD && { password: REDIS_PASSWORD }),
  });
  return new RedisDedupStore(redis);
}
