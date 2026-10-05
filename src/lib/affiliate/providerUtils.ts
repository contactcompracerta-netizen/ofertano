/**
 * Utility functions for affiliate provider registration.
 *
 * This file is intentionally neutral and does NOT import from
 * providerRegistry.ts to avoid circular dependencies.
 *
 * Dependencies flow:
 *   providerTypes (if needed) → providerUtils → providers → providerRegistry → linkEngine
 */
import type { AffiliateProvider } from "../../services/affiliates/linkEngine";
import type { AffiliateLinkInput } from "../../services/affiliates/linkEngine";

/**
 * Creates a provider "not configured" stub.
 *
 * Used by providerRegistry.ts to register providers that are
 * by default unconfigured and perform no external calls.
 *
 * @param id - Provider identifier string (e.g. "shopee", "amazon", "aliexpress", "awin")
 * @param supports - Function to determine if provider supports the input
 * @returns AffiliateProvider with isConfigured() => false and buildLink throws "PROVIDER_NOT_CONFIGURED"
 */
export function notConfiguredProvider(
  id: string,
  supports: (input: AffiliateLinkInput) => boolean,
): AffiliateProvider {
  return {
    id: id as "awin" | "shopee" | "amazon" | "aliexpress",
    supports,
    isConfigured: () => false,
    async buildLink() {
      throw new Error("PROVIDER_NOT_CONFIGURED");
    },
  };
}