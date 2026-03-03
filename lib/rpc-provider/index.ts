import { type EthersError, ethers, isError } from "ethers";

/**
 * Ethers error codes that indicate a permanent failure -- retrying on the same
 * or a different provider will never succeed. These are re-thrown immediately,
 * bypassing both the retry loop and the failover logic.
 */
const NON_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  "CALL_EXCEPTION", // contract revert, out-of-gas, function not found
  "INVALID_ARGUMENT", // bad parameter types/values
  "MISSING_ARGUMENT",
  "UNEXPECTED_ARGUMENT",
  "NUMERIC_FAULT", // overflow, division by zero
  "BAD_DATA", // malformed ABI encoding that won't decode on any provider
]);

/**
 * Interface for metrics collection - allows dependency injection
 * so both server-side (console/structured) and frontend (no-op) can use this
 */
export type RpcMetricsCollector = {
  recordPrimaryAttempt(chainName: string): void;
  recordPrimaryFailure(chainName: string): void;
  recordFallbackAttempt(chainName: string): void;
  recordFallbackFailure(chainName: string): void;
  recordFailoverEvent(chainName: string): void;
};

/**
 * Callback for failover state changes - allows UI to react to failover events
 */
export type FailoverStateChangeCallback = (
  chainName: string,
  isUsingFallback: boolean,
  reason: "failover" | "recovery"
) => void;

/**
 * No-op metrics collector for environments without metrics (e.g., frontend)
 */
export const noopMetricsCollector: RpcMetricsCollector = {
  recordPrimaryAttempt: () => {
    /* noop */
  },
  recordPrimaryFailure: () => {
    /* noop */
  },
  recordFallbackAttempt: () => {
    /* noop */
  },
  recordFallbackFailure: () => {
    /* noop */
  },
  recordFailoverEvent: () => {
    /* noop */
  },
};

/**
 * Console-based metrics collector for debugging
 */
export const consoleMetricsCollector: RpcMetricsCollector = {
  recordPrimaryAttempt: (chain) =>
    console.debug(`[RPC Metrics] Primary attempt: ${chain}`),
  recordPrimaryFailure: (chain) =>
    console.debug(`[RPC Metrics] Primary failure: ${chain}`),
  recordFallbackAttempt: (chain) =>
    console.debug(`[RPC Metrics] Fallback attempt: ${chain}`),
  recordFallbackFailure: (chain) =>
    console.debug(`[RPC Metrics] Fallback failure: ${chain}`),
  recordFailoverEvent: (chain) =>
    console.debug(`[RPC Metrics] Failover event: ${chain}`),
};

export type RpcProviderConfig = {
  primaryRpcUrl: string;
  fallbackRpcUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
  chainName?: string;
};

export type RpcProviderMetrics = {
  primaryAttempts: number;
  primaryFailures: number;
  fallbackAttempts: number;
  fallbackFailures: number;
  totalRequests: number;
  lastFailoverTime: Date | null;
};

export type RpcProviderManagerOptions = {
  config: RpcProviderConfig;
  metricsCollector?: RpcMetricsCollector;
  onFailoverStateChange?: FailoverStateChangeCallback;
};

export class RpcProviderManager {
  private primaryProvider: ethers.JsonRpcProvider | null = null;
  private fallbackProvider: ethers.JsonRpcProvider | null = null;
  private readonly config: Required<
    Omit<RpcProviderConfig, "fallbackRpcUrl">
  > & {
    fallbackRpcUrl?: string;
  };
  private readonly metrics: RpcProviderMetrics;
  private readonly metricsCollector: RpcMetricsCollector;
  private isUsingFallback = false;
  private onFailoverStateChange?: FailoverStateChangeCallback;

  private static readonly DEFAULT_MAX_RETRIES = 3;
  private static readonly DEFAULT_TIMEOUT_MS = 30_000;
  private static readonly RETRY_AFTER_CAP_SECONDS = 30;

