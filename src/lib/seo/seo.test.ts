import assert from "node:assert/strict";

import {
  buildAggregateOffer,
  buildProductBreadcrumbData,
  buildProductMetadata,
  buildProductStructuredData,
  createProductDescription,
  isDescriptionInvalid,
  isProductIndexable,
  normalizeAbsoluteUrl,
  sanitizeBrand,
  sanitizeProductTitle,
  cleanBrandBoilerplate,
  type ProductSeoInput,
} from "./product";
import { serializeJsonLd } from "./serialize";
import { siteUrl } from "./site";
import {
  ROTAS_ESTATICAS_PUBLICAS,
  ROTAS_PRIVADAS_EXCLUIDAS,
  rotaPrivadaExcluidaDoSitemap,
} from "./sitemapRoutes";
import { buildWebSiteStructuredData } from "./website";

import {
  hasPublicMultiStore,
  isUsablePublicOffer,
} from "../../services/publicVisibility/multiStoreVisibility";

import Module from "node:module";

import robots from "../../app/robots";
import { metadata as loginMetadata } from "../../app/login/layout";
import { metadata as favoritosMetadata } from "../../app/favoritos/layout";
import { metadata as recuperarSenhaMetadata } from "../../app/recuperar-senha/layout";
import { legacyBlogPosts } from "../../app/blog/posts";

/*
 * /admin/layout.tsx importa um CSS module (via AdminNav). O tsx não sabe
 * lidar com CSS, então registramos um stub para .css ANTES de carregar a
 * metadata real de admin dinamicamente (ver checarAdminNoindex abaixo).
 */
Module._extensions[".css"] = (mod: NodeModule) => {
  mod.exports = {};
};

const produtoReal: ProductSeoInput = {
  id: "product-exemplo",
  name: "Smartphone Exemplo X 128GB",
  description: "Um smartphone fictício usado apenas em testes de SEO.",
  image: "https://img.example/produto.jpg",
  images: [],
  active: true,
  publicationStatus: "PUBLISHED",
  brand: "Exemplo",
  offers: [
    { marketplace: "Mercado Livre", price: 1899, available: true },
    { marketplace: "Amazon", price: 1750, available: true },
  ],
};

// ---- SEO_ROBOTS_EXISTS ---------------------------------------------------
{
  const robo = robots();
  assert.ok(robo, "robots.ts deve exportar uma configuração.");
  assert.ok(
    Array.isArray(robo.rules) && robo.rules.length > 0,
    "robots deve ter regras.",
  );
  assert.equal(
    robo.sitemap,
    "https://ofertano.vercel.app/sitemap.xml",
    "robots deve apontar o sitemap absoluto fixo.",
  );
}
console.log("SEO_ROBOTS_EXISTS=PASS");

// ---- SEO_LOGIN_NOINDEX ------------------------------------------------------
{
  assert.ok(loginMetadata.robots, "login deve ter robots.");
  assert.equal(loginMetadata.robots!.index, false);
  assert.equal(loginMetadata.robots!.follow, false);
}
console.log("SEO_LOGIN_NOINDEX=PASS");

// ---- SEO_FAVORITES_NOINDEX --------------------------------------------------
{
  assert.ok(favoritosMetadata.robots, "favoritos deve ter robots.");
  assert.equal(favoritosMetadata.robots!.index, false);
  assert.equal(favoritosMetadata.robots!.follow, false);
}
console.log("SEO_FAVORITES_NOINDEX=PASS");

// ---- recuperar-senha também noindex ----------------------------------------
{
  assert.ok(recuperarSenhaMetadata.robots, "recuperar-senha deve ter robots.");
  assert.equal(recuperarSenhaMetadata.robots!.index, false);
  assert.equal(recuperarSenhaMetadata.robots!.follow, false);
}
console.log("SEO_RECUPERAR_SENHA_NOINDEX=PASS");

// ---- SEO_SITEMAP_EXISTS -----------------------------------------------------
{
  assert.ok(
    ROTAS_ESTATICAS_PUBLICAS.includes("/"),
    "O sitemap deve incluir a home.",
  );
  assert.ok(
    ROTAS_ESTATICAS_PUBLICAS.includes("/categorias"),
    "O sitemap deve incluir categorias.",
  );
  assert.ok(
    ROTAS_ESTATICAS_PUBLICAS.includes("/ofertas"),
    "O sitemap deve incluir ofertas.",
  );
  assert.ok(
    ROTAS_ESTATICAS_PUBLICAS.includes("/blog"),
    "O sitemap deve incluir o blog.",
  );
}
console.log("SEO_SITEMAP_EXISTS=PASS");

