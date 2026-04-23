import type { ethers } from "ethers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChainProviderManager,
  type ProviderFactory,
} from "../../src/chains/provider-manager";

type BlockHandler = (blockNumber: number) => void | Promise<void>;
type ErrorHandler = (err: Error) => void;

interface SendCall {
  method: string;
  params: unknown[];
}

class MockProvider {
  // Vitest's vi.fn provides better assertions (toHaveBeenCalledWith) than a plain
  // Promise.resolve would, and the field is still awaitable.
  ready: Promise<void> = Promise.resolve();
  public sendCalls: SendCall[] = [];
  public sendResponses: unknown[] = [];
  public blockNumberResponses: Array<number | Error> = [];
  public destroyed = false;
  private blockHandler: BlockHandler | null = null;
  private errorHandler: ErrorHandler | null = null;

  on(event: string, handler: BlockHandler | ErrorHandler): void {
    if (event === "block") {
      this.blockHandler = handler as BlockHandler;
    } else if (event === "error") {
      this.errorHandler = handler as ErrorHandler;
    }
  }

  off(event: string, handler: BlockHandler | ErrorHandler): void {
    if (event === "block" && this.blockHandler === handler) {
      this.blockHandler = null;
    } else if (event === "error" && this.errorHandler === handler) {
      this.errorHandler = null;
    }
  }

  async send(method: string, params: unknown[]): Promise<unknown> {
    this.sendCalls.push({ method, params });
    if (method === "eth_blockNumber") {
      if (this.blockNumberResponses.length === 0) {
        return 0x1234;
      }
      const next = this.blockNumberResponses.shift();
      if (next instanceof Error) {
        throw next;
      }
      return next;
    }
    if (this.sendResponses.length === 0) {
      return [];
    }
    return this.sendResponses.shift();
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
  }

  hasBlockHandler(): boolean {
    return this.blockHandler !== null;
  }

  hasErrorHandler(): boolean {
    return this.errorHandler !== null;
  }

  async emitBlock(blockNumber: number): Promise<void> {
    if (this.blockHandler) {
      await this.blockHandler(blockNumber);
    }
  }

  emitError(err: Error): void {
    this.errorHandler?.(err);
  }
}

// MockProvider implements the ethers.WebSocketProvider surface that
// ChainProviderManager actually uses. The factory casts through unknown to
// satisfy the type without pulling in the rest of ethers' provider surface.
function makeFactory(): {
  factory: ProviderFactory;
  created: MockProvider[];
} {
  const created: MockProvider[] = [];
  const factory: ProviderFactory = (_wssUrl: string) => {
    const mock = new MockProvider();
    created.push(mock);
    return mock as unknown as ethers.WebSocketProvider;
  };
  return { factory, created };
}

const CHAIN_A = 31337;
const CHAIN_B = 1;
const ADDR_A = "0x1111111111111111111111111111111111111111";
const ADDR_B = "0x2222222222222222222222222222222222222222";
const TOPIC_EMITTED =
  "0x6d7747ff9aaba238de658957a12a32c8a94f6ec3aa0508441fe400ca79ed457c";
const TOPIC_OTHER =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

