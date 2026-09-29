/**
 * CATALOG V1 — AMAZON PURCHASE LINKS (FASE 11).
 *
 * Adapter que sabe ler `affiliateLink` e `sourceUrl` do payload bruto
 * preservado pelo `AmazonMarketplaceConnector`.
 *
 * O conector Amazon preserva:
 *   - affiliateLink: link de afiliado já montado (com tag do env/fallback)
 *   - sourceUrl: URL canônica do produto (https://www.amazon.com.br/dp/<ASIN>)
 */
import { purchaseLinkSourceFromFields } from "@/services/architecture/v1/publicSync/purchaseLinks";

/**
 * Amazon: o payload bruto tem `affiliateLink` e `sourceUrl` diretamente.
 * Não há `offerLink`/`productLink` como na Shopee — o discovery/parser já
 * monta o link de afiliado no formato canônico.
 */
export const AMAZON_PURCHASE_LINKS = purchaseLinkSourceFromFields({
  affiliate: "affiliateLink",
  source: "sourceUrl",
});