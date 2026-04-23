import { ethers } from "ethers";
import { logger } from "../../lib/utils/logger";

/**
 * ChainProviderManager centralises WebSocket provider ownership and
 * block-based log delivery per chain. One provider and one
 * `eth_subscribe(newHeads)` subscription per chainId, regardless of how
 * many listeners are registered for that chain.
 *
 * Log delivery uses block subscription + batched `eth_getLogs` rather than
 * one `eth_subscribe(logs, ...)` per listener. This decouples RPC-side
 * subscription count from workflow count (provider subscription caps are
 * typically ~1000 per WSS).
 *
 * Phase 1 scope: provider singleton + block-sub demux. Heartbeat and
 * reconnect continue to live in `ws-connection.ts` until Phase 3 routes
 * listeners through this manager at runtime.
 */

// Address list cap on `eth_getLogs` varies by provider (Alchemy ~500,
// Infura ~1000). Chunk defensively; multiple calls per block are cheap.
const GETLOGS_ADDRESS_BATCH = 500;

export type LogHandler = (log: ethers.Log) => void | Promise<void>;
export type Unsubscribe = () => void;

export type ProviderFactory = (wssUrl: string) => ethers.WebSocketProvider;

export interface SubscribeOptions {
  chainId: number;
  wssUrl: string;
  address: string;
  topic0: string;
  handler: LogHandler;
}

interface Subscriber {
  address: string; // normalized to lowercase
  topic0: string; // 0x-prefixed, lowercase
  handler: LogHandler;
}

interface ChainEntry {
  chainId: number;
  wssUrl: string;
  provider: ethers.WebSocketProvider | null;
  readyPromise: Promise<ethers.WebSocketProvider> | null;
  subscribers: Set<Subscriber>;
  blockListener: ((blockNumber: number) => Promise<void>) | null;
}

const defaultFactory: ProviderFactory = (wssUrl) =>
  new ethers.WebSocketProvider(wssUrl);

export class ChainProviderManager {
  private readonly chains = new Map<number, ChainEntry>();
  private readonly factory: ProviderFactory;

  constructor(factory: ProviderFactory = defaultFactory) {
    this.factory = factory;
  }

  async getOrCreateProvider(
    chainId: number,
    wssUrl: string,
  ): Promise<ethers.WebSocketProvider> {
    const entry = this.ensureEntry(chainId, wssUrl);

    if (entry.provider) {
      return entry.provider;
    }

    // Two concurrent callers must receive the same provider instance, not
    // race to create separate ones.
    if (!entry.readyPromise) {
      entry.readyPromise = this.createProvider(entry);
    }
    return entry.readyPromise;
  }

  async subscribeToLogs(opts: SubscribeOptions): Promise<Unsubscribe> {
    const entry = this.ensureEntry(opts.chainId, opts.wssUrl);
    await this.getOrCreateProvider(opts.chainId, opts.wssUrl);

    const subscriber: Subscriber = {
      address: opts.address.toLowerCase(),
      topic0: opts.topic0.toLowerCase(),
      handler: opts.handler,
    };
    entry.subscribers.add(subscriber);

    if (!entry.blockListener) {
      this.attachBlockListener(entry);
    }

    return () => {
      entry.subscribers.delete(subscriber);
      if (entry.subscribers.size === 0) {
        this.detachBlockListener(entry);
      }
    };
  }

  /**
   * True iff a provider instance has been created for `chainId`. Intended
   * for tests that need to assert the shared-provider invariant
   * (N listeners on chain X share one provider).
   */
  hasProvider(chainId: number): boolean {
    return this.chains.get(chainId)?.provider != null;
  }

  /**
   * Number of active subscribers for `chainId`. Returns 0 for an unknown
   * chain. Used by tests to assert that multiple listeners on the same
   * chain multiplex through one ChainEntry (the demux path).
   */
  subscriberCount(chainId: number): number {
    return this.chains.get(chainId)?.subscribers.size ?? 0;
  }

  async destroy(): Promise<void> {
    const errors: unknown[] = [];
    for (const entry of this.chains.values()) {
      this.detachBlockListener(entry);
      if (entry.provider) {
        try {
          await entry.provider.destroy();
        } catch (err) {
          errors.push(err);
        }
      }
      entry.subscribers.clear();
      entry.provider = null;
      entry.readyPromise = null;
    }
    this.chains.clear();
    if (errors.length > 0) {
      logger.warn(
        `[ChainProviderManager] ${errors.length} provider destroy errors: ${errors
          .map(String)
          .join("; ")}`,
      );
    }
  }