  constructor(options: RpcProviderManagerOptions) {
    const {
      config,
      metricsCollector = noopMetricsCollector,
      onFailoverStateChange,
    } = options;
    this.onFailoverStateChange = onFailoverStateChange;

    this.config = {
      primaryRpcUrl: config.primaryRpcUrl,
      fallbackRpcUrl: config.fallbackRpcUrl,
      maxRetries: config.maxRetries ?? RpcProviderManager.DEFAULT_MAX_RETRIES,
      timeoutMs: config.timeoutMs ?? RpcProviderManager.DEFAULT_TIMEOUT_MS,
      chainName: config.chainName ?? "unknown",
    };

    this.metricsCollector = metricsCollector;

    this.metrics = {
      primaryAttempts: 0,
      primaryFailures: 0,
      fallbackAttempts: 0,
      fallbackFailures: 0,
      totalRequests: 0,
      lastFailoverTime: null,
    };
  }

  private createProvider(url: string): ethers.JsonRpcProvider {
    const fetchRequest = new ethers.FetchRequest(url);
    fetchRequest.timeout = 5000;

    const provider = new ethers.JsonRpcProvider(fetchRequest, undefined, {
      cacheTimeout: -1,
    });

    return provider;
  }

  private getPrimaryProvider(): ethers.JsonRpcProvider {
    if (!this.primaryProvider) {
      this.primaryProvider = this.createProvider(this.config.primaryRpcUrl);
    }
    return this.primaryProvider;
  }

  private getFallbackProvider(): ethers.JsonRpcProvider | null {
    if (!this.fallbackProvider && this.config.fallbackRpcUrl) {
      this.fallbackProvider = this.createProvider(this.config.fallbackRpcUrl);
    }
    return this.fallbackProvider;
  }

  getProvider(): ethers.JsonRpcProvider {
    if (this.isUsingFallback && this.fallbackProvider) {
      return this.fallbackProvider;
    }
    return this.getPrimaryProvider();
  }

  async executeWithFailover<T>(
    operation: (provider: ethers.JsonRpcProvider) => Promise<T>
  ): Promise<T> {
    this.metrics.totalRequests += 1;

    // When in sticky fallback state, try fallback first, then primary as recovery
    if (this.isUsingFallback) {
      const fallbackProvider = this.getFallbackProvider();
      if (fallbackProvider) {
        const fallbackResult = await this.tryProvider(
          fallbackProvider,
          operation,
          "fallback",
          this.config.maxRetries
        );

        if (fallbackResult.success) {
          return fallbackResult.result as T;
        }

        // Fallback failed - try primary in case it recovered
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "RPC_FALLBACK_FAILED",
            message: `Fallback RPC failed for ${this.config.chainName}, attempting primary recovery`,
            chain: this.config.chainName,
            timestamp: new Date().toISOString(),
          })
        );

        const primaryProvider = this.getPrimaryProvider();
        const primaryResult = await this.tryProvider(
          primaryProvider,
          operation,
          "primary",
          this.config.maxRetries
        );

        if (primaryResult.success) {
          console.info(
            JSON.stringify({
              level: "info",
              event: "RPC_FAILOVER_RECOVERY",
              message: `Primary RPC recovered for ${this.config.chainName}, switching back from fallback`,
              chain: this.config.chainName,
              previousState: "fallback",
              newState: "primary",
              timestamp: new Date().toISOString(),
            })
          );
          this.isUsingFallback = false;
          this.onFailoverStateChange?.(this.config.chainName, false, "recovery");
          return primaryResult.result as T;
        }

