import type { SQSClient } from "@aws-sdk/client-sqs";
import { logger } from "../../lib/utils/logger";
import type { ChainProviderManager } from "../chains/provider-manager";
import type { AbiEvent } from "../chains/validation";
import type { DedupStore } from "./dedup";
import { EventListener } from "./event-listener";

/**
 * In-process registry of EventListener instances, keyed by workflow ID.
 * The Phase 4 reconciler will diff the active workflow list against this
 * registry and call add/remove to converge.
 *
 * All listeners share the same ChainProviderManager (one WSS per chain)
 * and the same DedupStore (one Redis client instead of per-workflow).
 *
 * Deliberately does not import the concrete `RedisDedupStore` factory so
 * that this module can be loaded by unit tests without requiring `ioredis`
 * at the test runtime. Production wiring of the factory lives in
 * `factory.ts`.
 */

export interface WorkflowRegistration {
  workflowId: string;
  userId: string;
  workflowName: string;
  chainId: number;
  wssUrl: string;
  contractAddress: string;
  eventName: string;
  eventsAbiStrings: string[];
  rawEventsAbi: AbiEvent[];
}

export interface RegistryDeps {
  providerManager: ChainProviderManager;
  dedup: DedupStore;
  sqs: SQSClient;
  sqsQueueUrl: string;
}

export class ListenerRegistry {
  private readonly listeners = new Map<string, EventListener>();
  private readonly deps: RegistryDeps;

  constructor(deps: RegistryDeps) {
    this.deps = deps;
  }

  async add(reg: WorkflowRegistration): Promise<void> {
    if (this.listeners.has(reg.workflowId)) {
      // Idempotent: Phase 4 reconciler handles config changes via
      // remove+add rather than in-place mutation.
      return;
    }
    const listener = new EventListener({
      ...reg,
      providerManager: this.deps.providerManager,
      dedup: this.deps.dedup,
      sqs: this.deps.sqs,
      sqsQueueUrl: this.deps.sqsQueueUrl,
    });
    try {
      await listener.start();
    } catch (err) {
      logger.warn(
        `[ListenerRegistry] failed to start listener ${reg.workflowId}: ${String(err)}`,
      );
      return;
    }
    this.listeners.set(reg.workflowId, listener);
  }

  remove(workflowId: string): void {
    const listener = this.listeners.get(workflowId);
    if (!listener) {
      return;
    }
    listener.stop();
    this.listeners.delete(workflowId);
  }

  has(workflowId: string): boolean {
    return this.listeners.has(workflowId);
  }

  ids(): string[] {
    return [...this.listeners.keys()];
  }

  size(): number {
    return this.listeners.size;
  }

  async stopAll(): Promise<void> {
    for (const listener of this.listeners.values()) {
      listener.stop();
    }
    this.listeners.clear();
  }
}
