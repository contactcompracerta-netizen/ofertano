/**
 * CATALOG_ARCHITECTURE_V1 — DOUBLE HASH (FASE G).
 *
 * catalogHash: mudanças que justificam TRABALHO ESTRUTURAL
 *   (título relevante, brand, model, GTIN, MPN, atributos de variante,
 *    categoria, imagem principal quando aplicável, specs).
 *
 * offerHash: estado comercial
 *   (price, pixPrice, stock, availability, installments, promotion,
 *    shippingHint — estado comercial equivalente).
 *
 * Decisão do pipeline:
 *   catalogHash igual + offerHash mudou  => FAST OFFER PATH (sem matching pesado).
 *   catalogHash mudou                     => CATALOG/COLLECTION PATH (estrutural).
 *   ambos iguais                          => NOOP idempotente.
 *
 * Ambos são DETERMINÍSTICOS: mesmos campos de entrada produzem o mesmo hash,
 * independentemente da ordem de chaves de objeto ou de ruído cosmético.
 */

import { createHash } from "node:crypto";
import type { NormalizedMarketplaceListingV1 } from "./types/normalizedListingV1";

const HASH_ALGORITHM = "sha256";

/** Reordena entradas recursivamente e serializa de forma canônica e estável. */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "__undefined__";
  if (typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      // Preserva determinismo para valores numéricos não finitos.
      return String(value);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
}

function sha256Hex(input: string): string {
  return createHash(HASH_ALGORITHM).update(input, "utf8").digest("hex");
}

/** Normaliza texto: trim + colapsa espaços + lowercase (determinístico). */
export function normalizeHashText(value: string | null | undefined | object): string {
  if (value === null || value === undefined || value === "__UNKNOWN__") return "";
  if (typeof value === "object") return canonicalJson(value);
  return String(value).trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeStringArray(values: Array<string | null | undefined>): string[] {
  return values
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
}

/** Campos estruturais que participam do catalogHash. */
function catalogHashInput(brand: string, listing: NormalizedMarketplaceListingV1): string {
  const { identity, catalog, variant } = listing;
  const gtin = normalizeStringArray(identity.gtin);
  return canonicalJson({
    brand: normalizeHashText(identity.brand || brand),
    model: normalizeHashText(identity.model ?? identity.manufacturerModel ?? null),
    mpn: normalizeHashText(identity.mpn),
    gtin,
    category: normalizeHashText(catalog.category),
    title: normalizeHashText(catalog.title),
    variant: {
      color: normalizeHashText(variant.color),
      storage: normalizeHashText(variant.storage),
      memory: normalizeHashText(variant.memory),
      voltage: normalizeHashText(variant.voltage),
      size: normalizeHashText(variant.size),
      otherAttributes: variant.otherAttributes,
    },
    primaryImageUrl: normalizeHashText(catalog.primaryImageUrl),
    attributes: catalog.attributes,
  });
}

/** Campos comerciais que participam do offerHash. */
function offerHashInput(listing: NormalizedMarketplaceListingV1): string {
  const { commerce } = listing;
  return canonicalJson({
    price: commerce.price,
    oldPrice: commerce.oldPrice,
    pixPrice: commerce.pixPrice,
    stock: commerce.stock,
    availability:
      typeof commerce.availability === "string"
        ? commerce.availability
        : String(commerce.availability),
    installments: commerce.installments,
    promotion: normalizeHashText(commerce.promotion),
    shippingHint: normalizeHashText(commerce.shippingHint),
  });
}

/**
 * Catalog hash oficial.
 * `brandFallback` permite herdar a marca resolvida quando a fonte não informa
 * (ex.: herança do produto canônico) sem quebrar a determinismo.
 */
export function computeCatalogHash(
  listing: NormalizedMarketplaceListingV1,
  brandFallback = "",
): string {
  return sha256Hex(`catalog|v1|${catalogHashInput(brandFallback, listing)}`);
}

export function computeOfferHash(listing: NormalizedMarketplaceListingV1): string {
  return sha256Hex(`offer|v1|${offerHashInput(listing)}`);
}

/** Hash do payload bruto (FASE I — RAW REPROCESSABLE). */
export function computeRawHash(rawPayload: unknown): string {
  return sha256Hex(`raw|v1|${canonicalJson(rawPayload)}`);
}

export interface HashPairV1 {
  catalogHash: string;
  offerHash: string;
  rawHash: string;
}

export function computeHashPair(
  listing: NormalizedMarketplaceListingV1,
  rawPayload: unknown,
  brandFallback = "",
): HashPairV1 {
  return {
    catalogHash: computeCatalogHash(listing, brandFallback),
    offerHash: computeOfferHash(listing),
    rawHash: computeRawHash(rawPayload),
  };
}

export type HashComparisonDecisionV1 =
  | "STRUCTURAL"
  | "OFFER_ONLY"
  | "NOOP";

/**
 * Decide o caminho do pipeline (FASE H).
 *   catalogHash mudou        => STRUCTURAL (CATALOG / COLLECTION PATH)
 *   catalogHash igual        => offerHash mudou? OFFER_ONLY (FAST OFFER PATH)
 *   ambos iguais             => NOOP (idempotente)
 *
 * `previous` admite campos null: first-seen e listings sem hash calculado
 * (caminho shadow pré-V1) caem nas mesmas decisões fail-closed.
 */
export type PreviousHashPairV1 = {
  catalogHash?: string | null;
  offerHash?: string | null;
  rawHash?: string | null;
};

export function classifyHashChange(
  previous: PreviousHashPairV1 | null,
  current: HashPairV1,
): HashComparisonDecisionV1 {
  if (!previous?.catalogHash) return "STRUCTURAL";
  if (previous.catalogHash !== current.catalogHash) return "STRUCTURAL";
  if (!previous.offerHash || previous.offerHash !== current.offerHash) {
    return "OFFER_ONLY";
  }
  return "NOOP";
}

/** HashPair serializável para persistência (JSON). */
export function hashPairToJson(pair: HashPairV1): Record<string, string> {
  return {
    catalogHash: pair.catalogHash,
    offerHash: pair.offerHash,
    rawHash: pair.rawHash,
  };
}