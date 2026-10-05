import type {
  AffiliateLinkInput,
  AffiliateProvider,
  AffiliateProviderId,
} from "./linkEngine";

function normalizeId(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function notConfiguredProvider(
  id: AffiliateProviderId,
  supports: (input: AffiliateLinkInput) => boolean,
): AffiliateProvider {
  return {
    id,
    supports,
    isConfigured: () => false,
    async buildLink() {
      throw new Error("PROVIDER_NOT_CONFIGURED");
    },
  };
}

export const AFFILIATE_PROVIDER_REGISTRY: readonly AffiliateProvider[] = [
  notConfiguredProvider(
    "awin",
    (input) => normalizeId(input.affiliateNetwork) === "awin",
  ),
  notConfiguredProvider(
    "shopee",
    (input) => normalizeId(input.marketplace) === "shopee",
  ),
  notConfiguredProvider(
    "amazon",
    (input) => normalizeId(input.marketplace) === "amazon",
  ),
  notConfiguredProvider(
    "aliexpress",
    (input) => normalizeId(input.marketplace) === "aliexpress",
  ),
];