describe("ChainProviderManager", () => {
  let factoryBundle: ReturnType<typeof makeFactory>;
  let manager: ChainProviderManager;
  let onPermanentFailure: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    factoryBundle = makeFactory();
    onPermanentFailure = vi.fn();
    manager = new ChainProviderManager({
      factory: factoryBundle.factory,
      onPermanentFailure,
    });
  });

  afterEach(async () => {
    // Each test's manager starts a heartbeat on every provider it creates.
    // destroy() clears those intervals; without this, timers leak between
    // tests (harmless in CI but noisy when debugging with --ui).
    await manager.destroy();
  });

  describe("getOrCreateProvider", () => {
    it("returns the same provider instance for the same chainId", async () => {
      const a = await manager.getOrCreateProvider(CHAIN_A, "ws://a");
      const b = await manager.getOrCreateProvider(CHAIN_A, "ws://a");
      expect(a).toBe(b);
      expect(factoryBundle.created).toHaveLength(1);
    });

    it("does not double-create under concurrent callers", async () => {
      const [a, b, c] = await Promise.all([
        manager.getOrCreateProvider(CHAIN_A, "ws://a"),
        manager.getOrCreateProvider(CHAIN_A, "ws://a"),
        manager.getOrCreateProvider(CHAIN_A, "ws://a"),
      ]);
      expect(a).toBe(b);
      expect(b).toBe(c);
      expect(factoryBundle.created).toHaveLength(1);
    });

    it("creates separate providers for different chainIds", async () => {
      const a = await manager.getOrCreateProvider(CHAIN_A, "ws://a");
      const b = await manager.getOrCreateProvider(CHAIN_B, "ws://b");
      expect(a).not.toBe(b);
      expect(factoryBundle.created).toHaveLength(2);
    });

    it("rejects a mismatched wssUrl for a known chainId", async () => {
      await manager.getOrCreateProvider(CHAIN_A, "ws://a");
      await expect(
        manager.getOrCreateProvider(CHAIN_A, "ws://different"),
      ).rejects.toThrow(/already registered/);
    });
  });

  describe("subscribeToLogs block listener lifecycle", () => {
    it("attaches a block listener on first subscriber", async () => {
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: vi.fn(),
      });
      expect(factoryBundle.created[0].hasBlockHandler()).toBe(true);
    });

    it("does not re-attach a block listener for a second subscriber", async () => {
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: vi.fn(),
      });
      const spyOn = vi.spyOn(factoryBundle.created[0], "on");
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_B,
        topic0: TOPIC_EMITTED,
        handler: vi.fn(),
      });
      expect(spyOn).not.toHaveBeenCalledWith("block", expect.anything());
    });

    it("detaches the block listener when the last subscriber unsubscribes", async () => {
      const unsubA = await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: vi.fn(),
      });
      const unsubB = await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_B,
        topic0: TOPIC_EMITTED,
        handler: vi.fn(),
      });
      unsubA();
      expect(factoryBundle.created[0].hasBlockHandler()).toBe(true);
      unsubB();
      expect(factoryBundle.created[0].hasBlockHandler()).toBe(false);
    });
  });

  describe("log demux", () => {
    it("requests eth_getLogs with the union of addresses and topic0s", async () => {
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: vi.fn(),
      });
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_B,
        topic0: TOPIC_OTHER,
        handler: vi.fn(),
      });

      const provider = factoryBundle.created[0];
      provider.sendResponses = [[]];
      await provider.emitBlock(100);

      expect(provider.sendCalls).toHaveLength(1);
      expect(provider.sendCalls[0].method).toBe("eth_getLogs");
      const filter = provider.sendCalls[0].params[0] as {
        address: string[];
        topics: string[][];
        fromBlock: string;
        toBlock: string;
      };
      expect(filter.address.sort()).toEqual(
        [ADDR_A.toLowerCase(), ADDR_B.toLowerCase()].sort(),
      );
      expect(filter.topics[0].sort()).toEqual(
        [TOPIC_EMITTED, TOPIC_OTHER].sort(),
      );
      expect(filter.fromBlock).toBe("0x64");
      expect(filter.toBlock).toBe("0x64");
    });

    it("dispatches a log only to subscribers whose (address, topic0) matches", async () => {
      const handlerA = vi.fn();
      const handlerB = vi.fn();
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: handlerA,
      });
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_B,
        topic0: TOPIC_OTHER,
        handler: handlerB,
      });

      const provider = factoryBundle.created[0];
      // One log matching A; one log matching B; one log matching neither.
      const logA = {
        address: ADDR_A.toLowerCase(),
        topics: [TOPIC_EMITTED],
      };
      const logB = {
        address: ADDR_B.toLowerCase(),
        topics: [TOPIC_OTHER],
      };
      const logNeither = {
        address: ADDR_A.toLowerCase(),
        topics: [TOPIC_OTHER],
      };
      provider.sendResponses = [[logA, logB, logNeither]];
      await provider.emitBlock(101);

      expect(handlerA).toHaveBeenCalledTimes(1);
      expect(handlerA).toHaveBeenCalledWith(logA);
      expect(handlerB).toHaveBeenCalledTimes(1);
      expect(handlerB).toHaveBeenCalledWith(logB);
    });

    it("dispatches one log to multiple subscribers when they share (address, topic0)", async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: h1,
      });
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: h2,
      });

      const provider = factoryBundle.created[0];
      const log = {
        address: ADDR_A.toLowerCase(),
        topics: [TOPIC_EMITTED],
      };
      provider.sendResponses = [[log]];
      await provider.emitBlock(102);

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it("dispatches matching subscribers in parallel, not serially", async () => {
      // Two handlers on the same (address, topic0). h1 sleeps; h2 should
      // start before h1 resolves. With sequential await the h2 start time
      // would be >= 50ms; in parallel it should be ~0ms.
      let h1Started = 0;
      let h2Started = 0;
      let start = 0;
      const h1 = vi.fn(async () => {
        h1Started = Date.now() - start;
        await new Promise((r) => setTimeout(r, 50));
      });
      const h2 = vi.fn(async () => {
        h2Started = Date.now() - start;
      });
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: h1,
      });
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: h2,
      });

      const provider = factoryBundle.created[0];
      const log = {
        address: ADDR_A.toLowerCase(),
        topics: [TOPIC_EMITTED],
      };
      provider.sendResponses = [[log]];
      start = Date.now();
      await provider.emitBlock(500);

      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
      // h2 starts well before h1's 50ms sleep completes.
      expect(h2Started).toBeLessThan(40);
      expect(h1Started).toBeLessThan(10);
    });

    it("one handler throwing does not block or abort the others", async () => {
      const thrower = vi.fn(async () => {
        throw new Error("boom");
      });
      const later = vi.fn();
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: thrower,
      });
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: later,
      });

      const provider = factoryBundle.created[0];
      const log = {
        address: ADDR_A.toLowerCase(),
        topics: [TOPIC_EMITTED],
      };
      provider.sendResponses = [[log]];
      await provider.emitBlock(501);

      expect(thrower).toHaveBeenCalledTimes(1);
      expect(later).toHaveBeenCalledTimes(1);
    });

    it("does not call a handler after its subscription is cancelled", async () => {
      const handler = vi.fn();
      const unsubscribe = await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler,
      });
      // Need a second subscriber so the block listener stays attached.
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_B,
        topic0: TOPIC_OTHER,
        handler: vi.fn(),
      });

      unsubscribe();

      const provider = factoryBundle.created[0];
      const log = {
        address: ADDR_A.toLowerCase(),
        topics: [TOPIC_EMITTED],
      };
      provider.sendResponses = [[log]];
      await provider.emitBlock(103);

      expect(handler).not.toHaveBeenCalled();
    });

    it("isolates handler errors: one throwing handler does not skip later handlers", async () => {
      const throwing = vi.fn(() => {
        throw new Error("boom");
      });
      const later = vi.fn();
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: throwing,
      });
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: later,
      });

      const provider = factoryBundle.created[0];
      const log = {
        address: ADDR_A.toLowerCase(),
        topics: [TOPIC_EMITTED],
      };
      provider.sendResponses = [[log]];
      await provider.emitBlock(104);

      expect(throwing).toHaveBeenCalledTimes(1);
      expect(later).toHaveBeenCalledTimes(1);
    });
  });

  describe("introspection accessors", () => {
    it("hasProvider returns false for unknown chain", () => {
      expect(manager.hasProvider(CHAIN_A)).toBe(false);
    });

    it("hasProvider returns true after a provider has been created", async () => {
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: vi.fn(),
      });
      expect(manager.hasProvider(CHAIN_A)).toBe(true);
      expect(manager.hasProvider(CHAIN_B)).toBe(false);
    });

    it("subscriberCount reflects the shared-provider invariant", async () => {
      expect(manager.subscriberCount(CHAIN_A)).toBe(0);

      const unsubA = await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: vi.fn(),
      });
      expect(manager.subscriberCount(CHAIN_A)).toBe(1);

      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_B,
        topic0: TOPIC_EMITTED,
        handler: vi.fn(),
      });
      expect(manager.subscriberCount(CHAIN_A)).toBe(2);
      expect(factoryBundle.created).toHaveLength(1);

      unsubA();
      expect(manager.subscriberCount(CHAIN_A)).toBe(1);
    });
  });

  describe("health accessors", () => {
    it("isHealthy returns false for unknown chain", () => {
      expect(manager.isHealthy(CHAIN_A)).toBe(false);
    });

    it("isHealthy returns true after a provider is created", async () => {
      await manager.getOrCreateProvider(CHAIN_A, "ws://a");
      expect(manager.isHealthy(CHAIN_A)).toBe(true);
    });

    it("getHealth returns null for unknown chain", () => {
      expect(manager.getHealth(CHAIN_A)).toBeNull();
    });

    it("getHealth reports connected/reconnecting/subscriberCount", async () => {
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: vi.fn(),
      });
      const h = manager.getHealth(CHAIN_A);
      expect(h).toEqual({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        connected: true,
        reconnecting: false,
        lastBlockAt: null,
        subscriberCount: 1,
      });
    });

    it("getHealth.lastBlockAt updates after a block arrives", async () => {
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: vi.fn(),
      });
      expect(manager.getHealth(CHAIN_A)?.lastBlockAt).toBeNull();
      await factoryBundle.created[0].emitBlock(123);
      const after = manager.getHealth(CHAIN_A)?.lastBlockAt;
      expect(after).not.toBeNull();
      expect(typeof after).toBe("number");
    });

    it("getAllHealth returns an entry per known chain", async () => {
      await manager.getOrCreateProvider(CHAIN_A, "ws://a");
      await manager.getOrCreateProvider(CHAIN_B, "ws://b");
      const all = manager.getAllHealth();
      expect(all).toHaveLength(2);
      expect(all.map((h) => h.chainId).sort()).toEqual([CHAIN_B, CHAIN_A]);
    });

    it("getAllHealth returns empty when no chains are registered", () => {
      expect(manager.getAllHealth()).toEqual([]);
    });
  });

  describe("onDisconnect", () => {
    it("throws when no entry exists for the chain", () => {
      expect(() => manager.onDisconnect(CHAIN_A, vi.fn())).toThrow(
        /no entry for chainId/,
      );
    });

    it("fires with chainId and reason when the provider emits an error", async () => {
      await manager.getOrCreateProvider(CHAIN_A, "ws://a");
      const handler = vi.fn();
      manager.onDisconnect(CHAIN_A, handler);

      factoryBundle.created[0].emitError(new Error("boom"));
      // Allow the reconnect microtask queue to start so the disconnect
      // handler fires; reconnect itself is delayed (INITIAL_RECONNECT_DELAY_MS).
      await Promise.resolve();
      await Promise.resolve();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        chainId: CHAIN_A,
        reason: "provider_error",
        message: "boom",
      });
    });

    it("unsubscribe removes the handler", async () => {
      await manager.getOrCreateProvider(CHAIN_A, "ws://a");
      const handler = vi.fn();
      const unsub = manager.onDisconnect(CHAIN_A, handler);
      unsub();

      factoryBundle.created[0].emitError(new Error("boom"));
      await Promise.resolve();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("reconnect cycle", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("re-creates provider, preserves subscribers, reattaches block listener", async () => {
      const handler = vi.fn();
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler,
      });
      expect(factoryBundle.created).toHaveLength(1);
      const first = factoryBundle.created[0];

      first.emitError(new Error("wss dropped"));
      // Let disconnect handlers run, then fast-forward past the reconnect
      // delay so the first attempt completes.
      await vi.advanceTimersByTimeAsync(1_500);

      expect(factoryBundle.created).toHaveLength(2);
      const second = factoryBundle.created[1];
      // The subscription must survive, and the new provider must be wired
      // up for both block events and future errors.
      expect(manager.subscriberCount(CHAIN_A)).toBe(1);
      expect(second.hasBlockHandler()).toBe(true);
      expect(second.hasErrorHandler()).toBe(true);
      // Old provider was torn down.
      expect(first.destroyed).toBe(true);
      // isHealthy true again after successful reconnect.
      expect(manager.isHealthy(CHAIN_A)).toBe(true);
      expect(manager.getHealth(CHAIN_A)?.reconnecting).toBe(false);
    });

    it("does not re-attach block listener if all subscribers unsubscribed during reconnect", async () => {
      const handler = vi.fn();
      const unsub = await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler,
      });
      factoryBundle.created[0].emitError(new Error("drop"));
      // Unsubscribe while reconnect is in flight (before the delay).
      unsub();
      await vi.advanceTimersByTimeAsync(1_500);

      const second = factoryBundle.created[1];
      expect(second.hasBlockHandler()).toBe(false);
      // Error listener is still attached; it is chain-scoped, not sub-scoped.
      expect(second.hasErrorHandler()).toBe(true);
    });

    it("onDisconnect fires before the first reconnect attempt completes", async () => {
      await manager.getOrCreateProvider(CHAIN_A, "ws://a");
      const order: string[] = [];
      manager.onDisconnect(CHAIN_A, () => {
        order.push("disconnect");
      });
      // Spy the factory call count - reconnect creates a new provider.
      const createdBefore = factoryBundle.created.length;

      factoryBundle.created[0].emitError(new Error("drop"));
      await Promise.resolve();
      order.push(
        `after_microtasks(created=${factoryBundle.created.length - createdBefore})`,
      );

      await vi.advanceTimersByTimeAsync(1_500);
      order.push(
        `after_delay(created=${factoryBundle.created.length - createdBefore})`,
      );

      expect(order[0]).toBe("disconnect");
      expect(order[1]).toBe("after_microtasks(created=0)");
      expect(order[2]).toBe("after_delay(created=1)");
    });

    it("isHealthy is false while reconnecting", async () => {
      await manager.getOrCreateProvider(CHAIN_A, "ws://a");
      factoryBundle.created[0].emitError(new Error("drop"));
      // Give the disconnect handler loop a chance to set isReconnecting,
      // but do NOT advance past the reconnect delay.
      await Promise.resolve();
      await Promise.resolve();
      expect(manager.getHealth(CHAIN_A)?.reconnecting).toBe(true);
      expect(manager.isHealthy(CHAIN_A)).toBe(false);

      await vi.advanceTimersByTimeAsync(1_500);
      expect(manager.isHealthy(CHAIN_A)).toBe(true);
    });

    it("exhausted attempts call onPermanentFailure (injected)", async () => {
      // Fail the second provider factory call and every attempt after it.
      const failingFactory: ProviderFactory = () => {
        throw new Error("upstream down");
      };
      await manager.getOrCreateProvider(CHAIN_A, "ws://a");
      // Hot-swap the factory for the reconnect attempts by reaching into
      // the manager. Cleaner alternative would be to make factory
      // dynamic; this preserves the simpler public API.
      (manager as unknown as { factory: ProviderFactory }).factory =
        failingFactory;

      factoryBundle.created[0].emitError(new Error("drop"));
      // Fast-forward through all reconnect attempts (1s + 2s + 4s + ...,
      // capped at 60s per attempt; 10 attempts total).
      await vi.advanceTimersByTimeAsync(10 * 60_000);

      expect(onPermanentFailure).toHaveBeenCalledTimes(1);
      expect(onPermanentFailure).toHaveBeenCalledWith(CHAIN_A);
    });
  });

  describe("heartbeat", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("pings eth_blockNumber periodically", async () => {
      await manager.getOrCreateProvider(CHAIN_A, "ws://a");
      const provider = factoryBundle.created[0];
      const pingsBefore = provider.sendCalls.filter(
        (c) => c.method === "eth_blockNumber",
      ).length;

      await vi.advanceTimersByTimeAsync(30_000);

      const pingsAfter = provider.sendCalls.filter(
        (c) => c.method === "eth_blockNumber",
      ).length;
      expect(pingsAfter).toBeGreaterThan(pingsBefore);
    });

    it("thrown eth_blockNumber triggers reconnect with heartbeat_failure reason", async () => {
      await manager.getOrCreateProvider(CHAIN_A, "ws://a");
      const provider = factoryBundle.created[0];
      const reasons: string[] = [];
      manager.onDisconnect(CHAIN_A, (ev) => {
        reasons.push(ev.reason);
      });

      provider.blockNumberResponses.push(new Error("rpc dead"));
      await vi.advanceTimersByTimeAsync(30_100);

      expect(reasons).toEqual(["heartbeat_failure"]);
    });

    it("timeout triggers reconnect with heartbeat_timeout reason", async () => {
      await manager.getOrCreateProvider(CHAIN_A, "ws://a");
      const provider = factoryBundle.created[0];
      const reasons: string[] = [];
      manager.onDisconnect(CHAIN_A, (ev) => {
        reasons.push(ev.reason);
      });

      // Make eth_blockNumber hang indefinitely. The 10s timeout inside
      // runHeartbeat should fire and surface as heartbeat_timeout.
      provider.send = ((): Promise<unknown> => {
        return new Promise<unknown>(() => {
          // never resolves
        });
      }) as unknown as typeof provider.send;

      await vi.advanceTimersByTimeAsync(30_000); // schedule first heartbeat
      await vi.advanceTimersByTimeAsync(10_000); // let timeout race win

      expect(reasons).toEqual(["heartbeat_timeout"]);
    });
  });

  describe("destroy", () => {
    it("tears down every chain's provider and clears subscriber state", async () => {
      await manager.subscribeToLogs({
        chainId: CHAIN_A,
        wssUrl: "ws://a",
        address: ADDR_A,
        topic0: TOPIC_EMITTED,
        handler: vi.fn(),
      });
      await manager.subscribeToLogs({
        chainId: CHAIN_B,
        wssUrl: "ws://b",
        address: ADDR_B,
        topic0: TOPIC_EMITTED,
        handler: vi.fn(),
      });

      await manager.destroy();

      expect(factoryBundle.created).toHaveLength(2);
      expect(factoryBundle.created[0].destroyed).toBe(true);
      expect(factoryBundle.created[1].destroyed).toBe(true);
      expect(factoryBundle.created[0].hasBlockHandler()).toBe(false);
    });
  });
});
