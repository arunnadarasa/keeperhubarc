import type { BillingProvider } from "../provider";
import { StripeBillingProvider } from "./stripe";

let cachedProvider: BillingProvider | undefined;

export function getBillingProvider(): BillingProvider {
  if (!cachedProvider) {
    cachedProvider = new StripeBillingProvider();
  }
  return cachedProvider;
}
