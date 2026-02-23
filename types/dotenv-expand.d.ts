declare module "dotenv-expand" {
  // Minimal type stubs to satisfy type-checking in bundler mode
  // The library expands values from a dotenv config object in-place.
  export function expand(config: unknown): unknown;
}
