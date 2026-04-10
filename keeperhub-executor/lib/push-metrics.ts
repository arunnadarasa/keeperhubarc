/**
 * Push the in-memory Prometheus registry to a Prometheus Pushgateway.
 *
 * Used by ephemeral workflow-runner pods (K8s Jobs) so their RPC metrics
 * survive after the pod exits. The Pushgateway is then scraped by Prometheus.
 *
 * No-op when METRICS_COLLECTOR is not "prometheus" or PUSHGATEWAY_URL is unset.
 */

const PUSH_TIMEOUT_MS = 5000;

export async function pushMetricsToGateway(jobName: string): Promise<void> {
  if (process.env.METRICS_COLLECTOR !== "prometheus") {
    return;
  }

  const pushgatewayUrl = process.env.PUSHGATEWAY_URL;
  if (!pushgatewayUrl) {
    return;
  }

  try {
    const { getApiProcessMetrics } = await import(
      "../../lib/metrics/prometheus-api"
    );
    const metrics = await getApiProcessMetrics();

    const url = `${pushgatewayUrl.replace(/\/$/, "")}/metrics/job/${encodeURIComponent(jobName)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: metrics,
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(
        `[PushMetrics] Failed to push to ${url}: ${response.status} ${response.statusText}`
      );
      return;
    }

    console.log(`[PushMetrics] Pushed metrics to ${url}`);
  } catch (error: unknown) {
    console.error("[PushMetrics] Error pushing metrics:", error);
  }
}
