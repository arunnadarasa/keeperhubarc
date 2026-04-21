import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Dev-only cross-ref: when the client-side HMAC unit test imports the
// server-side reference from lib/agentic-wallet/hmac.ts, the server module
// transitively imports @/lib/db and @/lib/db/schema (Drizzle + postgres.js).
// Stub those out so the package tests never touch the real DB. This config
// is vitest-only and NEVER shipped in dist.
//
// Order matters: the more-specific /schema pattern must match first so the
// bare @/lib/db entry does not claim @/lib/db/schema as a prefix.
export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
    environment: "node",
    testTimeout: 10_000,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: [
      {
        find: /^@\/lib\/db\/schema$/,
        replacement: resolve(
          import.meta.dirname,
          "./tests/stubs/lib-db-schema.ts"
        ),
      },
      {
        find: /^@\/lib\/db$/,
        replacement: resolve(import.meta.dirname, "./tests/stubs/lib-db.ts"),
      },
    ],
  },
});
