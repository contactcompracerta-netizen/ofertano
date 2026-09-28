/**
 * CATALOG V1 — MAGALU PURCHASE LINKS (FASE 9.7/9.8).
 *
 * Adapter que sabe ler os links do payload bruto preservado pelo conector.
 * O conector Magalu preserva requestedUrl (affiliateLink) e finalUrl (sourceUrl).
 */
import type { PurchaseLinkSet, PurchaseLinkSource } from "@/services/architecture/v1/publicSync/types";

export interface MagaluPurchaseLinks extends PurchaseLinkSet {
  /** Link de afiliado (Magazine Você) */
  affiliateLink: string | null;
  /** URL do produto na vitrine */
  sourceUrl: string | null;
}

/** Extracao dos campos do payload bruto Magalu. */
export function extractMagaluPurchaseLinks(raw: unknown): MagaluPurchaseLinks {
  if (!raw || typeof raw !== "object") {
    return { affiliateLink: null, sourceUrl: null };
  }
  const payload = raw as Record<string, unknown>;
  return {
    affiliateLink: typeof payload.requestedUrl === "string" && payload.requestedUrl.trim() ? payload.requestedUrl : null,
    sourceUrl: typeof payload.finalUrl === "string" && payload.finalUrl.trim() ? payload.finalUrl : null,
  };
}

/** PurchaseLinkSource para o runner. */
export const MAGALU_PURCHASE_LINKS: PurchaseLinkSource = {
  extract: extractMagaluPurchaseLinks,
};
