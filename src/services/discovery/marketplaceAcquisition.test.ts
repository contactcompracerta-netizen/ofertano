import assert from "node:assert/strict";

import {
  classificarMensagemAquisicao,
  montarDiscoveryResult,
} from "./acquisitionOutcome";
import {
  classificarPaginaAmazon,
  criarCandidatos,
  criarLinkAfiliadoAmazon,
  extrairResultadosAmazonHtml,
} from "./amazon";
import {
  extrairIdProdutoAliExpress,
  obterPreco,
} from "./aliexpress";
import {
  classificarPaginaMagazineLuiza,
  criarUrlAfiliadaMagazineLuiza,
  criarUrlPublicaMagazineLuiza,
  extrairProdutosMagazineLuiza,
} from "./magazineluiza";
import {
  montarCandidatoShopee,
  normalizarImagemShopee,
  urlPublicaShopee,
} from "./shopee";
import type { ShopeeAffiliateOffer } from "@/services/importers/shopee/api";

assert.equal(classificarMensagemAquisicao("HTTP 403", 403), "BLOCKED");
assert.equal(
  classificarMensagemAquisicao("Amazon bloqueou temporariamente a busca HTML."),
  "BLOCKED",
);
assert.equal(
  classificarMensagemAquisicao("TIMEOUT: a busca ultrapassou 18 segundos."),
  "TIMEOUT",
);
assert.equal(
  classificarMensagemAquisicao("ALIEXPRESS_APP_KEY nao foi configurado."),
  "UNUSABLE",
);
assert.equal(
  classificarMensagemAquisicao("A variavel ALIEXPRESS_APP_KEY nao esta configurada."),
  "UNUSABLE",
);
assert.equal(
  classificarMensagemAquisicao("SHOPEE_AFFILIATE_APP_ID nao foi configurado."),
  "UNUSABLE",
);

const emptyValid = montarDiscoveryResult({
  marketplace: "SHOPEE",
  query: "iphone 16",
  candidates: [],
  scanned: 12,
  status: "EMPTY",
  sourcesTried: ["shopee-affiliate-api"],
});
assert.equal(emptyValid.success, true);
assert.equal(emptyValid.searchOutcome, "EMPTY_VALID");
assert.equal(emptyValid.error, null);

const blocked = montarDiscoveryResult({
  marketplace: "AMAZON",
  query: "iphone 16",
  candidates: [],
  scanned: 0,
  status: "BLOCKED",
  error: "captcha",
  sourcesTried: ["amazon-html"],
  blockedSources: ["amazon-html"],
});
assert.equal(blocked.success, false);
assert.equal(blocked.searchOutcome, "BLOCKED");

const amazonHtml = `
<div data-component-type="s-search-result" data-asin="B0TESTASIN">
  <h2><span>Apple iPhone 16 128GB Preto</span></h2>
  <img class="s-image" src="https://m.media-amazon.com/images/I/41uUYcqfLxL._AC_UL320_.jpg" />
  <span class="a-price"><span class="a-offscreen">R$ 4.999,00</span></span>
</div>
`;

const parsedAmazon = extrairResultadosAmazonHtml(amazonHtml);
assert.equal(parsedAmazon.length, 1);
assert.equal(parsedAmazon[0]?.asin, "B0TESTASIN");
assert.equal(parsedAmazon[0]?.extracted_price, 4999);
assert.ok(parsedAmazon[0]?.thumbnail?.includes("media-amazon.com"));

assert.equal(classificarPaginaAmazon("Digite os caracteres que voce ve abaixo", 200), "BLOCKED");
assert.equal(classificarPaginaAmazon(amazonHtml, 200), "SUCCESS");
assert.equal(classificarPaginaAmazon("<html><body>login wall</body></html>", 200), "UNUSABLE");

const previousTag = process.env.AMAZON_ASSOCIATE_TAG;
delete process.env.AMAZON_ASSOCIATE_TAG;
const affiliate = criarLinkAfiliadoAmazon("B0TESTASIN");
assert.ok(affiliate?.includes("tag=ofertano-20"));
assert.ok(affiliate?.startsWith("https://www.amazon.com.br/dp/B0TESTASIN"));
if (previousTag === undefined) {
  delete process.env.AMAZON_ASSOCIATE_TAG;
} else {
  process.env.AMAZON_ASSOCIATE_TAG = previousTag;
}

const amazonCandidates = criarCandidatos(parsedAmazon, "iphone 16", 5, true);
assert.equal(amazonCandidates.length, 1);
assert.equal(
  amazonCandidates[0]?.sourceUrl,
  "https://www.amazon.com.br/dp/B0TESTASIN",
);
assert.ok(amazonCandidates[0]?.affiliateLink);
assert.notEqual(
  amazonCandidates[0]?.sourceUrl,
  amazonCandidates[0]?.affiliateLink,
);

