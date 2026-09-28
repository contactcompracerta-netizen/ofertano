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

/**
 * Palavras-chave de coleta da Shopee.
 *
 * São termos de BUSCA da API de afiliados. Nada aqui e identidade de produto:
 * nenhum destes valores chega ao `IdentityPolicy`, porque o blocking key e
 * derivado do titulo que a FONTE devolve, nao da palavra que pedimos. Trocar
 * esta lista nao afrouxa nenhuma regra de identidade.
 *
 * POR QUE A LISTA E CURTA E A VARREDURA E FUNDA (medido, nao palpite):
 *
 * A API de afiliados e uma busca por RANKING, sem identificador estavel: a
 * ordem dos resultados muda entre chamadas, e reencontrar uma listagem
 * especifica depende de varrer fundo o suficiente. Medido nas 3 bindings
 * certificadas, com `pageSize=50`:
 *
 *     maxPages=1 -> 0/3    maxPages=2 -> 1/3    maxPages=4 -> 2/3
 *     maxPages=5 -> 3/3
 *
 * Com `pageSize=20` (padrao anterior) nenhuma das 3 era alcancavel em 5
 * paginas. Os termos amplos que existiam antes ("smartwatch", "power bank",
 * "teclado mecanico") foram medidos em 200 listings / 1129 pares candidatos /
 * 0 EXACT: a API nao expoe identidade estruturada, entao eles so custavam cota.
 * Ver `15-targeted-rediscovery.json`.
 *
 * Estes termos continuam valendo pelo caminho de DESCOBERTA e podem ser
 * reintroduzidos aqui a qualquer momento. Esta lista define o ALCANCE da
 * varredura, nunca o direito de publicar.
 */
export const SHOPEE_DEFAULT_KEYWORDS: readonly string[] = [
  // reencontram as associacoes ja certificadas (o refresh depende delas)
  "carregador 20w iphone tipo c",
  "fone xiaomi redmi buds",
  "mouse sem fio",
];

/** Profundidade de pagina que efetivamente alcanca as bindings certificadas. */
export const SHOPEE_REFRESH_PAGE_SIZE = 50;
export const SHOPEE_REFRESH_MAX_PAGES = 5;

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
    // Medido: e a unica combinacao testada que alcanca 3/3 bindings.
    pageSize: options.pageSize ?? SHOPEE_REFRESH_PAGE_SIZE,
    maxPages: options.maxPages ?? SHOPEE_REFRESH_MAX_PAGES,
  });

  return {
    marketplaceId: connector.marketplaceId,
    connector,
    purchaseLinks: SHOPEE_PURCHASE_LINKS,
    maxListings: options.maxListings,
    brandLexicon: options.brandLexicon,
  };
}
