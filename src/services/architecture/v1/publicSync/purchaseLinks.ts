/**
 * CATALOG_ARCHITECTURE_V1 — RESOLUÇÃO DE LINKS DE COMPRA (FASE 9.7 / 9.8).
 *
 * Decide os dois links que uma oferta pública carrega:
 *   affiliateLink ← `offerLink`  (link de afiliado da fonte)
 *   sourceUrl     ← `productLink` (URL do produto na fonte)
 *
 * REGRAS INEGOCIÁVEIS:
 *   1. NUNCA fabricar URL.
 *   2. NUNCA montar URL por concatenação de string.
 *   3. NUNCA aceitar esquema fora de http/https (repassa a
 *      `toSafeExternalUrl`, a mesma segurança já certificada no core).
 *   4. offerLink ausente NÃO é motivo para inventar um link de afiliado:
 *      a oferta é apenas classificada como sem link de afiliado.
 *
 * O reader recebe o payload BRUTO preservado pelo conector. O contrato
 * normalizado (`NormalizedMarketplaceListingV1`) NÃO é alterado para carregar
 * URL — a peculiaridade fica no adapter, como a FASE 9.8 pede.
 */

import { toSafeExternalUrl } from "../security/safeUrl";
import type { PurchaseLinkSet, PurchaseLinkSource } from "./types";

export type ResolvedLinkState = "SAFE" | "MISSING" | "INVALID";

export interface ResolvedPurchaseLinks {
  affiliateLink: string | null;
  sourceUrl: string | null;
  affiliateState: ResolvedLinkState;
  sourceState: ResolvedLinkState;
  /** Motivo de rejeição, quando houver (diagnóstico). */
  affiliateReason: string | null;
  sourceReason: string | null;
  /** true quando a oferta tem link de afiliado publicável. */
  hasAffiliateLink: boolean;
}

/**
 * Resolve um par de links. Apply a MESMA política de segurança do core.
 * Um link rejeitado simplesmente não é persistido — nunca é substituído.
 */
export function resolvePurchaseLinks(raw: PurchaseLinkSet): ResolvedPurchaseLinks {
  const affiliate = toSafeExternalUrl(raw.affiliateLink);
  const source = toSafeExternalUrl(raw.sourceUrl);

  const affiliateState: ResolvedLinkState = !raw.affiliateLink
    ? "MISSING"
    : affiliate.ok
      ? "SAFE"
      : "INVALID";
  const sourceState: ResolvedLinkState = !raw.sourceUrl
    ? "MISSING"
    : source.ok
      ? "SAFE"
      : "INVALID";

  const affiliateLink = affiliate.ok ? affiliate.url : null;
  const sourceUrl = source.ok ? source.url : null;

  return {
    affiliateLink,
    sourceUrl,
    affiliateState,
    sourceState,
    affiliateReason: affiliate.ok ? null : (raw.affiliateLink ? affiliate.reason : "MISSING"),
    sourceReason: source.ok ? null : (raw.sourceUrl ? source.reason : "MISSING"),
    hasAffiliateLink: affiliateLink !== null,
  };
}

/**
 * Chamado quando o conector NÃO preserva payload bruto (o adapter não
 * encontrou a listing). Não há link a resolver — e nenhuma URL é inventada.
 */
export function noPurchaseLinks(): ResolvedPurchaseLinks {
  return {
    affiliateLink: null,
    sourceUrl: null,
    affiliateState: "MISSING",
    sourceState: "MISSING",
    affiliateReason: "RAW_PAYLOAD_UNAVAILABLE",
    sourceReason: "RAW_PAYLOAD_UNAVAILABLE",
    hasAffiliateLink: false,
  };
}

/** Lê um campo do payload bruto aceitando apenas string não vazia. */
function readString(raw: Record<string, unknown>, field: string): string | null {
  const value = raw[field];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Cria um `PurchaseLinkSource` a partir de uma declaracao de campos.
 * É o adapter de fonte: o core pede `extract(raw)` e não sabe de onde
 * vieram `offerLink`/`productLink`.
 */
export function purchaseLinkSourceFromFields(fields: {
  affiliate: string;
  source: string;
}): PurchaseLinkSource {
  return {
    extract(rawPayload: unknown): PurchaseLinkSet {
      if (!rawPayload || typeof rawPayload !== "object") {
        return { affiliateLink: null, sourceUrl: null };
      }
      const raw = rawPayload as Record<string, unknown>;
      return {
        affiliateLink: readString(raw, fields.affiliate),
        sourceUrl: readString(raw, fields.source),
      };
    },
  };
}