        // Both failed -- throw without redundant retry
        console.error(
          JSON.stringify({
            level: "error",
            event: "RPC_BOTH_ENDPOINTS_FAILED",
            message: `Both primary and fallback RPC failed for ${this.config.chainName}`,
            chain: this.config.chainName,
            fallbackError: fallbackResult.error,
            primaryError: primaryResult.error,
            timestamp: new Date().toISOString(),
          })
        );
        throw new Error(
          `RPC failed on both endpoints. Fallback: ${fallbackResult.error}. Primary: ${primaryResult.error}`
        );
      }
    }

    // Normal path: try primary first, then fallback
    const primaryProvider = this.getPrimaryProvider();
    const primaryResult = await this.tryProvider(
      primaryProvider,
      operation,
      "primary",
      this.config.maxRetries
    );

    if (primaryResult.success) {
      return primaryResult.result as T;
    }

    const fallbackProvider = this.getFallbackProvider();
    if (fallbackProvider) {
      this.metrics.lastFailoverTime = new Date();
      this.metricsCollector.recordFailoverEvent(this.config.chainName);

      const fallbackResult = await this.tryProvider(
        fallbackProvider,
        operation,
        "fallback",
        this.config.maxRetries
      );

      if (fallbackResult.success) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "RPC_FAILOVER_ACTIVATED",
            message: `Primary RPC failed for ${this.config.chainName}, switching to fallback`,
            chain: this.config.chainName,
            previousState: "primary",
            newState: "fallback",
            primaryError: primaryResult.error,
            timestamp: new Date().toISOString(),
          })
        );
        this.isUsingFallback = true;
        this.onFailoverStateChange?.(this.config.chainName, true, "failover");
        return fallbackResult.result as T;
      }

      console.error(
        JSON.stringify({
          level: "error",
          event: "RPC_BOTH_ENDPOINTS_FAILED",
          message: `Both primary and fallback RPC failed for ${this.config.chainName}`,
          chain: this.config.chainName,
          primaryError: primaryResult.error,
          fallbackError: fallbackResult.error,
          timestamp: new Date().toISOString(),
        })
      );
      throw new Error(
        `RPC failed on both endpoints. Primary: ${primaryResult.error}. Fallback: ${fallbackResult.error}`
      );
    }

    throw new Error(`RPC failed on primary endpoint: ${primaryResult.error}`);
  }

  private async tryProvider<T>(
    provider: ethers.JsonRpcProvider,
    operation: (p: ethers.JsonRpcProvider) => Promise<T>,
    providerType: "primary" | "fallback",
    maxRetries: number
  ): Promise<{ success: boolean; result?: T; error?: string }> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (providerType === "primary") {
          this.metrics.primaryAttempts += 1;
          this.metricsCollector.recordPrimaryAttempt(this.config.chainName);
        } else {
          this.metrics.fallbackAttempts += 1;
          this.metricsCollector.recordFallbackAttempt(this.config.chainName);
        }

        const result = await this.withTimeout(
          operation(provider),
          this.config.timeoutMs
        );

        return { success: true, result };
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (providerType === "primary") {
          this.metrics.primaryFailures += 1;
          this.metricsCollector.recordPrimaryFailure(this.config.chainName);
        } else {
          this.metrics.fallbackFailures += 1;
          this.metricsCollector.recordFallbackFailure(this.config.chainName);
        }

        // Non-retryable errors (contract revert, invalid args, etc.) will
        // never succeed on any provider -- re-throw immediately to skip
        // both remaining retries and failover to the other provider.
        if (this.isNonRetryableError(error)) {
          throw lastError;
        }

        if (attempt === maxRetries - 1) {
          break;
        }

        // On 429 rate limit: respect Retry-After if within cap,
        // otherwise bail immediately and let executeWithFailover switch providers
        if (
          isError(error, "SERVER_ERROR") &&
          error.response?.statusCode === 429
        ) {
          const retryAfterHeader = error.response.getHeader("retry-after");
          const retryAfterSeconds = retryAfterHeader
            ? Number.parseInt(retryAfterHeader, 10)
            : Number.NaN;

          if (
            !Number.isNaN(retryAfterSeconds) &&
            retryAfterSeconds > 0 &&
            retryAfterSeconds <= RpcProviderManager.RETRY_AFTER_CAP_SECONDS
          ) {
            await this.delay(retryAfterSeconds * 1000);
            continue;
          }

          // No usable Retry-After -- stop retrying this provider
          break;
        }

        await this.delay(Math.min(1000 * 2 ** attempt, 5000));
      }
    }

    return {
      success: false,
      error: lastError?.message || "Unknown error",
    };
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ]);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isNonRetryableError(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("code" in error)) {
      return false;
    }
    return NON_RETRYABLE_ERROR_CODES.has(
      (error as EthersError).code as string
    );
  }

  getMetrics(): Readonly<RpcProviderMetrics> {
    return { ...this.metrics };
  }

  isCurrentlyUsingFallback(): boolean {
    return this.isUsingFallback;
  }

  getCurrentProviderType(): "primary" | "fallback" {
    return this.isUsingFallback ? "fallback" : "primary";
  }

  /**
   * Register a callback for failover state changes.
   * Useful for updating UI when failover occurs.
   */
  setFailoverStateChangeCallback(callback: FailoverStateChangeCallback): void {
    this.onFailoverStateChange = callback;
  }

  /**
   * Get the currently-active RPC URL, respecting cached failover state.
   * Does NOT probe the endpoint -- use resolveActiveRpcUrl() for write
   * operations where you need to verify the endpoint is reachable first.
   */
  getCurrentRpcUrl(): string {
    return this.isUsingFallback && this.config.fallbackRpcUrl
      ? this.config.fallbackRpcUrl
      : this.config.primaryRpcUrl;
  }

  /**
   * Probe the RPC endpoint with a lightweight getBlockNumber call via
   * executeWithFailover, then return the URL of whichever provider responded.
   * Use this for write operations that need a raw URL for signer construction
   * but should still benefit from failover if the primary is unreachable.
   */
  async resolveActiveRpcUrl(): Promise<string> {
    await this.executeWithFailover((provider) => provider.getBlockNumber());
    return this.getCurrentRpcUrl();
  }

  /**
   * Get the chain name this manager is configured for
   */
  getChainName(): string {
    return this.config.chainName;
  }
}

