import * as cheerio from "cheerio";

import type { AmazonOffer } from "./types";

type AmazonDocument = ReturnType<
  typeof cheerio.load
>;

type JsonRecord = Record<string, unknown>;

function limparTexto(
  texto?: string | null,
): string {
  return (
    texto
      ?.replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim() ?? ""
  );
}

function normalizarChave(
  texto: string,
): string {
  return limparTexto(texto)
    .replace(/:+$/, "")
    .trim();
}

function numero(
  valor?: string | number | null,
): number | undefined {
  if (
    valor === null ||
    valor === undefined
  ) {
    return undefined;
  }

  if (typeof valor === "number") {
    return Number.isFinite(valor)
      ? valor
      : undefined;
  }

  const bruto = valor
    .replace(/\u00a0/g, " ")
    .replace(/[^\d,.-]/g, "")
    .trim();

  if (!bruto) {
    return undefined;
  }

  const ultimaVirgula =
    bruto.lastIndexOf(",");

  const ultimoPonto =
    bruto.lastIndexOf(".");

  let normalizado = bruto;

  if (
    ultimaVirgula >= 0 &&
    ultimoPonto >= 0
  ) {
    if (ultimaVirgula > ultimoPonto) {
      normalizado = bruto
        .replace(/\./g, "")
        .replace(",", ".");
    } else {
      normalizado = bruto.replace(
        /,/g,
        "",
      );
    }
  } else if (ultimaVirgula >= 0) {
    const casasDecimais =
      bruto.length -
      ultimaVirgula -
      1;

    normalizado =
      casasDecimais === 2
        ? bruto
            .replace(/\./g, "")
            .replace(",", ".")
        : bruto.replace(/,/g, "");
  } else if (ultimoPonto >= 0) {
    const casasDecimais =
      bruto.length -
      ultimoPonto -
      1;

    normalizado =
      casasDecimais === 2
        ? bruto.replace(/,/g, "")
        : bruto.replace(/\./g, "");
  }

  const resultado = Number(normalizado);

  return Number.isFinite(resultado)
    ? resultado
    : undefined;
}

function converterUnknownParaNumero(
  valor: unknown,
): number | undefined {
  if (
    typeof valor !== "string" &&
    typeof valor !== "number"
  ) {
    return undefined;
  }

  return numero(valor);
}

function converterUnknownParaTexto(
  valor: unknown,
): string | undefined {
  if (typeof valor === "string") {
    return valor;
  }

  if (typeof valor === "number") {
    return String(valor);
  }

  return undefined;
}

function inteiro(
  valor?: string | number | null,
): number | undefined {
  if (
    valor === null ||
    valor === undefined
  ) {
    return undefined;
  }

  if (typeof valor === "number") {
    return Number.isFinite(valor)
      ? Math.trunc(valor)
      : undefined;
  }

  const somenteNumeros =
    valor.replace(/\D/g, "");

  if (!somenteNumeros) {
    return undefined;
  }

  const resultado = Number(
    somenteNumeros,
  );

  return Number.isFinite(resultado)
    ? resultado
    : undefined;
}

function isJsonRecord(
  valor: unknown,
): valor is JsonRecord {
  return (
    typeof valor === "object" &&
    valor !== null &&
    !Array.isArray(valor)
  );
}

function possuiTipoProduto(
  valor: unknown,
): boolean {
  if (typeof valor === "string") {
    return (
      valor.toLowerCase() === "product"
    );
  }

  if (Array.isArray(valor)) {
    return valor.some(
      possuiTipoProduto,
    );
  }

  return false;
}

function procurarProdutoJsonLd(
  valor: unknown,
): JsonRecord | null {
  if (Array.isArray(valor)) {
    for (const item of valor) {
      const encontrado =
        procurarProdutoJsonLd(item);

      if (encontrado) {
        return encontrado;
      }
    }

    return null;
  }

  if (!isJsonRecord(valor)) {
    return null;
  }

  if (possuiTipoProduto(valor["@type"])) {
    return valor;
  }

  const grafo = valor["@graph"];

  if (grafo !== undefined) {
    const encontrado =
      procurarProdutoJsonLd(grafo);

    if (encontrado) {
      return encontrado;
    }
  }

  return null;
}

function extrairProdutoJsonLd(
  $: AmazonDocument,
): JsonRecord | null {
  let produto: JsonRecord | null = null;

  $(
    "script[type='application/ld+json']",
  ).each((_, element) => {
    const conteudo = $(element)
      .text()
      .trim();

    if (!conteudo) {
      return;
    }

    try {
      const json: unknown =
        JSON.parse(conteudo);

      const encontrado =
        procurarProdutoJsonLd(json);

      if (encontrado) {
        produto = encontrado;

        return false;
      }
    } catch {
      return;
    }
  });

  return produto;
}

