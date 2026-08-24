import assert from "node:assert/strict";

import {
  FALLBACK_GENERICO_MELI_LA,
  confirmarAffiliateLinkMercadoLivre,
  ehFallbackGenericoMeliLa,
  ehLinkAfiliadoConfirmadoMercadoLivre,
  encontrarOfertaMercadoLivreComAfiliadoConfirmado,
  resolverCompraPublica,
  resolverHrefCompraPublica,
  resolverHrefProprioOfertaPublica,
  type OfertaCompraPublica,
} from "./publicPurchase";

function oferta(
  input: Partial<OfertaCompraPublica> &
    Pick<OfertaCompraPublica, "id" | "marketplace">,
): OfertaCompraPublica {
  return {
    productId: input.productId ?? "prod-1",
    affiliateLink: input.affiliateLink ?? null,
    sourceUrl: input.sourceUrl ?? null,
    matchStatus: input.matchStatus ?? "EXACT",
    status: input.status ?? "ACTIVE",
    available: input.available ?? true,
    price: input.price ?? 100,
    ...input,
  };
}

const AFFILIATE_ML_CONFIRMADO = "https://meli.la/2qvdFzv";
const AFFILIATE_ML_SOCIAL =
  "https://www.mercadolivre.com.br/social/ofertano?matt_word=ofertano";
const SOURCE_MLB_COMUM =
  "https://produto.mercadolivre.com.br/MLB-1234567890-smartphone-_JM";
const AFFILIATE_AMAZON =
  "https://www.amazon.com.br/dp/B00TEST123?tag=ofertano-20";

assert.equal(ehFallbackGenericoMeliLa(FALLBACK_GENERICO_MELI_LA), true);
assert.equal(
  ehFallbackGenericoMeliLa("https://meli.la/1i7Te2C/"),
  true,
);
assert.equal(ehFallbackGenericoMeliLa(AFFILIATE_ML_CONFIRMADO), false);
assert.equal(
  ehLinkAfiliadoConfirmadoMercadoLivre(AFFILIATE_ML_CONFIRMADO),
  true,
);
assert.equal(
  ehLinkAfiliadoConfirmadoMercadoLivre(AFFILIATE_ML_SOCIAL),
  true,
);
assert.equal(ehLinkAfiliadoConfirmadoMercadoLivre(SOURCE_MLB_COMUM), false);
assert.equal(
  ehLinkAfiliadoConfirmadoMercadoLivre(FALLBACK_GENERICO_MELI_LA),
  false,
);

const mlComAfiliado = oferta({
  id: "ml-com-afiliado",
  marketplace: "MERCADO_LIVRE",
  affiliateLink: AFFILIATE_ML_CONFIRMADO,
  sourceUrl: SOURCE_MLB_COMUM,
  price: 1299,
});

const compraConfirmada = resolverCompraPublica({
  store: "Mercado Livre",
  affiliateLink: SOURCE_MLB_COMUM,
  ofertas: [mlComAfiliado],
});

assert.equal(
  compraConfirmada.hrefPorOfertaId[mlComAfiliado.id],
  AFFILIATE_ML_CONFIRMADO,
  "1. ML com affiliateLink confirmado deve usar o affiliateLink no botão.",
);
assert.equal(compraConfirmada.linkPrincipal, AFFILIATE_ML_CONFIRMADO);
assert.equal(compraConfirmada.ofertaPrincipal?.id, mlComAfiliado.id);
assert.notEqual(
  compraConfirmada.linkPrincipal,
  SOURCE_MLB_COMUM,
  "1. sourceUrl comum não pode substituir o affiliateLink confirmado.",
);

const mlSoSourceUrl = oferta({
  id: "ml-source-only",
  marketplace: "MERCADO_LIVRE",
  affiliateLink: null,
  sourceUrl: SOURCE_MLB_COMUM,
  price: 899,
});

const compraSourceUrl = resolverCompraPublica({
  store: "Mercado Livre",
  affiliateLink: SOURCE_MLB_COMUM,
  ofertas: [mlSoSourceUrl],
});