// Cache managers by RPC URL combination to persist failover state across requests
const managerCache = new Map<string, RpcProviderManager>();

export type CreateRpcProviderManagerOptions = {
  primaryRpcUrl: string;
  fallbackRpcUrl?: string;
  maxRetries?: number;
  timeoutMs?: number;
  chainName?: string;
  metricsCollector?: RpcMetricsCollector;
  onFailoverStateChange?: FailoverStateChangeCallback;
};

export function createRpcProviderManager(
  options: CreateRpcProviderManagerOptions
): RpcProviderManager {
  const cacheKey = `${options.primaryRpcUrl}|${options.fallbackRpcUrl || ""}`;

  let manager = managerCache.get(cacheKey);
  if (!manager) {
    manager = new RpcProviderManager({
      config: {
        primaryRpcUrl: options.primaryRpcUrl,
        fallbackRpcUrl: options.fallbackRpcUrl,
        maxRetries: options.maxRetries,
        timeoutMs: options.timeoutMs,
        chainName: options.chainName,
      },
      metricsCollector: options.metricsCollector,
      onFailoverStateChange: options.onFailoverStateChange,
    });
    managerCache.set(cacheKey, manager);
    console.info(
      JSON.stringify({
        level: "info",
        event: "RPC_PROVIDER_CREATED",
        message: `Created RPC provider manager for ${options.chainName || "unknown"}`,
        chain: options.chainName || "unknown",
        hasFallback: !!options.fallbackRpcUrl,
        timestamp: new Date().toISOString(),
      })
    );
  } else if (options.onFailoverStateChange) {
    // Update callback on existing manager if provided
    manager.setFailoverStateChangeCallback(options.onFailoverStateChange);
  }

  return manager;
}

/**
 * Get the current failover state for all cached managers
 */
export function getAllFailoverStates(): Map<
  string,
  { chainName: string; isUsingFallback: boolean }
> {
  const states = new Map<
    string,
    { chainName: string; isUsingFallback: boolean }
  >();
  managerCache.forEach((manager, key) => {
    states.set(key, {
      chainName: manager.getChainName(),
      isUsingFallback: manager.isCurrentlyUsingFallback(),
    });
  });
  return states;
}

export function clearRpcProviderManagerCache(): void {
  managerCache.clear();
}

// Re-export Solana provider
export * from "./solana";
