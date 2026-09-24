/**
 * CATALOG_ARCHITECTURE_V1 — CATALOG PROJECTION (puro).
 *
 * Representa o resultado do CATALOG/COLLECTION PATH em forma pura e testável:
 * uma listing normalizada vira uma entrada de catálogo (CatalogProduct +
 * ProductVariant + Offer) sem depender do banco.
 *
 * A projeção NÃO substitui o caminho legado (saveProduct); ela documenta e
 * exercita o contrato da Architecture V1: o núcleo projeta a partir de
 * marketplaceId + identidade normalizada, nunca de nomes de marketplace.
 */

import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import { canonicalJson } from "../hashing";

export interface ProjectedOfferV1 {
  marketplaceId: string;
  externalListingId: string;
  sellerExternalId: string | null;
  price: number;
  oldPrice: number | null;
  stock: number | null;
  availability: string;
  offerHash: string;
}

export interface ProjectedVariantV1 {
  variantKey: string;
  color: string | null;
  storage: string | null;
  memory: string | null;
  voltage: string | null;
  size: string | null;
  otherAttributes: Record<string, string | number | boolean | string[] | null>;
}

export interface ProjectedCatalogEntryV1 {
  catalogKey: string;
  brand: string | null;
  model: string | null;
  gtin: string[];
  title: string | null;
  category: string | null;
  variant: ProjectedVariantV1;
  offer: ProjectedOfferV1;
  catalogHash: string;
}

export interface ProjectedVariantGroupV1 {
  catalogKey: string;
  variantKey: string;
  entries: ProjectedCatalogEntryV1[];
  offers: ProjectedOfferV1[];
}

/** Chave de variante determinística a partir dos atributos de variante. */
export function variantKeyFromListing(listing: NormalizedMarketplaceListingV1): string {
  const v = listing.variant;
  const parts = [v.color, v.storage, v.memory, v.voltage, v.size]
    .map((x) => (typeof x === "string" && x.trim() ? x.trim().toLowerCase() : ""))
    .filter(Boolean);
  const extra = Object.keys(v.otherAttributes).sort();
  const suffix = extra.map((k) => `${k}:${v.otherAttributes[k]}`).join("|");
  const core = parts.join(":");
  return `v1|${core}${suffix ? `|${suffix}` : ""}`;
}

/** Chave de catálogo determinística: identidade estrutural, não listing. */
export function catalogKeyFromListing(listing: NormalizedMarketplaceListingV1): string {
  const id = listing.identity;
  const gtin = [...id.gtin].sort();
  return canonicalJson({
    brand: typeof id.brand === "string" ? id.brand.trim().toLowerCase() : "",
    model: typeof id.model === "string"
      ? id.model.trim().toLowerCase()
      : typeof id.manufacturerModel === "string"
        ? id.manufacturerModel.trim().toLowerCase()
        : "",
    mpn: typeof id.mpn === "string" ? id.mpn.trim().toLowerCase() : "",
    gtin,
  });
}

/**
 * Projeta uma listing normalizada (já aceita pelo pipeline) numa entrada de
 * catálogo (Product-like + Variant-like + Offer-like).
 */
export function projectCatalogEntry(
  listing: NormalizedMarketplaceListingV1,
  catalogHash: string,
  offerHash: string,
): ProjectedCatalogEntryV1 {
  return {
    catalogKey: catalogKeyFromListing(listing),
    brand: typeof listing.identity.brand === "string" ? listing.identity.brand : null,
    model:
      typeof listing.identity.model === "string"
        ? listing.identity.model
        : typeof listing.identity.manufacturerModel === "string"
          ? listing.identity.manufacturerModel
          : null,
    gtin: listing.identity.gtin,
    title: typeof listing.catalog.title === "string" ? listing.catalog.title : null,
    category:
      typeof listing.catalog.category === "string" ? listing.catalog.category : null,
    variant: {
      variantKey: variantKeyFromListing(listing),
      color: typeof listing.variant.color === "string" ? listing.variant.color : null,
      storage: typeof listing.variant.storage === "string" ? listing.variant.storage : null,
      memory: typeof listing.variant.memory === "string" ? listing.variant.memory : null,
      voltage: typeof listing.variant.voltage === "string" ? listing.variant.voltage : null,
      size: typeof listing.variant.size === "string" ? listing.variant.size : null,
      otherAttributes: listing.variant.otherAttributes,
    },
    offer: {
      marketplaceId: listing.marketplaceId,
      externalListingId: listing.externalListingId,
      sellerExternalId:
        typeof listing.seller.externalSellerId === "string"
          ? listing.seller.externalSellerId
          : null,
      price: listing.commerce.price,
      oldPrice:
        typeof listing.commerce.oldPrice === "number" ? listing.commerce.oldPrice : null,
      stock: typeof listing.commerce.stock === "number" ? listing.commerce.stock : null,
      availability: listing.commerce.availability,
      offerHash,
    },
    catalogHash,
  };
}

/**
 * Agrupa entries por (catalogKey, variantKey) — o núcleo de multiloja
 * trabalha sobre esses grupos. Ofertas do MESMO marketplace contam 1.
 */
export function groupProjectedEntries(
  entries: ProjectedCatalogEntryV1[],
): ProjectedVariantGroupV1[] {
  const byKey = new Map<string, ProjectedCatalogEntryV1[]>();
  for (const entry of entries) {
    const k = `${entry.catalogKey}#${entry.variant.variantKey}`;
    const list = byKey.get(k) ?? [];
    list.push(entry);
    byKey.set(k, list);
  }
  return [...byKey.entries()].map(([k, groupEntries]) => {
    const [catalogKey, variantKey] = k.split("#");
    return {
      catalogKey,
      variantKey,
      entries: groupEntries,
      offers: groupEntries.map((e) => e.offer),
    };
  });
}