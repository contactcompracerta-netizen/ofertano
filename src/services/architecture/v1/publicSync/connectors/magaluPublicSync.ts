/**
 * CATALOG V1 — MAGALU PUBLIC SYNC CONFIG (FASE 9).
 *
 * Factory que devolve a configuracao completa para o runner generico
 * runMarketplacePublicSync. Nao contem logica de negocio — so fio.
 *
 * O core NUNCA ve "magazine_luiza" hardcoded.
 */
import { createMagaluConnector, type MagaluConnectorOptions } from "@/services/architecture/v1/connectors/magaluConnector";
import { toSafeExternalUrl } from "@/services/architecture/v1/security/safeUrl";
import { MAGALU_PURCHASE_LINKS } from "./magaluPurchaseLinks";
import type { PublicSyncConfig } from "@/services/architecture/v1/publicSync/types";

/** Palavras-chave PROVAVELMENTE capazes de achar as 3 bindings certificadas.
 *  FASE 15: rediscovery DIRIGIDA — nomes de produtos cruzados reais. */
export const MAGALU_DEFAULT_KEYWORDS = [
  "mouse logitech m170",
  "fone bluetooth tws",
  "xiaomi redmi buds 6 play",
] as const;

/** Tamanho de pagina e max paginas (compatibilidade com interface Shopee). */
export const MAGALU_REFRESH_PAGE_SIZE = 50;
export const MAGALU_REFRESH_MAX_PAGES = 5;

/**
 * Monta a configuracao do runner para a Magazine Luiza.
 * `maxListings` e o teto de canario desta execucao.
 */
export function magaluPublicSyncConfig(options: {
  keywords?: readonly string[];
  maxListings: number;
  brandLexicon: ReadonlySet<string>;
  pageSize?: number;
  maxPages?: number;
}): PublicSyncConfig {
  const connectorOptions: MagaluConnectorOptions = {
    keywords: [...(options.keywords ?? MAGALU_DEFAULT_KEYWORDS)],
    pageSize: options.pageSize ?? MAGALU_REFRESH_PAGE_SIZE,
    maxPages: options.maxPages ?? MAGALU_REFRESH_MAX_PAGES,
  };
  const connector = createMagaluConnector(connectorOptions);

  return {
    marketplaceId: "magazine_luiza",
    connector,
    purchaseLinks: MAGALU_PURCHASE_LINKS,
    maxListings: options.maxListings,
    brandLexicon: options.brandLexicon,
  } satisfies PublicSyncConfig;
}
