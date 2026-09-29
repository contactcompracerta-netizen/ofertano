/**
 * CATALOG V1 — ALIEXPRESS PURCHASE LINKS (FASE 12).
 *
 * Adapter que sabe ler `promotionLink` e `productDetailUrl` do payload bruto
 * preservado pelo `AliExpressMarketplaceConnector`.
 *
 * REGRA INEGOCIÁVEL: a API de afiliados JÁ ENTREGA o `promotion_link` pronto
 * (host `s.click.aliexpress.com`, com o tracking do app publisher). Esse é o
 * melhor link de afiliado possível e NUNCA é construído por concatenação aqui:
 * um link montado à mão seria um link de afiliado falso, e affiliate link
 * falso é perda de comissão silenciosa, não erro visível.
 *
 * `product_detail_url` é a `sourceUrl` — a página do anúncio, sem tracking.
 *
 * Se `promotion_link` vier ausente ou inseguro, o `resolvePurchaseLinks` do
 * core classifica como MISSING/INVALID e a oferta nova não é publicada. Uma
 * binding já certificada mantém o link anterior: o refresh nunca sobrescreve
 * um link válido com vazio.
 */
import { purchaseLinkSourceFromFields } from "@/services/architecture/v1/publicSync/purchaseLinks";

export const ALIEXPRESS_PURCHASE_LINKS = purchaseLinkSourceFromFields({
  affiliate: "promotionLink",
  source: "productDetailUrl",
});
