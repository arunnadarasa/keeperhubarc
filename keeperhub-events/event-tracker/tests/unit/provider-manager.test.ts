import type { ethers } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChainProviderManager,
  type ProviderFactory,
} from "../../src/chains/provider-manager";

type BlockHandler = (blockNumber: number) => void | Promise<void>;

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
  public destroyed = false;
  private blockHandler: BlockHandler | null = null;

  on(event: string, handler: BlockHandler): void {
    if (event === "block") {
      this.blockHandler = handler;
    }
  }

  off(event: string, handler: BlockHandler): void {
    if (event === "block" && this.blockHandler === handler) {
      this.blockHandler = null;
    }
  }

  async send(method: string, params: unknown[]): Promise<unknown> {
    this.sendCalls.push({ method, params });
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

  async emitBlock(blockNumber: number): Promise<void> {
    if (this.blockHandler) {
      await this.blockHandler(blockNumber);
    }
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

  beforeEach(() => {
    factoryBundle = makeFactory();
    manager = new ChainProviderManager(factoryBundle.factory);
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
