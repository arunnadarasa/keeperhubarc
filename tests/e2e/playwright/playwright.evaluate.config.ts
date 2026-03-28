import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import { expand } from "dotenv-expand";

expand(dotenv.config());

const evalPort = parseInt(process.env.EVAL_PORT ?? "3099", 10);
const baseURL = process.env.PORTLESS_URL ?? `http://localhost:${evalPort}`;

const DEFAULT_DB_URL =
  "postgresql://postgres:postgres@localhost:5433/keeperhub";
const databaseUrl =
  process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("${")
    ? process.env.DATABASE_URL
    : DEFAULT_DB_URL;
process.env.DATABASE_URL = databaseUrl;

const devServerCommand =
  process.env.PORTLESS_AVAILABLE === "1"
    ? `portless run --name keeperhub DATABASE_URL=${databaseUrl} pnpm dev`
    : `DATABASE_URL=${databaseUrl} pnpm dev --port ${evalPort}`;

export default defineConfig({
  globalSetup: "../../../scripts/evaluate/seed-eval.ts",
  testDir: ".",
  testMatch: "**/*.test.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["json", { outputFile: ".claude/eval-results.json" }]],
  timeout: 60_000,
  use: {
    baseURL,
    trace: "off",
    screenshot: "only-on-failure",
    navigationTimeout: 60_000,
  },
  webServer: {
    command: devServerCommand,
    url: `http://localhost:${evalPort}`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "tests/e2e/playwright/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
});
