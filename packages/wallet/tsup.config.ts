import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/hook-entrypoint.ts", "src/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node20",
  splitting: false,
  minify: false,
});
