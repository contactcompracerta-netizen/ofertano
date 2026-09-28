/**
 * CATALOG_ARCHITECTURE_V1 — SHOPEE NO PUBLIC SYNC (FASE 9).
 *
 * Configuração da Shopee como fonte do `MarketplacePublicSyncV1`.
 *
 * Este arquivo é o ÚNICO lugar do publicSync que conhece a Shopee. Ele
 * contém apenas o que é especificidade de FONTE:
 *   - o conector de coleta;
 *   - o adapter que sabe ler `offerLink`/`productLink` do payload bruto.
 *
 * Nenhuma regra de identidade, publicação ou preempto vive aqui. O core do
 * publicSync não é alterado para admitir a Shopee — a Shopee é admitida por
 * configuração, exatamente como Amazon será no futuro.
 */

import { ShopeeMarketplaceConnector } from "../../connectors/shopee/shopeeConnector";
import { purchaseLinkSourceFromFields } from "../purchaseLinks";
import type { PurchaseLinkSource, PublicSyncConfig } from "../types";

/**
 * Adapter de link de compra da Shopee.
 *
 * A API de afiliados devolve `offerLink` (link de afiliado) e `productLink`
 * (URL do produto) no payload bruto. O conector Shopee JÁ preserva esse payload
 * por `externalListingId`, então o writer lê os dois campos de lá — sem
 * alterar o contrato `NormalizedMarketplaceListingV1` para carregar URL
 * (FASE 9.8).
 */
export const SHOPEE_PURCHASE_LINKS: PurchaseLinkSource =
  purchaseLinkSourceFromFields({
    affiliate: "offerLink",
    source: "productLink",
  });

/** Palavras-chave genericas de coleta. */
export const SHOPEE_DEFAULT_KEYWORDS: readonly string[] = [
  "carregador iphone",
  "fone bluetooth",
  "mouse sem fio",
  "teclado mecanico",
  "smartwatch",
  "power bank",
  "fone de ouvido",
];

/**
 * Monta a configuracao do runner para a Shopee.
 * `maxListings` e o teto de canario desta execucao.
 */
export function shopeePublicSyncConfig(options: {
  keywords?: readonly string[];
  maxListings: number;
  brandLexicon: ReadonlySet<string>;
  pageSize?: number;
  maxPages?: number;
}): PublicSyncConfig {
  const connector = new ShopeeMarketplaceConnector({
    keywords: [...(options.keywords ?? SHOPEE_DEFAULT_KEYWORDS)],
    pageSize: options.pageSize ?? 20,
    maxPages: options.maxPages ?? 1,
  });

  return {
    marketplaceId: connector.marketplaceId,
    connector,
    purchaseLinks: SHOPEE_PURCHASE_LINKS,
    maxListings: options.maxListings,
    brandLexicon: options.brandLexicon,
  };
}
