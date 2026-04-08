import type { RpcMetricsCollector, RpcProviderManager } from "./index";
import { classifyRpcError } from "./index";

export type RpcMetricsContext = {
  metricsCollector: RpcMetricsCollector;
  chainName: string;
  providerType: "primary" | "fallback";
};

/**
 * Build an RpcMetricsContext from an RpcProviderManager instance.
 */
export function rpcMetricsCtx(
  rpcManager: RpcProviderManager
): RpcMetricsContext {
  return {
    metricsCollector: rpcManager.getMetricsCollector(),
    chainName: rpcManager.getChainName(),
    providerType: rpcManager.getCurrentProviderType(),
  };
}

/**
 * Wrap an RPC operation with metrics recording.
 * Records attempt, latency, success/failure, and error type.
 * Does NOT add failover or retries -- use executeWithFailover for that.
 * Re-throws the original error on failure.
 */
export async function withRpcMetrics<T>(
  ctx: RpcMetricsContext,
  operation: () => Promise<T>
): Promise<T> {
  const { metricsCollector, chainName, providerType } = ctx;

  if (providerType === "primary") {
    metricsCollector.recordPrimaryAttempt(chainName);
  } else {
    metricsCollector.recordFallbackAttempt(chainName);
  }

  const startTime = performance.now();
  try {
    const result = await operation();
    const durationMs = performance.now() - startTime;
    metricsCollector.recordLatency(chainName, providerType, durationMs);
    metricsCollector.recordSuccess(chainName, providerType);
    return result;
  } catch (error: unknown) {
    const durationMs = performance.now() - startTime;
    metricsCollector.recordLatency(chainName, providerType, durationMs);
    if (providerType === "primary") {
      metricsCollector.recordPrimaryFailure(chainName);
    } else {
      metricsCollector.recordFallbackFailure(chainName);
    }
    metricsCollector.recordErrorType(
      chainName,
      providerType,
      classifyRpcError(error)
    );
    throw error;
  }
}