assert.equal(
  compraSourceUrl.hrefPorOfertaId[mlSoSourceUrl.id],
  null,
  "2. ML com sourceUrl e affiliateLink null não vira link monetizado.",
);
assert.equal(
  confirmarAffiliateLinkMercadoLivre(mlSoSourceUrl),
  null,
);
assert.notEqual(compraSourceUrl.linkPrincipal, SOURCE_MLB_COMUM);
assert.equal(
  resolverHrefCompraPublica(mlSoSourceUrl, [mlSoSourceUrl]),
  null,
  "2. sourceUrl não pode ser promovida a href de compra.",
);

const mlSourceComoAfiliado = oferta({
  id: "ml-source-as-affiliate",
  marketplace: "MERCADO_LIVRE",
  affiliateLink: SOURCE_MLB_COMUM,
  sourceUrl: SOURCE_MLB_COMUM,
  price: 910,
});

assert.equal(
  confirmarAffiliateLinkMercadoLivre(mlSourceComoAfiliado),
  null,
  "2. Copiar sourceUrl para affiliateLink ainda não monetiza a oferta.",
);

const mlFallbackGenerico = oferta({
  id: "ml-fallback",
  marketplace: "MERCADO_LIVRE",
  affiliateLink: FALLBACK_GENERICO_MELI_LA,
  sourceUrl: SOURCE_MLB_COMUM,
  price: 777,
});

const compraFallback = resolverCompraPublica({
  store: "Mercado Livre",
  affiliateLink: FALLBACK_GENERICO_MELI_LA,
  ofertas: [mlFallbackGenerico],
});

assert.equal(
  compraFallback.hrefPorOfertaId[mlFallbackGenerico.id],
  null,
  "3. Fallback genérico meli.la não é oferta válida.",
);
assert.equal(compraFallback.linkPrincipal, "");
assert.equal(compraFallback.ofertaPrincipal, null);
assert.equal(
  ehLinkAfiliadoConfirmadoMercadoLivre("https://meli.la/1i7Te2C"),
  false,
);

const mlSemAfiliado = oferta({
  id: "ml-a",
  marketplace: "MERCADO_LIVRE",
  affiliateLink: null,
  sourceUrl: SOURCE_MLB_COMUM,
  price: 500,
});

const mlComAfiliadoIrmao = oferta({
  id: "ml-b",
  marketplace: "MERCADO_LIVRE",
  affiliateLink: AFFILIATE_ML_CONFIRMADO,
  sourceUrl: "https://www.mercadolivre.com.br/MLB-999888777",
  price: 650,
});

const compraIrmas = resolverCompraPublica({
  store: "Mercado Livre",
  affiliateLink: "",
  ofertas: [mlSemAfiliado, mlComAfiliadoIrmao],
});

assert.equal(
  compraIrmas.ofertaPrincipal?.id,
  mlComAfiliadoIrmao.id,
  "4. Entre duas ofertas ML do mesmo Product, preferir a que tem affiliateLink válido.",
);
assert.equal(compraIrmas.linkPrincipal, AFFILIATE_ML_CONFIRMADO);
assert.equal(compraIrmas.hrefPorOfertaId[mlSemAfiliado.id], null);
assert.equal(
  compraIrmas.hrefPorOfertaId[mlComAfiliadoIrmao.id],
  AFFILIATE_ML_CONFIRMADO,
);
assert.equal(
  resolverHrefProprioOfertaPublica(mlSemAfiliado),
  null,
  "4. Linha de A usa somente href próprio: sem affiliateLink confirmado, fica null.",
);
assert.equal(
  resolverHrefProprioOfertaPublica(mlComAfiliadoIrmao),
  AFFILIATE_ML_CONFIRMADO,
  "4. Linha de B usa o affiliateLink próprio de B.",
);
assert.equal(
  encontrarOfertaMercadoLivreComAfiliadoConfirmado(
    [mlSemAfiliado, mlComAfiliadoIrmao],
    mlSemAfiliado,
  )?.id,
  mlComAfiliadoIrmao.id,
);
assert.equal(
  resolverHrefCompraPublica(mlSemAfiliado, [mlSemAfiliado, mlComAfiliadoIrmao]),
  AFFILIATE_ML_CONFIRMADO,
  "4. Se A não tem afiliado, o href de compra do Product usa o affiliateLink de B.",
);
assert.notEqual(
  resolverHrefCompraPublica(mlSemAfiliado, [mlSemAfiliado, mlComAfiliadoIrmao]),
  SOURCE_MLB_COMUM,
);
assert.notEqual(
  compraIrmas.hrefPorOfertaId[mlSemAfiliado.id],
  resolverHrefCompraPublica(mlSemAfiliado, [mlSemAfiliado, mlComAfiliadoIrmao]),
  "4. A linha individual nunca troca silenciosamente para a oferta irmã.",
);