function asinValido(
  valor?: string | null,
): string | null {
  if (!valor) {
    return null;
  }

  const asin = valor
    .trim()
    .toUpperCase();

  return /^[A-Z0-9]{10}$/.test(asin)
    ? asin
    : null;
}

function extrairAsinDaUrl(
  rawUrl?: string | null,
): string | null {
  if (!rawUrl) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const padroes = [
    /\/dp\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/gp\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?]|$)/i,
    /\/product\/([A-Z0-9]{10})(?:[/?]|$)/i,
  ];

  for (const padrao of padroes) {
    const encontrado =
      url.pathname.match(padrao);

    const asin = asinValido(
      encontrado?.[1],
    );

    if (asin) {
      return asin;
    }
  }

  const parametros = [
    url.searchParams.get("asin"),
    url.searchParams.get("ASIN"),
  ];

  for (const parametro of parametros) {
    const asin = asinValido(parametro);

    if (asin) {
      return asin;
    }
  }

  return null;
}

function extrairAsin(
  $: AmazonDocument,
  finalUrl: string,
  produtoJsonLd: JsonRecord | null,
): string {
  const urlsPossiveis = [
    finalUrl,
    $("link[rel='canonical']").attr(
      "href",
    ),
    $("meta[property='og:url']").attr(
      "content",
    ),
  ];

  for (const urlPossivel of urlsPossiveis) {
    const asin =
      extrairAsinDaUrl(urlPossivel);

    if (asin) {
      return asin;
    }
  }

  const skuJsonLd =
    converterUnknownParaTexto(
      produtoJsonLd?.sku,
    );

  const valoresPossiveis = [
    $("#ASIN").val(),
    $("input[name='ASIN']").val(),
    $("input[name='asin']").val(),
    skuJsonLd,
  ];

  for (const valor of valoresPossiveis) {
    let texto: string | undefined;

    if (typeof valor === "string") {
      texto = valor;
    } else if (
      typeof valor === "number"
    ) {
      texto = String(valor);
    } else if (
      Array.isArray(valor)
    ) {
      texto = valor[0];
    }

    const asin = asinValido(texto);

    if (asin) {
      return asin;
    }
  }

  const dataAsin =
    $("#dp-container[data-asin]")
      .attr("data-asin") ||
    $("#ppd[data-asin]").attr(
      "data-asin",
    ) ||
    $("body[data-asin]").attr(
      "data-asin",
    );

  const asin = asinValido(dataAsin);

  if (asin) {
    return asin;
  }

  throw new Error(
    "Não foi possível localizar o ASIN do produto.",
  );
}

function primeiroTexto(
  $: AmazonDocument,
  seletores: readonly string[],
): string {
  for (const seletor of seletores) {
    const texto = limparTexto(
      $(seletor).first().text(),
    );

    if (texto) {
      return texto;
    }
  }

  return "";
}

function primeiroNumero(
  $: AmazonDocument,
  seletores: readonly string[],
): number | undefined {
  for (const seletor of seletores) {
    const elementos = $(seletor);

    for (
      let indice = 0;
      indice < elementos.length;
      indice += 1
    ) {
      const texto = limparTexto(
        $(elementos[indice]).text(),
      );

      const valor = numero(texto);

      if (
        valor !== undefined &&
        valor > 0
      ) {
        return valor;
      }
    }
  }

  return undefined;
}

function limparMarca(
  valor?: string | null,
): string | undefined {
  const marca = limparTexto(valor)
    .replace(
      /^visite\s+a\s+loja\s+de\s+/i,
      "",
    )
    .replace(
      /^visite\s+a\s+loja\s+da\s+/i,
      "",
    )
    .replace(/^marca:\s*/i, "")
    .replace(/^brand:\s*/i, "")
    .trim();

  return marca || undefined;
}

function extrairMarcaJsonLd(
  produtoJsonLd: JsonRecord | null,
): string | undefined {
  const brand = produtoJsonLd?.brand;

  if (typeof brand === "string") {
    return limparMarca(brand);
  }

  if (
    isJsonRecord(brand) &&
    typeof brand.name === "string"
  ) {
    return limparMarca(brand.name);
  }

  return undefined;
}