// ---- SEO_SITEMAP_EXCLUDES_PRIVATE_ROUTES ------------------------------------
{
  const proibidas = ROTAS_PRIVADAS_EXCLUIDAS.map((rota) =>
    rota.replace(/^\/+/, ""),
  );

  for (const rota of ROTAS_ESTATICAS_PUBLICAS) {
    const normalizada = rota.replace(/^\/+/, "");
    assert.equal(
      proibidas.some(
        (p) => normalizada === p || normalizada.startsWith(`${p}/`),
      ),
      false,
      `Rota pública "${rota}" não pode ser uma rota privada.`,
    );
  }

  assert.equal(rotaPrivadaExcluidaDoSitemap("/login"), true);
  assert.equal(rotaPrivadaExcluidaDoSitemap("/favoritos"), true);
  assert.equal(rotaPrivadaExcluidaDoSitemap("/recuperar-senha"), true);
  assert.equal(rotaPrivadaExcluidaDoSitemap("/api/whatever"), true);
  assert.equal(rotaPrivadaExcluidaDoSitemap("/"), false);
  assert.equal(rotaPrivadaExcluidaDoSitemap("/ofertas"), false);
}
console.log("SEO_SITEMAP_EXCLUDES_PRIVATE_ROUTES=PASS");

// ---- SEO_SITEMAP_PUBLIC_ONLY (regra Multi Loja reutilizada) ------------------
{
  const soUmaLoja = [
    { marketplace: "Mercado Livre", price: 100, available: true },
    { marketplace: "Mercado Livre", price: 120, available: true },
  ];
  assert.equal(
    hasPublicMultiStore(soUmaLoja),
    false,
    "Duas ofertas do mesmo marketplace não são Multi Loja.",
  );

  const multiLoja = [
    { marketplace: "Mercado Livre", price: 100, available: true },
    { marketplace: "Amazon", price: 110, available: true },
  ];
  assert.equal(hasPublicMultiStore(multiLoja), true, "2 marketplaces = público.");

  const ofertaInvalida = [
    { marketplace: "Mercado Livre", price: 100, available: true },
    { marketplace: "Amazon", price: 0, available: true, status: "ERROR" },
  ];
  assert.equal(
    hasPublicMultiStore(ofertaInvalida as never),
    false,
    "Oferta inválida não pode contar para o Multi Loja.",
  );

  assert.equal(
    isUsablePublicOffer({
      marketplace: "Amazon",
      active: true,
      available: true,
      status: "AVAILABLE",
      matchStatus: "EXACT",
      price: 10,
    }),
    true,
  );
  assert.equal(
    isUsablePublicOffer({
      marketplace: "Amazon",
      active: true,
      available: true,
      status: "UNAVAILABLE",
      matchStatus: "EXACT",
      price: 10,
    }),
    false,
  );
}
console.log("SEO_SITEMAP_PUBLIC_ONLY=PASS");

// ---- SEO_BLOG_FALLBACK (sitemap read-only, fallback legado) ---------------------
{
  assert.ok(
    Array.isArray(legacyBlogPosts) && legacyBlogPosts.length > 0,
    "Fallback legado do blog deve existir para falha de leitura.",
  );
  assert.ok(
    legacyBlogPosts.every(
      (post) => typeof post.slug === "string" && post.slug.length > 0,
    ),
    "Posts legados devem ter slug válido para compor URLs do sitemap.",
  );
}
console.log("SEO_BLOG_FALLBACK=PASS");

// ---- SEO_PRODUCT_METADATA -----------------------------------------------------
{
  const metadata = buildProductMetadata(produtoReal);
  assert.equal(metadata.title, produtoReal.name);
  assert.ok(metadata.description, "Produto público deve ter description.");
}
console.log("SEO_PRODUCT_METADATA=PASS");