const amazonValida = oferta({
  id: "amz-1",
  marketplace: "AMAZON",
  affiliateLink: AFFILIATE_AMAZON,
  sourceUrl: "https://www.amazon.com.br/dp/B00TEST123",
  price: 1099,
});

const compraAmazon = resolverCompraPublica({
  store: "Mercado Livre",
  affiliateLink: SOURCE_MLB_COMUM,
  ofertas: [mlSoSourceUrl, amazonValida],
});

assert.equal(
  compraAmazon.ofertaPrincipal?.id,
  amazonValida.id,
  "5. ML sem afiliado não impede a Amazon válida.",
);
assert.equal(compraAmazon.linkPrincipal, AFFILIATE_AMAZON);
assert.equal(compraAmazon.hrefPorOfertaId[amazonValida.id], AFFILIATE_AMAZON);
assert.equal(compraAmazon.hrefPorOfertaId[mlSoSourceUrl.id], null);

const shopeeValida = oferta({
  id: "shopee-1",
  marketplace: "SHOPEE",
  affiliateLink: "https://shopee.com.br/affiliate/item-1",
  price: 88,
});

const compraOutrasLojas = resolverCompraPublica({
  store: "Shopee",
  affiliateLink: "https://shopee.com.br/affiliate/item-1",
  ofertas: [mlSoSourceUrl, shopeeValida],
});

assert.equal(compraOutrasLojas.ofertaPrincipal?.id, shopeeValida.id);
assert.equal(
  compraOutrasLojas.hrefPorOfertaId[shopeeValida.id],
  "https://shopee.com.br/affiliate/item-1",
);

const compraSemMlMonetizavel = resolverCompraPublica({
  store: "Mercado Livre",
  affiliateLink: SOURCE_MLB_COMUM,
  ofertas: [mlSoSourceUrl, mlFallbackGenerico],
});

assert.equal(
  compraSemMlMonetizavel.ofertaPrincipal,
  null,
  "6. Sem oferta ML monetizável, não fabricar link principal.",
);
assert.equal(compraSemMlMonetizavel.linkPrincipal, "");
assert.equal(
  compraSemMlMonetizavel.hrefPorOfertaId[mlSoSourceUrl.id],
  null,
);
assert.equal(
  compraSemMlMonetizavel.hrefPorOfertaId[mlFallbackGenerico.id],
  null,
);
assert.doesNotThrow(() => {
  resolverCompraPublica({
    store: "Mercado Livre",
    affiliateLink: "",
    ofertas: [],
  });
}, "6. Página não quebra sem ofertas ML monetizáveis.");

const produtoDiferente = oferta({
  id: "ml-other-product",
  productId: "prod-2",
  marketplace: "MERCADO_LIVRE",
  affiliateLink: AFFILIATE_ML_CONFIRMADO,
  price: 10,
});

assert.equal(
  resolverHrefCompraPublica(mlSoSourceUrl, [mlSoSourceUrl, produtoDiferente]),
  null,
  "Não escolher Product diferente para completar o affiliateLink.",
);
assert.equal(
  resolverHrefProprioOfertaPublica(mlSoSourceUrl),
  null,
  "sourceUrl nunca vira href próprio da oferta.",
);
assert.equal(
  resolverHrefProprioOfertaPublica(mlSourceComoAfiliado),
  null,
  "Copiar sourceUrl para affiliateLink ainda não vira href próprio.",
);
assert.equal(
  resolverHrefProprioOfertaPublica(mlFallbackGenerico),
  null,
  "meli.la genérico nunca vira href próprio nem de compra.",
);
assert.equal(
  resolverHrefProprioOfertaPublica(amazonValida),
  AFFILIATE_AMAZON,
);
assert.equal(
  resolverHrefProprioOfertaPublica(shopeeValida),
  "https://shopee.com.br/affiliate/item-1",
);

console.log("publicPurchase.test.ts ok");