function normalizarImagem(
  valor?: string | null,
): string | null {
  if (!valor) {
    return null;
  }

  let url = valor
    .trim()
    .replace(/&amp;/g, "&");

  if (url.startsWith("//")) {
    url = `https:${url}`;
  }

  if (
    !url.startsWith("https://") &&
    !url.startsWith("http://")
  ) {
    return null;
  }

  url = url.replace(
    /\._[^./]+_\.(?=(?:jpe?g|png|webp)(?:\?|$))/i,
    ".",
  );

  return url;
}

function imagensJsonLd(
  produtoJsonLd: JsonRecord | null,
): string[] {
  const imagem = produtoJsonLd?.image;

  if (typeof imagem === "string") {
    return [imagem];
  }

  if (Array.isArray(imagem)) {
    return imagem.filter(
      (item): item is string =>
        typeof item === "string",
    );
  }

  if (
    isJsonRecord(imagem) &&
    typeof imagem.url === "string"
  ) {
    return [imagem.url];
  }

  return [];
}

function extrairImagens(
  $: AmazonDocument,
  produtoJsonLd: JsonRecord | null,
): string[] {
  const candidatas: string[] = [];

  const imagemPrincipal =
    $("#landingImage").first();

  const imagemBloco =
    $("#imgBlkFront").first();

  const atributosPrincipais = [
    imagemPrincipal.attr("data-old-hires"),
    imagemPrincipal.attr("src"),
    imagemBloco.attr("data-old-hires"),
    imagemBloco.attr("src"),
    $("meta[property='og:image']").attr(
      "content",
    ),
  ];

  for (const valor of atributosPrincipais) {
    if (valor) {
      candidatas.push(valor);
    }
  }

  const imagensDinamicas =
    imagemPrincipal.attr(
      "data-a-dynamic-image",
    );

  if (imagensDinamicas) {
    try {
      const json: unknown =
        JSON.parse(imagensDinamicas);

      if (isJsonRecord(json)) {
        candidatas.push(
          ...Object.keys(json),
        );
      }
    } catch {
      // Ignora o JSON inválido.
    }
  }

  $("#altImages img").each(
    (_, element) => {
      const imagem = $(element);

      const valores = [
        imagem.attr("data-old-hires"),
        imagem.attr("src"),
      ];

      for (const valor of valores) {
        if (valor) {
          candidatas.push(valor);
        }
      }
    },
  );

  candidatas.push(
    ...imagensJsonLd(produtoJsonLd),
  );

  return Array.from(
    new Set(
      candidatas
        .map(normalizarImagem)
        .filter(
          (
            imagem,
          ): imagem is string =>
            Boolean(imagem),
        ),
    ),
  );
}

function adicionarAtributo(
  atributos: Record<string, string>,
  chave: string,
  valor: string,
): void {
  const chaveLimpa =
    normalizarChave(chave);

  const valorLimpo =
    limparTexto(valor);

  if (
    !chaveLimpa ||
    !valorLimpo ||
    chaveLimpa.length > 150
  ) {
    return;
  }

  atributos[chaveLimpa] =
    valorLimpo.slice(0, 1_500);
}

function extrairAtributos(
  $: AmazonDocument,
): Record<string, string> {
  const atributos: Record<
    string,
    string
  > = {};

  const seletoresTabelas = [
    "#productOverview_feature_div tr",
    "#productDetails_techSpec_section_1 tr",
    "#productDetails_techSpec_section_2 tr",
    "#productDetails_detailBullets_sections1 tr",
    "#productDetails_detailBullets_sections2 tr",
  ];

  $(seletoresTabelas.join(",")).each(
    (_, element) => {
      const linha = $(element);

      const chave =
        limparTexto(
          linha.find("th").first().text(),
        ) ||
        limparTexto(
          linha
            .find(".a-span3")
            .first()
            .text(),
        ) ||
        limparTexto(
          linha
            .find(
              ".a-color-secondary",
            )
            .first()
            .text(),
        );

      const valor =
        limparTexto(
          linha.find("td").last().text(),
        ) ||
        limparTexto(
          linha
            .find(".a-span9")
            .last()
            .text(),
        );

      if (chave && valor) {
        adicionarAtributo(
          atributos,
          chave,
          valor,
        );
      }
    },
  );

  $("#detailBullets_feature_div li").each(
    (_, element) => {
      const item = $(element);

      const chaveOriginal =
        limparTexto(
          item
            .find(".a-text-bold")
            .first()
            .text(),
        );

      const textoCompleto =
        limparTexto(item.text());

      if (
        !chaveOriginal ||
        !textoCompleto
      ) {
        return;
      }

      const chave =
        normalizarChave(
          chaveOriginal,
        );

      let valor = textoCompleto;

      const posicaoChave =
        textoCompleto.indexOf(
          chaveOriginal,
        );

      if (posicaoChave >= 0) {
        valor = textoCompleto
          .slice(
            posicaoChave +
              chaveOriginal.length,
          )
          .replace(/^:\s*/, "")
          .trim();
      }

      if (chave && valor) {
        adicionarAtributo(
          atributos,
          chave,
          valor,
        );
      }
    },
  );

  return atributos;
}