  private ensureEntry(chainId: number, wssUrl: string): ChainEntry {
    const existing = this.chains.get(chainId);
    if (existing) {
      if (existing.wssUrl !== wssUrl) {
        throw new Error(
          `chainId ${chainId} already registered with wssUrl ${existing.wssUrl}; refusing to reuse for ${wssUrl}`,
        );
      }
      return existing;
    }
    const entry: ChainEntry = {
      chainId,
      wssUrl,
      provider: null,
      readyPromise: null,
      subscribers: new Set(),
      blockListener: null,
    };
    this.chains.set(chainId, entry);
    return entry;
  }

  private async createProvider(
    entry: ChainEntry,
  ): Promise<ethers.WebSocketProvider> {
    const provider = this.factory(entry.wssUrl);
    await provider.ready;
    entry.provider = provider;
    return provider;
  }

  private attachBlockListener(entry: ChainEntry): void {
    if (!entry.provider) {
      throw new Error(
        `attachBlockListener: provider not initialized for chain ${entry.chainId}`,
      );
    }
    const listener = async (blockNumber: number): Promise<void> => {
      await this.processBlock(entry, blockNumber);
    };
    entry.blockListener = listener;
    entry.provider.on("block", listener);
  }

  private detachBlockListener(entry: ChainEntry): void {
    if (!(entry.provider && entry.blockListener)) {
      entry.blockListener = null;
      return;
    }
    entry.provider.off("block", entry.blockListener);
    entry.blockListener = null;
  }

  private async processBlock(
    entry: ChainEntry,
    blockNumber: number,
  ): Promise<void> {
    const subscribers = [...entry.subscribers];
    if (subscribers.length === 0 || !entry.provider) {
      return;
    }

    const { addresses, topic0s } = this.collectFilter(subscribers);
    const blockHex = `0x${blockNumber.toString(16)}`;

    try {
      const logs: ethers.Log[] = [];
      for (let i = 0; i < addresses.length; i += GETLOGS_ADDRESS_BATCH) {
        const chunk = addresses.slice(i, i + GETLOGS_ADDRESS_BATCH);
        const batch = (await entry.provider.send("eth_getLogs", [
          {
            fromBlock: blockHex,
            toBlock: blockHex,
            address: chunk,
            topics: [topic0s],
          },
        ])) as ethers.Log[];
        logs.push(...batch);
      }

      for (const log of logs) {
        await this.dispatchLog(entry, log);
      }
    } catch (err) {
      logger.warn(
        `[ChainProviderManager] chain=${entry.chainId} block=${blockNumber} getLogs failed: ${String(err)}`,
      );
    }
  }

  private collectFilter(subscribers: Subscriber[]): {
    addresses: string[];
    topic0s: string[];
  } {
    const addressSet = new Set<string>();
    const topicSet = new Set<string>();
    for (const sub of subscribers) {
      addressSet.add(sub.address);
      topicSet.add(sub.topic0);
    }
    return {
      addresses: [...addressSet],
      topic0s: [...topicSet],
    };
  }

  private async dispatchLog(entry: ChainEntry, log: ethers.Log): Promise<void> {
    const logAddr = log.address?.toLowerCase();
    const logTopic0 = log.topics?.[0]?.toLowerCase();
    if (!(logAddr && logTopic0)) {
      return;
    }
    // Fire all matching handlers concurrently. Sequential `await` here would
    // let a slow handler (e.g. one applying the EventListener jitter sleep)
    // stall dispatch to every other subscriber on the same log, compounding
    // latency linearly with listener count. Each handler's errors are
    // isolated so one rejection does not abort the others.
    const matching: Subscriber[] = [];
    for (const sub of entry.subscribers) {
      if (sub.address === logAddr && sub.topic0 === logTopic0) {
        matching.push(sub);
      }
    }
    await Promise.all(
      matching.map(async (sub) => {
        try {
          await sub.handler(log);
        } catch (err) {
          logger.warn(
            `[ChainProviderManager] chain=${entry.chainId} subscriber handler threw: ${String(err)}`,
          );
        }
      }),
    );
  }
}

export const chainProviderManager = new ChainProviderManager();
