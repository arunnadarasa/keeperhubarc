import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
    environment: "node",
    testTimeout: 10_000,
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // Dev-only cross-ref: when the client-side HMAC unit test imports the
      // server-side reference from lib/agentic-wallet/hmac.ts, the server
      // module transitively imports @/lib/db (Drizzle + postgres.js). Stub
      // those out so the package tests never touch the real DB. This alias
      // is vitest-config-only and NEVER shipped in dist.
      "@/lib/db": resolve(import.meta.dirname, "./tests/stubs/lib-db.ts"),
      "@/lib/db/schema": resolve(
        import.meta.dirname,
        "./tests/stubs/lib-db-schema.ts"
      ),
    },
  },
});