function extrairPrecoJsonLd(
  produtoJsonLd: JsonRecord | null,
): number | undefined {
  const offers =
    produtoJsonLd?.offers;

  const ofertas = Array.isArray(offers)
    ? offers
    : offers !== undefined
      ? [offers]
      : [];

  for (const ofertaDesconhecida of ofertas) {
    if (
      !isJsonRecord(
        ofertaDesconhecida,
      )
    ) {
      continue;
    }

    const preco =
      converterUnknownParaNumero(
        ofertaDesconhecida.price,
      );

    const menorPreco =
      converterUnknownParaNumero(
        ofertaDesconhecida.lowPrice,
      );

    const valor =
      preco ?? menorPreco;

    if (
      valor !== undefined &&
      valor > 0
    ) {
      return valor;
    }
  }

  return undefined;
}

function extrairRatingJsonLd(
  produtoJsonLd: JsonRecord | null,
): number | undefined {
  const aggregateRating =
    produtoJsonLd?.aggregateRating;

  if (!isJsonRecord(aggregateRating)) {
    return undefined;
  }

  return converterUnknownParaNumero(
    aggregateRating.ratingValue,
  );
}

function extrairReviewsJsonLd(
  produtoJsonLd: JsonRecord | null,
): number | undefined {
  const aggregateRating =
    produtoJsonLd?.aggregateRating;

  if (!isJsonRecord(aggregateRating)) {
    return undefined;
  }

  const valor =
    aggregateRating.reviewCount ??
    aggregateRating.ratingCount;

  if (
    typeof valor !== "string" &&
    typeof valor !== "number"
  ) {
    return undefined;
  }

  return inteiro(valor);
}

function extrairDescricao(
  $: AmazonDocument,
  produtoJsonLd: JsonRecord | null,
): string | undefined {
  const bullets: string[] = [];

  $("#feature-bullets li span").each(
    (_, element) => {
      const texto = limparTexto(
        $(element).text(),
      );

      if (
        texto &&
        !texto
          .toLowerCase()
          .includes(
            "clique aqui para informações",
          )
      ) {
        bullets.push(texto);
      }
    },
  );

  const descricaoBullets =
    Array.from(
      new Set(bullets),
    ).join(" • ");

  if (descricaoBullets) {
    return descricaoBullets;
  }

  const descricaoHtml =
    primeiroTexto($, [
      "#productDescription",
      "#aplus_feature_div",
      "#bookDescription_feature_div",
    ]);

  if (descricaoHtml) {
    return descricaoHtml;
  }

  const descricaoJson =
    produtoJsonLd?.description;

  return typeof descricaoJson ===
    "string"
    ? limparTexto(descricaoJson) ||
        undefined
    : undefined;
}

function extrairEstoque(
  $: AmazonDocument,
): number | null {
  const disponibilidade =
    primeiroTexto($, [
      "#availability",
      "#outOfStock",
      "#availabilityInsideBuyBox_feature_div",
    ]).toLowerCase();

  if (!disponibilidade) {
    return null;
  }

  if (
    disponibilidade.includes(
      "indisponível",
    ) ||
    disponibilidade.includes(
      "temporariamente sem estoque",
    ) ||
    disponibilidade.includes(
      "não disponível",
    ) ||
    disponibilidade.includes(
      "currently unavailable",
    )
  ) {
    return 0;
  }

  const quantidade =
    disponibilidade.match(
      /(?:apenas|somente|restam)\s+(\d+)/i,
    )?.[1];

  if (quantidade) {
    return Number(quantidade);
  }

  return null;
}

function extrairVendedor(
  $: AmazonDocument,
): string | undefined {
  const vendedorDireto = limparTexto(
    $("#sellerProfileTriggerId").text(),
  );

  if (vendedorDireto) {
    return vendedorDireto;
  }

  const merchantInfo = limparTexto(
    $("#merchant-info").text(),
  );

  if (!merchantInfo) {
    return undefined;
  }

  const encontrado =
    merchantInfo.match(
      /vendid[oa]\s+por\s+(.+?)(?:\s+e\s+enviad[oa]|\.$|$)/i,
    );

  return (
    limparTexto(encontrado?.[1]) ||
    undefined
  );
}

function extrairCategoria(
  $: AmazonDocument,
): string | undefined {
  const categorias: string[] = [];

  $(
    "#wayfinding-breadcrumbs_container li a",
  ).each((_, element) => {
    const categoria = limparTexto(
      $(element).text(),
    );

    if (categoria) {
      categorias.push(categoria);
    }
  });

  if (categorias.length > 0) {
    return categorias[
      categorias.length - 1
    ];
  }

  return undefined;
}

export function parseAmazonProduct(
  $: AmazonDocument,
  affiliateLink: string,
  finalUrl: string,
): AmazonOffer {
  const produtoJsonLd =
    extrairProdutoJsonLd($);

  const asin = extrairAsin(
    $,
    finalUrl,
    produtoJsonLd,
  );

  const nomeJsonLd =
    converterUnknownParaTexto(
      produtoJsonLd?.name,
    );

  const tituloJson =
    limparTexto(nomeJsonLd);

  const title =
    limparTexto(
      $("#productTitle").text(),
    ) ||
    tituloJson ||
    limparTexto($("title").text())
      .replace(
        /\s*[:|-]\s*Amazon\.com\.br.*$/i,
        "",
      )
      .trim();

  if (!title) {
    throw new Error(
      "Não foi possível identificar o título do produto.",
    );
  }

  const brand =
    limparMarca(
      $("#bylineInfo").text(),
    ) ||
    limparMarca(
      primeiroTexto($, [
        "#productOverview_feature_div tr:contains('Marca') td",
        "#productDetails_techSpec_section_1 tr:contains('Marca') td",
      ]),
    ) ||
    extrairMarcaJsonLd(
      produtoJsonLd,
    );

  const price =
    primeiroNumero($, [
      "#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen",
      "#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen",
      "#apex_desktop .a-price:not(.a-text-price) .a-offscreen",
      "#tp_price_block_total_price_ww .a-offscreen",
      ".priceToPay .a-offscreen",
      "#price_inside_buybox",
      "#priceblock_dealprice",
      "#priceblock_ourprice",
      "#kindle-price",
    ]) ??
    extrairPrecoJsonLd(
      produtoJsonLd,
    );

  if (
    price === undefined ||
    price <= 0
  ) {
    throw new Error(
      "Não foi possível identificar um preço válido na página da Amazon.",
    );
  }

  const precoAnterior =
    primeiroNumero($, [
      "#corePrice_feature_div .a-text-price .a-offscreen",
      "#corePriceDisplay_desktop_feature_div .a-text-price .a-offscreen",
      "#apex_desktop .a-text-price .a-offscreen",
      ".basisPrice .a-offscreen",
      "#priceblock_listprice",
      "#listPrice",
    ]);

  const oldPrice =
    precoAnterior !== undefined &&
    precoAnterior > price
      ? precoAnterior
      : undefined;

  const ratingTexto =
    $("#acrPopover").attr("title") ||
    $("#averageCustomerReviews").text();

  const ratingEncontrado =
    limparTexto(ratingTexto)
      .replace(",", ".")
      .match(/\d+(?:\.\d+)?/)?.[0];

  const rating =
    numero(ratingEncontrado) ??
    extrairRatingJsonLd(
      produtoJsonLd,
    );

  const reviews =
    inteiro(
      $("#acrCustomerReviewText").text(),
    ) ??
    extrairReviewsJsonLd(
      produtoJsonLd,
    );

  const images = extrairImagens(
    $,
    produtoJsonLd,
  );

  const image = images[0] ?? "";

  if (!image) {
    throw new Error(
      "Não foi possível identificar a imagem principal do produto.",
    );
  }

  const attributes =
    extrairAtributos($);

  adicionarAtributo(
    attributes,
    "ASIN",
    asin,
  );

  if (brand) {
    adicionarAtributo(
      attributes,
      "Marca",
      brand,
    );
  }

  return {
    asin,

    affiliateLink:
      affiliateLink.trim(),

    productUrl: finalUrl,

    title,
    brand,

    price,
    oldPrice,

    rating:
      rating !== undefined &&
      rating >= 0 &&
      rating <= 5
        ? rating
        : undefined,

    reviews,

    image,
    images,

    description: extrairDescricao(
      $,
      produtoJsonLd,
    ),

    category:
      extrairCategoria($),

    seller: extrairVendedor($),

    stock: extrairEstoque($),

    attributes,
  };
}