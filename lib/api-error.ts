import { captureException } from "@sentry/nextjs";
import { NextResponse } from "next/server";

/**
 * Standardized API error handler
 *
 * Logs the error with context and returns a consistent JSON response.
 * All errors flow through the logger which adds timestamps and
 * source locations (in staging with LOG_LEVEL=debug).
 *
 * @param error - The caught error
 * @param context - Description of what operation failed (e.g., "Failed to get workflows")
 * @param status - HTTP status code (default: 500)
 */
export function apiError(
  error: unknown,
  context: string,
  status = 500
): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  const rootCause = getRootCause(error);
  const stack = error instanceof Error ? error.stack : undefined;

  console.error(`[API] ${context}:`, message, stack ?? "");

  // Report to Sentry for alerting
  const sentryError =
    error instanceof Error ? error : new Error(`${context}: ${message}`);
  captureException(sentryError, {
    tags: { error_context: context },
    extra: { status },
  });

  return NextResponse.json(
    {
      error: rootCause ?? message,
      context,
    },
    { status }
  );
}

function getRootCause(error: unknown): string | undefined {
  if (!(error instanceof Error && error.cause)) {
    return undefined;
  }
  const cause = error.cause;
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  return undefined;
}