// ---- FASE 8 - NOVOS TESTES OBRIGATÓRIOS -------------------------------------
{
  // SEO_DESCRIPTION_REJECTS
  assert.equal(isDescriptionInvalid("3070218200"), true);
  assert.equal(isDescriptionInvalid("B07CXTZ2KS"), true);
  assert.equal(isDescriptionInvalid("HTTP://EXAMPLE.COM"), true);
  assert.equal(isDescriptionInvalid("!!!"), true);
  assert.equal(isDescriptionInvalid(""), true);
  assert.equal(isDescriptionInvalid("null"), true);

  // SEO_DESCRIPTION_ACCEPTS_REAL_TEXT
  assert.equal(isDescriptionInvalid("Chave de fenda em aço cromo vanádio com ponta magnetizada."), false);
  assert.equal(isDescriptionInvalid("Novo"), false);
  assert.equal(isDescriptionInvalid("4K"), false);
  assert.equal(isDescriptionInvalid("Motorola"), false);
  assert.equal(isDescriptionInvalid("WD-40"), false);

  // SEO_DESCRIPTION_FALLBACK
  const fallback = createProductDescription("Produto X", "3070218200");
  assert.match(fallback, /Compare o preço de Produto X/, "Deve gerar fallback com nome.");
  assert.ok(fallback.length <= 180, "Fallback <= 180 chars.");
  assert.equal(fallback.includes("disponíveis"), false, "Fallback não deve conter palavra proibida.");

  // SEO_DESCRIPTION_SEMANTIC_REDUNDANCY
  assert.equal(createProductDescription("Notebook Lenovo,", "Notebook Lenovo."), `Compare o preço de Notebook Lenovo no Ofertano e confira ofertas em diferentes lojas parceiras.`);
  assert.equal(createProductDescription("Notebook Lenovo", "  notebook   lenovo  "), `Compare o preço de Notebook Lenovo no Ofertano e confira ofertas em diferentes lojas parceiras.`);

  // SEO_TITLE_CLEANUP
  assert.equal(sanitizeProductTitle("Produto,   "), "Produto");
  assert.equal(sanitizeProductTitle("TV\nSamsung"), "TV Samsung");
  assert.equal(sanitizeProductTitle("Produto... edição 2026"), "Produto... edição 2026");
  assert.equal(sanitizeProductTitle("Produto!!!"), "Produto!");
  assert.equal(sanitizeProductTitle("Vonder, Chave , De Fenda"), "Vonder, Chave, De Fenda");

  // SEO_BRAND_REJECTS
  assert.equal(sanitizeBrand("Amazon"), null);
  assert.equal(sanitizeBrand("Motorola"), "Motorola");
  assert.equal(sanitizeBrand("Forever21"), "Forever21");
  assert.equal(sanitizeBrand("PlayStation5"), "PlayStation5");
  assert.equal(sanitizeBrand("3M"), "3M");
  assert.equal(sanitizeBrand("WD-40"), "WD-40");
  assert.equal(sanitizeBrand("B07CXTZ2KS"), null);
  assert.equal(sanitizeBrand("sku123456"), null);
  assert.equal(sanitizeBrand("abc123def456"), null);

  // SEO_BRAND_BOILERPLATE_REMOVAL
  assert.equal(cleanBrandBoilerplate("Visite a loja Positivo"), "Positivo");
  assert.equal(cleanBrandBoilerplate("Visite a loja da VONDER"), "VONDER");
  assert.equal(cleanBrandBoilerplate("Marca: Motorola"), "Motorola");
  assert.equal(cleanBrandBoilerplate("Positivo"), "Positivo");
  assert.equal(cleanBrandBoilerplate("Vonder"), "Vonder");
  assert.equal(cleanBrandBoilerplate("Motorola"), "Motorola");
  assert.equal(cleanBrandBoilerplate("Positivo Visite a loja"), "Positivo Visite a loja");
  assert.equal(cleanBrandBoilerplate("Marca Positivo"), "Marca Positivo");

  // SEO_SANITIZE_BRAND_WITH_BOILERPLATE
  assert.equal(sanitizeBrand("Visite a loja Positivo"), "Positivo");
  assert.equal(sanitizeBrand("Visite a loja da VONDER"), "VONDER");
  assert.equal(sanitizeBrand("Marca: Motorola"), "Motorola");
  assert.equal(sanitizeBrand("Positivo"), "Positivo");
  assert.equal(sanitizeBrand("3M"), "3M");
  assert.equal(sanitizeBrand("WD-40"), "WD-40");
  assert.equal(sanitizeBrand("Amazon"), null);
}
console.log("SEO_FASE_8_TESTES_PASS=PASS");
// ---- SEO_PRODUCT_CANONICAL ----------------------------------------------------
{
  const metadata = buildProductMetadata(produtoReal);
  assert.equal(
    metadata.alternates?.canonical,
    `https://ofertano.vercel.app/produto/${produtoReal.id}`,
  );
}
console.log("SEO_PRODUCT_CANONICAL=PASS");

// ---- SEO_PRODUCT_JSONLD -------------------------------------------------------
{
  const jsonLd = buildProductStructuredData(produtoReal);
  assert.ok(jsonLd, "Produto público deve ter JSON-LD.");
  const dados = jsonLd as Record<string, unknown>;
  assert.equal(dados["@type"], "Product");
  assert.equal(dados.name, produtoReal.name);
  assert.equal(dados.url, siteUrl(`/produto/${produtoReal.id}`));
}
console.log("SEO_PRODUCT_JSONLD=PASS");