assert.equal(
  urlPublicaShopee(222, 111),
  "https://shopee.com.br/product/222/111",
);
assert.equal(
  normalizarImagemShopee("abcdeflmnopqrstuvxyz12"),
  "https://cf.shopee.com.br/file/abcdeflmnopqrstuvxyz12",
);

const shopeeOffer = {
  itemId: 111,
  shopId: 222,
  productName: "Smartphone Galaxy A55 128GB",
  shopName: "Loja Oficial",
  price: "1299,90",
  priceMin: "1299,90",
  priceMax: "1299,90",
  imageUrl: "abcdeflmnopqrstuvxyz12",
  productLink: "",
  offerLink: "https://s.shopee.com.br/abc123",
  ratingStar: "4.8",
  sales: 10,
  priceDiscountRate: 0,
  commissionRate: "1",
  commission: "1",
  appExistRate: "0",
  appNewRate: "0",
  webExistRate: "0",
  webNewRate: "0",
  periodStartTime: 0,
  periodEndTime: 0,
  productCatIds: [1],
  shopType: [1],
  sellerCommissionRate: "0",
  shopeeCommissionRate: "0",
} satisfies ShopeeAffiliateOffer;

const shopeeCandidate = montarCandidatoShopee(shopeeOffer);
assert.ok(shopeeCandidate);
assert.equal(shopeeCandidate.sourceUrl, "https://shopee.com.br/product/222/111");
assert.equal(shopeeCandidate.affiliateLink, "https://s.shopee.com.br/abc123");
assert.notEqual(shopeeCandidate.sourceUrl, shopeeCandidate.affiliateLink);
assert.equal(
  shopeeCandidate.image,
  "https://cf.shopee.com.br/file/abcdeflmnopqrstuvxyz12",
);

const shopeeSemAfiliado = montarCandidatoShopee({
  ...shopeeOffer,
  offerLink: "",
});
assert.ok(shopeeSemAfiliado);
assert.equal(shopeeSemAfiliado.sourceUrl, "https://shopee.com.br/product/222/111");
assert.equal(shopeeSemAfiliado.affiliateLink, null);

const magaluPath =
  "/magazineofertanobr/apple-iphone-16-128gb-preto/p/238803400/te/ip16/";
const magaluPublic = criarUrlPublicaMagazineLuiza(magaluPath);
const magaluAffiliate = criarUrlAfiliadaMagazineLuiza(magaluPath);
assert.equal(
  magaluPublic,
  "https://www.magazineluiza.com.br/apple-iphone-16-128gb-preto/p/238803400/te/ip16/",
);
assert.equal(
  magaluAffiliate,
  "https://www.magazinevoce.com.br/magazineofertanobr/apple-iphone-16-128gb-preto/p/238803400/te/ip16/",
);
assert.notEqual(magaluPublic, magaluAffiliate);

const magaluFromLuiza = criarUrlAfiliadaMagazineLuiza(
  "https://www.magazineluiza.com.br/apple-iphone-16-128gb-preto/p/238803400/te/ip16/",
);
assert.equal(
  magaluFromLuiza,
  "https://www.magazinevoce.com.br/magazineofertanobr/apple-iphone-16-128gb-preto/p/238803400/te/ip16/",
);

const fromPageProps = extrairProdutosMagazineLuiza({
  pageProps: {
    data: {
      search: {
        products: [{ id: "1", title: "iPhone 16", path: magaluPath }],
      },
    },
  },
});
assert.equal(fromPageProps?.length, 1);

const fromHtmlNextData = extrairProdutosMagazineLuiza({
  props: {
    pageProps: {
      data: {
        search: {
          products: [{ id: "2", title: "iPhone 16 Pro", path: magaluPath }],
        },
      },
    },
  },
});
assert.equal(fromHtmlNextData?.length, 1);
assert.equal(fromHtmlNextData?.[0]?.id, "2");

assert.equal(
  classificarPaginaMagazineLuiza("<html>captcha challenge</html>", 200),
  "BLOCKED",
);
assert.equal(classificarPaginaMagazineLuiza("<html>ok</html>", 403), "BLOCKED");

assert.equal(
  obterPreco({
    target_sale_price: "89.90",
  }),
  89.9,
);
assert.equal(
  obterPreco({
    sale_price: "120.00",
    sale_price_currency: "BRL",
  }),
  120,
);
assert.equal(
  extrairIdProdutoAliExpress({
    product_detail_url: "https://www.aliexpress.com/item/10050012345678.html",
  }),
  "10050012345678",
);
assert.equal(
  extrairIdProdutoAliExpress({
    product_id: "10050099988877",
    product_detail_url: "https://www.aliexpress.com/item/1.html",
  }),
  "10050099988877",
);

console.log("marketplace acquisition: todos os casos passaram");
