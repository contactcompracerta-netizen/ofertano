/**
 * CATALOG_WAVE 1 - APPROVED SOURCE GUARD (FASE F).
 *
 * Allowlist forte: somente os merchants da Wave 1 passam.
 * Qualquer outro advertiser => REJECT_UNAPPROVED_SOURCE.
 * Nenhuma escrita é possível sem passar por aqui.
 */
import type { AwinAdvertiserConfig } from "./advertisers";
import { getAdvertiser, isApprovedMerchant } from "./advertisers";

export interface ApprovedSourceResult {
  approved: true;
  advertiser: AwinAdvertiserConfig;
}

export interface RejectedSourceResult {
  approved: false;
  reason: "REJECT_UNAPPROVED_SOURCE";
  input: string;
}

export type SourceGuardResult = ApprovedSourceResult | RejectedSourceResult;

/**
 * Fontes explicitamente NÃO aprovadas (lista da missão "NÃO FAZER")
 * + marketplaces/plataformas que jamais entram por este importer AWIN.
 */
export const UNAPPROVED_SOURCES: readonly string[] = Object.freeze([
  "temu",
  "nike",
  "dafiti",
  "decor-colors",
  "granado",
  "phebo",
  "fut-fanatics",
  "eotica",
  "riachuelo",
  "decathlon",
  "adidas",
  "polishop",
  "vx-case",
  "shopee",
  "amazon",
  "mercado-livre",
  "aliexpress",
  "ml",
]);

/** Guarda principal: só merchants aprovados da Wave 1 são aceitos. */
export function approveAwinSource(merchant: string): SourceGuardResult {
  const slug = merchant.trim().toLowerCase();
  if (!isApprovedMerchant(slug)) {
    return { approved: false, reason: "REJECT_UNAPPROVED_SOURCE", input: merchant };
  }
  const advertiser = getAdvertiser(slug);
  if (!advertiser) {
    // Defesa em profundidade: aprovado mas sem config => rejeita.
    return { approved: false, reason: "REJECT_UNAPPROVED_SOURCE", input: merchant };
  }
  return { approved: true, advertiser };
}

export function isUnapprovedSource(merchant: string): boolean {
  const slug = merchant.trim().toLowerCase();
  if (isApprovedMerchant(slug)) return false;
  return true;
}

/** Sanity: nenhum nome da lista proibida pode constar como aprovado. */
export function assertNoForbiddenApprovedSource(): void {
  for (const forbidden of UNAPPROVED_SOURCES) {
    if (isApprovedMerchant(forbidden)) {
      throw new Error(`FORBIDDEN_SOURCE_APPROVED: ${forbidden}`);
    }
  }
}