// ---- SEO_NO_FAKE_RATING -------------------------------------------------------
{
  const jsonLd = buildProductStructuredData(produtoReal);
  const serializado = serializeJsonLd(jsonLd).toLowerCase();
  for (const proibido of [
    "availability",
    "aggregaterating",
    "ratingvalue",
    "reviewcount",
    "review",
    "gtin",
    "sku",
    "mpn",
    "pricevaliduntil",
    "bestrating",
    "worstrating",
  ]) {
    assert.equal(
      serializado.includes(proibido),
      false,
      `JSON-LD não pode conter "${proibido}" inventado.`,
    );
  }
}
console.log("SEO_NO_FAKE_RATING=PASS");

// ---- SEO_AGGREGATE_OFFER_REAL_PRICES ------------------------------------------
{
  const agregado = buildAggregateOffer([
    { marketplace: "Mercado Livre", price: 1899, available: true },
    { marketplace: "Amazon", price: 1750, available: true },
    { marketplace: "Shopee", price: 0, available: true },
    { marketplace: "AliExpress", price: 999, available: false },
  ]);

  assert.ok(agregado, "Deve gerar AggregateOffer com ofertas válidas.");
  assert.equal(agregado!.priceCurrency, "BRL");
  assert.equal(agregado!.lowPrice, 1750, "lowPrice deve ser o mínimo real.");
  assert.equal(agregado!.highPrice, 1899, "highPrice deve ser o máximo real.");
  assert.equal(agregado!.offerCount, 2, "Ofertas inválidas não contam.");

  assert.equal(
    buildAggregateOffer([]),
    null,
    "Sem ofertas válidas não há AggregateOffer.",
  );
}
console.log("SEO_AGGREGATE_OFFER_REAL_PRICES=PASS");

// ---- Breadcrumb ---------------------------------------------------------------
{
  const breadcrumb = buildProductBreadcrumbData({
    id: produtoReal.id,
    name: produtoReal.name,
  });
  assert.equal(breadcrumb["@type"], "BreadcrumbList");
  assert.equal(breadcrumb.itemListElement.length, 2);
  assert.equal(breadcrumb.itemListElement[0]!.name, "Início");
  assert.equal(breadcrumb.itemListElement[0]!.position, 1);
  assert.equal(breadcrumb.itemListElement[1]!.name, produtoReal.name);
  assert.equal(breadcrumb.itemListElement[1]!.position, 2);
  assert.equal(
    breadcrumb.itemListElement.at(-1)!.item,
    siteUrl(`/produto/${produtoReal.id}`),
  );
}
console.log("SEO_BREADCRUMB_JSONLD=PASS");

// ---- WebSite + SearchAction ----------------------------------------------------
{
  const website = buildWebSiteStructuredData() as Record<string, unknown>;
  assert.equal(website["@type"], "WebSite");
  const action = website.potentialAction as {
    target: { urlTemplate: string };
  };
  assert.match(
    action.target.urlTemplate,
    /\/\?q=\{search_term_string\}$/,
    "SearchAction deve refletir a busca real GET ?q=.",
  );
}
console.log("SEO_WEBSITE_SCHEMA=PASS");

// ---- serialize + helpers --------------------------------------------------------
{
  assert.equal(serializeJsonLd({ a: "<script>" }), '{"a":"\\u003cscript>"}');
  assert.equal(
    normalizeAbsoluteUrl("https://x.example/a.jpg"),
    "https://x.example/a.jpg",
  );
  assert.equal(normalizeAbsoluteUrl(""), null);
  assert.ok(createProductDescription("Produto", null).length > 0);
  assert.equal(
    isProductIndexable({ active: false, publicationStatus: "PUBLISHED" }),
    false,
  );
  assert.equal(
    isProductIndexable({ active: true, publicationStatus: "DRAFT" }),
    false,
  );

  const draft = { ...produtoReal, publicationStatus: "DRAFT" };
  assert.equal(
    buildProductStructuredData(draft),
    null,
    "Produto rascunho não pode expor JSON-LD.",
  );
}
console.log("SEO_HELPERS=PASS");

// ---- SEO_ADMIN_NOINDEX (metadata real de admin) -----------------------------
async function checarAdminNoindex(): Promise<void> {
  const { metadata: adminMetadata } = await import("../../app/admin/layout");

  assert.ok(adminMetadata.robots, "/admin deve ter robots.");
  assert.equal(adminMetadata.robots!.index, false);
  assert.equal(adminMetadata.robots!.follow, false);

  const disallow = robots().rules?.[0]?.disallow ?? [];
  assert.ok(disallow.includes("/admin"), "robots deve bloquear /admin.");
  assert.equal(
    rotaPrivadaExcluidaDoSitemap("/admin"),
    true,
    "/admin nunca deve estar no sitemap.",
  );

  console.log("SEO_ADMIN_NOINDEX=PASS");
}

void checarAdminNoindex()
  .then(() => {
    console.log("seo.test.ts: todos os casos passaram");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });