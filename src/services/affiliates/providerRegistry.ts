import { awinProvider } from "./awinProvider";
import { notConfiguredProvider } from "../../lib/affiliate/providerUtils";

function normalizeId(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export const AFFILIATE_PROVIDER_REGISTRY: readonly (
  | import("./linkEngine").AffiliateProvider
)[] = [
  awinProvider,
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