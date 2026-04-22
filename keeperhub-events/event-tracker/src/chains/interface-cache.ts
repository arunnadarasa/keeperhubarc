import { createHash } from "node:crypto";
import { ethers } from "ethers";

/**
 * Cache of `ethers.Interface` instances keyed by a stable hash of the ABI.
 * Multiple workflows watching the same contract schema share one parsed
 * Interface; reconnects on a single workflow skip the parse entirely on
 * the second call.
 *
 * `ethers.Interface` is effectively immutable (it exposes decode/encode
 * against a parsed ABI and holds no network state), so sharing across
 * unrelated callers is safe.
 */

const cache = new Map<string, ethers.Interface>();

function hashAbi(abi: readonly unknown[]): string {
  // JSON.stringify is deterministic for the object shapes produced by
  // rawEventsAbi.map(buildEventAbi). If two callers pass semantically
  // equivalent ABIs with different key orderings, they will miss the cache
  // and allocate a second Interface. That is an overhead, not a bug.
  return createHash("sha256").update(JSON.stringify(abi)).digest("hex");
}

export function getInterface(abi: readonly unknown[]): ethers.Interface {
  const key = hashAbi(abi);
  const existing = cache.get(key);
  if (existing) {
    return existing;
  }
  const created = new ethers.Interface(abi as ethers.InterfaceAbi);
  cache.set(key, created);
  return created;
}

export function clearInterfaceCache(): void {
  cache.clear();
}

export function getInterfaceCacheSize(): number {
  return cache.size;
}
