// Structured event logger for MCP operations.
// Intentionally lightweight: emits structured JSON lines to stdout so they
// are captured by the host log aggregator (Vercel / CloudWatch / Datadog).
// Do NOT log tokens, API keys, or other secrets.

export function logMcpEvent(
  event: string,
  data: Record<string, unknown>
): void {
  const entry = {
    level: "info",
    event,
    ts: new Date().toISOString(),
    ...data,
  };
  console.log(JSON.stringify(entry));
}
