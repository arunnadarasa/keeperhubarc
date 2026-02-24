import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConsoleMessage, Page, TestInfo } from "@playwright/test";
import { test as base } from "@playwright/test";
import { probe } from "./utils/discover";

export { expect } from "@playwright/test";

const MAX_CONSOLE_ENTRIES = 200;
const MAX_CONSOLE_ENTRY_LENGTH = 500;
const SANITIZE_TITLE_REGEX = /[^a-zA-Z0-9-_]/g;

interface ConsoleEntry {
  type: string;
  text: string;
  location: string;
}

interface NetworkFailure {
  url: string;
  method: string;
  failure: string;
}

/**
 * Extended test fixture that automatically captures diagnostics on failure:
 * - Browser console logs
 * - Failed network requests
 * - probe() snapshot (elements, screenshot, accessibility tree)
 *
 * Import { test, expect } from this file instead of @playwright/test.
 */
export const test = base.extend<{
  _autoFailureDiagnostics: undefined;
}>({
  _autoFailureDiagnostics: [
    async ({ page }, use, testInfo) => {
      const consoleLogs: ConsoleEntry[] = [];
      const networkFailures: NetworkFailure[] = [];

      const onConsole = (msg: ConsoleMessage): void => {
        if (consoleLogs.length >= MAX_CONSOLE_ENTRIES) {
          return;
        }
        const text = msg.text();
        consoleLogs.push({
          type: msg.type(),
          text:
            text.length > MAX_CONSOLE_ENTRY_LENGTH
              ? `${text.substring(0, MAX_CONSOLE_ENTRY_LENGTH)}...`
              : text,
          location: `${msg.location().url}:${msg.location().lineNumber}`,
        });
      };

      const onRequestFailed = (request: {
        url: () => string;
        method: () => string;
        failure: () => { errorText: string } | null;
      }): void => {
        const failure = request.failure();
        networkFailures.push({
          url: request.url(),
          method: request.method(),
          failure: failure?.errorText ?? "unknown",
        });
      };

      page.on("console", onConsole);
      page.on("requestfailed", onRequestFailed);

      await use(undefined);

      page.removeListener("console", onConsole);
      page.removeListener("requestfailed", onRequestFailed);

      if (testInfo.status !== testInfo.expectedStatus) {
        await captureFailureDiagnostics(
          page,
          testInfo,
          consoleLogs,
          networkFailures
        );
      }
    },
    { auto: true },
  ],
});

async function captureFailureDiagnostics(
  page: Page,
  testInfo: TestInfo,
  consoleLogs: ConsoleEntry[],
  networkFailures: NetworkFailure[]
): Promise<void> {
  const shouldSkip = page.url() === "about:blank" || page.isClosed();
  if (shouldSkip) {
    return;
  }

  const sanitizedTitle = testInfo.title.replace(SANITIZE_TITLE_REGEX, "-");
  const probeLabel = `FAILURE-${sanitizedTitle}`;

  // Format console logs
  const consoleText =
    consoleLogs.length > 0
      ? consoleLogs
          .map(
            (entry) =>
              `[${entry.type.toUpperCase()}] ${entry.text}\n  at ${entry.location}`
          )
          .join("\n\n")
      : "(no console output captured)";

  // Format network failures
  const networkText =
    networkFailures.length > 0
      ? networkFailures
          .map(
            (entry) => `${entry.method} ${entry.url}\n  Error: ${entry.failure}`
          )
          .join("\n\n")
      : "(no failed network requests)";

  // Attach to Playwright HTML report
  await testInfo.attach("console-logs.txt", {
    body: consoleText,
    contentType: "text/plain",
  });
  await testInfo.attach("network-failures.txt", {
    body: networkText,
    contentType: "text/plain",
  });

  // Run probe for page state capture
  try {
    const report = await probe(page, probeLabel);

    // Write console and network files alongside probe output
    const probeDir = join(
      process.cwd(),
      "tests",
      "e2e",
      "playwright",
      ".probes"
    );
    const { readdirSync } = await import("node:fs");
    const dirs = readdirSync(probeDir)
      .filter((d) => d.startsWith(probeLabel))
      .sort()
      .reverse();

    if (dirs[0]) {
      const outputDir = join(probeDir, dirs[0]);
      writeFileSync(join(outputDir, "console-logs.txt"), consoleText);
      writeFileSync(join(outputDir, "network-failures.txt"), networkText);
    }

    // Attach probe screenshot to report
    if (report.structure.url) {
      await testInfo
        .attach("failure-screenshot.png", {
          path: join(probeDir, dirs[0] ?? probeLabel, "screenshot.png"),
          contentType: "image/png",
        })
        .catch(() => {
          // Screenshot attachment may fail if probe dir structure differs
        });
    }
  } catch {
    // Page may be crashed or closed - probe failure is non-fatal
  }
}
