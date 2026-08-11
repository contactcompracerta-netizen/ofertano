import { createHmac } from "node:crypto";

import type { PaginaAliExpress } from "./types";

const ALIEXPRESS_ENDPOINT =
  "https://api-sg.aliexpress.com/sync";

const ALIEXPRESS_METHOD =
  "aliexpress.affiliate.productdetail.get";

type ProdutoAliExpressApi = {
  product_id?: string | number;

  product_title?: string;

  product_main_image_url?: string;

  product_small_image_urls?:
    | string[]
    | {
        string?: string[];
      };

  product_detail_url?: string;

  promotion_link?: string;

  sale_price?: string | number;
  sale_price_currency?: string;

  original_price?: string | number;
  original_price_currency?: string;

  target_sale_price?: string | number;
  target_sale_price_currency?: string;

  target_original_price?: string | number;
  target_original_price_currency?: string;

  app_sale_price?: string | number;
  app_sale_price_currency?: string;

  target_app_sale_price?: string | number;
  target_app_sale_price_currency?: string;

  discount?: string;

  commission_rate?: string;

  hot_product_commission_rate?: string;

  evaluate_rate?: string;

  lastest_volume?: string | number;

  first_level_category_id?: string | number;
  first_level_category_name?: string;

  second_level_category_id?: string | number;
  second_level_category_name?: string;

  shop_id?: string | number;
  shop_name?: string;
  shop_url?: string;

  product_video_url?: string;

  sku_id?: string | number;

  tax_rate?: string;
};

type RespostaAliExpressApi = {
  code?: string | number;

  message?: string;

  type?: string;

  request_id?: string;

  resp_result?: {
    resp_code?: string | number;

    resp_msg?: string;

    result?: {
      current_record_count?: string | number;

      products?:
        | ProdutoAliExpressApi[]
        | {
            product?: ProdutoAliExpressApi[];
          };
    };
  };
};

function obterVariavelAmbiente(
  nome: string,
): string {
  const valor =
    process.env[nome]?.trim();

  if (!valor) {
    throw new Error(
      `${nome} não foi configurado.`,
    );
  }

  return valor;
}

function limparUrl(
  valor: unknown,
): string | null {
  if (
    typeof valor !== "string"
  ) {
    return null;
  }

  let url =
    valor.trim();

  if (!url) {
    return null;
  }

  const markdown =
    url.match(
      /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/,
    );

  if (markdown) {
    url =
      markdown[2] ||
      markdown[1];
  }

  if (
    !/^https?:\/\//i.test(url)
  ) {
    return null;
  }

  return url;
}

function extrairIdProduto(
  rawUrl: string,
): string | null {
  const urlLimpa =
    limparUrl(rawUrl) ??
    rawUrl.trim();

  if (!urlLimpa) {
    return null;
  }

  const padroesDiretos = [
    /\/item\/(\d+)\.html/i,
    /\/item\/(\d+)/i,
    /[?&]productId=(\d+)/i,
    /[?&]product_id=(\d+)/i,
  ];

  for (const padrao of padroesDiretos) {
    const resultado =
      urlLimpa.match(padrao);

    if (resultado?.[1]) {
      return resultado[1];
    }
  }

  try {
    const parsed =
      new URL(urlLimpa);

    /*
     * Links modernos de vitrine do AliExpress:
     * /ssr/.../BundleDeals2?productIds=PRODUTO:SKU
     *
     * O primeiro número é o Product ID.
     */
    const productIds =
      parsed.searchParams.get("productIds") ??
      parsed.searchParams.get("product_ids");

    if (productIds) {
      const primeiroId =
        productIds.match(
          /^(\d{8,})(?=:|$)/,
        )?.[1];

      if (primeiroId) {
        return primeiroId;
      }
    }

    /*
     * Fallback usado em alguns links de recomendação:
     * utparam-url=...|x_object_id:PRODUCT_ID|...
     */
    const utparamUrl =
      parsed.searchParams.get(
        "utparam-url",
      );

    const xObjectId =
      utparamUrl?.match(
        /(?:^|[|&])x_object_id[:=](\d{8,})(?:[|&]|$)/i,
      )?.[1];

    if (xObjectId) {
      return xObjectId;
    }
  } catch {
    // Os padrões diretos acima já foram tentados.
  }

  return null;
}

function ehLinkAfiliado(
  url: string,
): boolean {
  try {
    const parsed =
      new URL(url);

    const host =
      parsed.hostname
        .toLowerCase();

    return (
      host ===
        "s.click.aliexpress.com" ||
      host.endsWith(
        ".s.click.aliexpress.com",
      )
    );
  } catch {
    return false;
  }
}

async function resolverUrlProduto(
  requestedUrl: string,
): Promise<{
  finalUrl: string;
  productId: string;
}> {
  const idDireto =
    extrairIdProduto(
      requestedUrl,
    );

  if (idDireto) {
    return {
      finalUrl:
        requestedUrl,

      productId:
        idDireto,
    };
  }

  const response =
    await fetch(
      requestedUrl,
      {
        method: "GET",

        redirect: "follow",

        cache: "no-store",

        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",

          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

          "Accept-Language":
            "pt-BR,pt;q=0.9,en;q=0.8",
        },
      },
    );

  const finalUrl =
    response.url ||
    requestedUrl;

  const productId =
    extrairIdProduto(
      finalUrl,
    );

  if (!productId) {
    throw new Error(
      "Não foi possível localizar o código do produto do AliExpress.",
    );
  }

  return {
    finalUrl,
    productId,
  };
}

function gerarAssinatura(
  parametros: Record<
    string,
    string
  >,
  appSecret: string,
): string {
  const texto =
    Object.entries(
      parametros,
    )
      .filter(
        ([, valor]) =>
          valor !== "",
      )
      .sort(
        ([chaveA], [chaveB]) =>
          chaveA.localeCompare(
            chaveB,
          ),
      )
      .map(
        ([chave, valor]) =>
          `${chave}${valor}`,
      )
      .join("");

  return createHmac(
    "sha256",
    appSecret,
  )
    .update(
      texto,
      "utf8",
    )
    .digest("hex")
    .toUpperCase();
}

function obterProdutos(
  resposta: RespostaAliExpressApi,
): ProdutoAliExpressApi[] {
  const products =
    resposta
      ?.resp_result
      ?.result
      ?.products;

  if (
    Array.isArray(products)
  ) {
    return products;
  }

  if (
    products &&
    typeof products ===
      "object" &&
    Array.isArray(
      products.product,
    )
  ) {
    return products.product;
  }

  return [];
}

async function buscarProdutoApi(
  productId: string,
): Promise<ProdutoAliExpressApi> {
  const appKey =
    obterVariavelAmbiente(
      "ALIEXPRESS_APP_KEY",
    );

  const appSecret =
    obterVariavelAmbiente(
      "ALIEXPRESS_APP_SECRET",
    );

  const parametros: Record<
    string,
    string
  > = {
    method:
      ALIEXPRESS_METHOD,

    app_key:
      appKey,

    timestamp:
      String(Date.now()),

    sign_method:
      "sha256",

    simplify:
      "true",

    format:
      "json",

    product_ids:
      productId,

    target_currency:
      "BRL",

    target_language:
      "PT",

    country:
      "BR",

    fields: [
      "product_id",
      "product_title",

      "product_main_image_url",
      "product_small_image_urls",

      "product_detail_url",
      "promotion_link",

      "sale_price",
      "sale_price_currency",

      "original_price",
      "original_price_currency",

      "target_sale_price",
      "target_sale_price_currency",

      "target_original_price",
      "target_original_price_currency",

      "app_sale_price",
      "app_sale_price_currency",

      "target_app_sale_price",
      "target_app_sale_price_currency",

      "discount",

      "commission_rate",
      "hot_product_commission_rate",

      "evaluate_rate",

      "lastest_volume",

      "first_level_category_id",
      "first_level_category_name",

      "second_level_category_id",
      "second_level_category_name",

      "shop_id",
      "shop_name",
      "shop_url",

      "product_video_url",

      "sku_id",

      "tax_rate",
    ].join(","),
  };

  const sign =
    gerarAssinatura(
      parametros,
      appSecret,
    );

  const url =
    new URL(
      ALIEXPRESS_ENDPOINT,
    );

  for (
    const [
      chave,
      valor,
    ] of Object.entries(
      parametros,
    )
  ) {
    url.searchParams.set(
      chave,
      valor,
    );
  }

  url.searchParams.set(
    "sign",
    sign,
  );

  const response =
    await fetch(
      url.toString(),
      {
        method: "POST",

        cache: "no-store",

        headers: {
          Accept:
            "application/json",
        },
      },
    );

  const texto =
    await response.text();

  let resposta:
    RespostaAliExpressApi;

  try {
    resposta =
      JSON.parse(texto);
  } catch {
    throw new Error(
      `AliExpress API retornou uma resposta inválida. HTTP ${response.status}.`,
    );
  }

  if (
    resposta.code !==
      undefined &&
    String(
      resposta.code,
    ) !== "0"
  ) {
    throw new Error(
      [
        "AliExpress API:",
        String(
          resposta.code,
        ),
        resposta.message ||
          "erro desconhecido",
      ].join(" "),
    );
  }

  const respCode =
    resposta
      ?.resp_result
      ?.resp_code;

  if (
    respCode ===
      undefined ||
    String(respCode) !==
      "200"
  ) {
    throw new Error(
      resposta
        ?.resp_result
        ?.resp_msg ||
        "AliExpress API não retornou sucesso.",
    );
  }

  const produtos =
    obterProdutos(
      resposta,
    );

  const produto =
    produtos[0];

  if (!produto) {
    throw new Error(
      "O AliExpress não retornou dados para este produto.",
    );
  }

  return produto;
}

function normalizarImagens(
  produto: ProdutoAliExpressApi,
): string[] {
  const imagens: string[] =
    [];

  const principal =
    limparUrl(
      produto
        .product_main_image_url,
    );

  if (principal) {
    imagens.push(
      principal,
    );
  }

  const pequenas =
    produto
      .product_small_image_urls;

  if (
    Array.isArray(pequenas)
  ) {
    for (
      const imagem
      of pequenas
    ) {
      const limpa =
        limparUrl(imagem);

      if (limpa) {
        imagens.push(
          limpa,
        );
      }
    }
  } else if (
    pequenas &&
    typeof pequenas ===
      "object" &&
    Array.isArray(
      pequenas.string,
    )
  ) {
    for (
      const imagem
      of pequenas.string
    ) {
      const limpa =
        limparUrl(imagem);

      if (limpa) {
        imagens.push(
          limpa,
        );
      }
    }
  }

  return Array.from(
    new Set(imagens),
  );
}

function escaparHtml(
  valor: string,
): string {
  return valor
    .replace(
      /&/g,
      "&amp;",
    )
    .replace(
      /"/g,
      "&quot;",
    )
    .replace(
      /</g,
      "&lt;",
    )
    .replace(
      />/g,
      "&gt;",
    );
}

function converterPrecoPagina(
  valor: unknown,
): number | null {
  if (
    typeof valor === "number"
  ) {
    return Number.isFinite(valor) &&
      valor > 0
      ? valor
      : null;
  }

  if (
    typeof valor !== "string"
  ) {
    return null;
  }

  let texto =
    valor.trim();

  if (!texto) {
    return null;
  }

  try {
    if (
      texto.startsWith('"') &&
      texto.endsWith('"')
    ) {
      texto =
        JSON.parse(texto);
    }
  } catch {
    // Mantém o texto original.
  }

  texto = texto
    .replace(
      /\\u0024/gi,
      "$",
    )
    .replace(
      /\\u00a0/gi,
      " ",
    )
    .replace(
      /&nbsp;/gi,
      " ",
    )
    .replace(
      /\s+/g,
      " ",
    )
    .trim();

  const brl =
    texto.match(
      /R\$\s*([\d.]+(?:,\d{1,2})?)/i,
    )?.[1];

  if (brl) {
    const numero =
      Number(
        brl
          .replace(/\./g, "")
          .replace(",", "."),
      );

    return Number.isFinite(numero) &&
      numero > 0
      ? numero
      : null;
  }

  const simples =
    texto.match(
      /(\d+(?:[.,]\d{1,2})?)/,
    )?.[1];

  if (!simples) {
    return null;
  }

  const numero =
    Number(
      simples.replace(",", "."),
    );

  return Number.isFinite(numero) &&
    numero > 0
    ? numero
    : null;
}

type PrecoPaginaResultado = {
  valor: number;
  fonte: string;
  precoAnterior?: number | null;
};

type CandidatoPrecoPagina = {
  valor: number;
  fonte: string;
  indice: number;
  prioridade: number;
};

function extrairPrecoMetaProduto(
  html: string,
): PrecoPaginaResultado | null {
  const padroes = [
    /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']product:price:amount["'][^>]*>/i,
    /<meta[^>]+itemprop=["']price["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']price["'][^>]*>/i,
  ];

  for (const padrao of padroes) {
    const valorBruto =
      html.match(
        padrao,
      )?.[1];

    const valor =
      converterPrecoPagina(
        valorBruto,
      );

    if (
      valor !== null &&
      valor > 0
    ) {
      return {
        valor,
        fonte:
          "meta-product-price",
      };
    }
  }

  return null;
}

function extrairPrecoJsonLdProduto(
  html: string,
): PrecoPaginaResultado | null {
  const regex =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  let match:
    RegExpExecArray | null;

  const visitar = (
    valor: unknown,
  ): number | null => {
    if (
      !valor ||
      typeof valor !== "object"
    ) {
      return null;
    }

    if (Array.isArray(valor)) {
      for (
        const item of valor
      ) {
        const encontrado =
          visitar(item);

        if (
          encontrado !== null
        ) {
          return encontrado;
        }
      }

      return null;
    }

    const registro =
      valor as Record<
        string,
        unknown
      >;

    const tipo =
      registro["@type"];

    const tipos =
      Array.isArray(tipo)
        ? tipo.map(String)
        : tipo
          ? [String(tipo)]
          : [];

    const ehProduto =
      tipos.some(
        (item) =>
          item
            .toLowerCase() ===
          "product",
      );

    if (ehProduto) {
      const ofertas =
        Array.isArray(
          registro.offers,
        )
          ? registro.offers
          : registro.offers
            ? [registro.offers]
            : [];

      for (
        const oferta of ofertas
      ) {
        if (
          !oferta ||
          typeof oferta !==
            "object"
        ) {
          continue;
        }

        const dadosOferta =
          oferta as Record<
            string,
            unknown
          >;

        const moeda =
          typeof dadosOferta
            .priceCurrency ===
          "string"
            ? dadosOferta
                .priceCurrency
                .trim()
                .toUpperCase()
            : null;

        if (
          moeda &&
          moeda !== "BRL"
        ) {
          continue;
        }

        const candidatos = [
          dadosOferta.price,
          dadosOferta.lowPrice,
          (
            dadosOferta
              .priceSpecification &&
            typeof dadosOferta
              .priceSpecification ===
              "object"
              ? (
                  dadosOferta
                    .priceSpecification as Record<
                    string,
                    unknown
                  >
                ).price
              : null
          ),
        ];

        for (
          const candidato
          of candidatos
        ) {
          const preco =
            converterPrecoPagina(
              candidato,
            );

          if (
            preco !== null &&
            preco > 0
          ) {
            return preco;
          }
        }
      }
    }

    for (
      const filho
      of Object.values(
        registro,
      )
    ) {
      const encontrado =
        visitar(filho);

      if (
        encontrado !== null
      ) {
        return encontrado;
      }
    }

    return null;
  };

  while (
    (match =
      regex.exec(html)) !==
    null
  ) {
    const jsonBruto =
      match[1]?.trim();

    if (!jsonBruto) {
      continue;
    }

    try {
      const json =
        JSON.parse(
          jsonBruto,
        );

      const valor =
        visitar(json);

      if (
        valor !== null &&
        valor > 0
      ) {
        return {
          valor,
          fonte:
            "json-ld-product",
        };
      }
    } catch {
      // Ignora JSON-LD inválido e continua.
    }
  }

  return null;
}

function coletarCandidatosPrecoPagina(
  html: string,
): CandidatoPrecoPagina[] {
  const candidatos:
    CandidatoPrecoPagina[] =
    [];

  /*
   * Não usamos mais Math.min() sobre a página inteira.
   *
   * Uma página do AliExpress pode carregar recomendações,
   * outros SKUs e campanhas no mesmo HTML. O menor número
   * encontrado pode não ser o preço principal do produto.
   *
   * A prioridade abaixo representa a preferência por campos
   * que normalmente descrevem o preço promocional principal.
   */
  const camposString = [
    {
      campo:
        "formattedActivityPrice",
      prioridade: 0,
    },
    {
      campo:
        "formattedSalePrice",
      prioridade: 2,
    },
    {
      campo:
        "salePriceString",
      prioridade: 3,
    },
    {
      campo:
        "formattedPrice",
      prioridade: 4,
    },
  ];

  for (
    const {
      campo,
      prioridade,
    } of camposString
  ) {
    const regex =
      new RegExp(
        `"${campo}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
        "gi",
      );

    let match:
      RegExpExecArray | null;

    while (
      (match =
        regex.exec(html)) !==
      null
    ) {
      const bruto =
        match[1];

      if (!bruto) {
        continue;
      }

      let valor =
        bruto;

      try {
        valor =
          JSON.parse(
            `"${bruto}"`,
          );
      } catch {
        // Mantém o valor bruto.
      }

      const preco =
        converterPrecoPagina(
          valor,
        );

      if (
        preco !== null &&
        preco > 0
      ) {
        candidatos.push({
          valor:
            Math.round(
              preco * 100,
            ) / 100,
          fonte: campo,
          indice:
            match.index,
          prioridade,
        });
      }
    }
  }

  const camposNumero = [
    {
      campo:
        "minActivityAmount",
      prioridade: 1,
    },
    {
      campo:
        "activityAmount",
      prioridade: 1,
    },
  ];

  for (
    const {
      campo,
      prioridade,
    } of camposNumero
  ) {
    const regex =
      new RegExp(
        `"${campo}"\\s*:\\s*"?([0-9]+(?:\\.[0-9]+)?)"?`,
        "gi",
      );

    let match:
      RegExpExecArray | null;

    while (
      (match =
        regex.exec(html)) !==
      null
    ) {
      const preco =
        converterPrecoPagina(
          match[1],
        );

      if (
        preco !== null &&
        preco > 0
      ) {
        candidatos.push({
          valor:
            Math.round(
              preco * 100,
            ) / 100,
          fonte: campo,
          indice:
            match.index,
          prioridade,
        });
      }
    }
  }

  return candidatos;
}

function localizarOcorrencias(
  texto: string,
  termo: string,
): number[] {
  const indices: number[] =
    [];

  let inicio = 0;

  while (inicio < texto.length) {
    const indice =
      texto.indexOf(
        termo,
        inicio,
      );

    if (indice < 0) {
      break;
    }

    indices.push(indice);

    inicio =
      indice +
      termo.length;
  }

  return indices;
}

function escolherPrecoSsrDoProduto(
  html: string,
  productId: string,
): PrecoPaginaResultado | null {
  const candidatos =
    coletarCandidatosPrecoPagina(
      html,
    );

  if (
    candidatos.length === 0
  ) {
    return null;
  }

  const ocorrenciasProduto =
    localizarOcorrencias(
      html,
      productId,
    );

  /*
   * Exigimos proximidade entre o campo de preço e o Product ID
   * principal. Isso reduz muito o risco de capturar preço de
   * recomendação, banner ou outro SKU carregado no HTML.
   */
  if (
    ocorrenciasProduto.length === 0
  ) {
    return null;
  }

  const candidatosDoProduto =
    candidatos
      .map(
        (candidato) => {
          const distancia =
            ocorrenciasProduto.reduce(
              (
                menor,
                indiceProduto,
              ) =>
                Math.min(
                  menor,
                  Math.abs(
                    candidato.indice -
                      indiceProduto,
                  ),
                ),
              Number.POSITIVE_INFINITY,
            );

          return {
            ...candidato,
            distancia,
          };
        },
      )
      .filter(
        (candidato) =>
          candidato.distancia <=
          30000,
      )
      .sort(
        (a, b) =>
          a.prioridade -
            b.prioridade ||
          a.distancia -
            b.distancia ||
          a.indice -
            b.indice,
      );

  const escolhido =
    candidatosDoProduto[0];

  if (!escolhido) {
    return null;
  }

  return {
    valor:
      escolhido.valor,
    fonte:
      `ssr:${escolhido.fonte}`,
  };
}

function extrairPrecoPrincipalDaPagina(
  html: string,
  productId: string,
): PrecoPaginaResultado | null {
  return (
    extrairPrecoMetaProduto(
      html,
    ) ??
    extrairPrecoJsonLdProduto(
      html,
    ) ??
    escolherPrecoSsrDoProduto(
      html,
      productId,
    )
  );
}

function extrairPrecoContextualPdpNpi(
  rawUrl: string,
): {
  valor: number;
  precoAnterior: number | null;
  fonte: string;
} | null {
  try {
    const url =
      new URL(rawUrl);

    const pdpNpi =
      url.searchParams.get(
        "pdp_npi",
      );

    if (!pdpNpi) {
      return null;
    }

    /*
     * Exemplo real:
     * 6@dis!BRL!91.74!29.03!...
     *
     * Após BRL:
     * - primeiro valor = preço anterior/de referência;
     * - segundo valor = preço contextual de venda.
     */
    const partes =
      pdpNpi.split("!");

    const indiceBrl =
      partes.findIndex(
        (parte) =>
          parte
            .trim()
            .toUpperCase() ===
          "BRL",
      );

    if (indiceBrl < 0) {
      return null;
    }

    const precoAnterior =
      converterPrecoPagina(
        partes[
          indiceBrl + 1
        ],
      );

    const valor =
      converterPrecoPagina(
        partes[
          indiceBrl + 2
        ],
      );

    if (
      valor === null ||
      valor <= 0
    ) {
      return null;
    }

    return {
      valor:
        Math.round(
          valor * 100,
        ) / 100,

      precoAnterior:
        precoAnterior !== null &&
        precoAnterior > valor
          ? Math.round(
              precoAnterior * 100,
            ) / 100
          : null,

      fonte:
        "url:pdp_npi",
    };
  } catch {
    return null;
  }
}

function prepararUrlPaginaBrasil(
  rawUrl: string,
  productId: string,
): URL {
  let url: URL;

  try {
    url =
      new URL(rawUrl);
  } catch {
    url =
      new URL(
        `https://www.aliexpress.com/item/${productId}.html`,
      );
  }

  const host =
    url.hostname
      .toLowerCase();

  if (
    !host.includes(
      "aliexpress.",
    )
  ) {
    url =
      new URL(
        `https://www.aliexpress.com/item/${productId}.html`,
      );
  }

  /*
   * Preservamos os parâmetros do link original, pois campanhas
   * como SuperDeals podem depender deles. Apenas acrescentamos
   * a adaptação para a experiência brasileira.
   */
  url.searchParams.set(
    "gatewayAdapt",
    "glo2bra",
  );

  return url;
}

async function buscarPrecoExibidoNaPagina(
  productId: string,
  finalUrl: string,
): Promise<PrecoPaginaResultado | null> {
  const urls = [
    prepararUrlPaginaBrasil(
      finalUrl,
      productId,
    ),
    prepararUrlPaginaBrasil(
      `https://www.aliexpress.com/item/${productId}.html`,
      productId,
    ),
  ];

  const urlsUnicas =
    Array.from(
      new Map(
        urls.map(
          (url) => [
            url.toString(),
            url,
          ],
        ),
      ).values(),
    );

  for (
    const url of urlsUnicas
  ) {
    try {
      const response =
        await fetch(
          url.toString(),
          {
            method: "GET",

            redirect:
              "follow",

            cache:
              "no-store",

            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36",

              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

              "Accept-Language":
                "pt-BR,pt;q=0.9,en;q=0.8",

              Cookie:
                "aep_usuc_f=site=glo&c_tp=BRL&region=BR&b_locale=pt_BR; intl_locale=pt_BR",
            },
          },
        );

      if (!response.ok) {
        continue;
      }

      const html =
        await response.text();

      if (
        !html ||
        html.length < 1000
      ) {
        continue;
      }

      const resultado =
        extrairPrecoPrincipalDaPagina(
          html,
          productId,
        );

      if (
        resultado &&
        resultado.valor > 0
      ) {
        return resultado;
      }
    } catch {
      // Tenta a próxima URL e, depois, a API oficial.
    }
  }

  return null;
}

function criarHtmlVirtual(
  produto: ProdutoAliExpressApi,
  productId: string,
  finalUrl: string,
  affiliateLink: string | null,
): string {
  const titulo =
    produto
      .product_title
      ?.trim() ||
    `Produto AliExpress ${productId}`;

  const imagens =
    normalizarImagens(
      produto,
    );

  const imagem =
    imagens[0] || "";

  /*
   * IMPORTANTE:
   *
   * Como target_currency=BRL,
   * devemos priorizar os campos
   * target_*.
   *
   * sale_price/original_price
   * podem vir na moeda original
   * do vendedor.
   */
  const precoAtual =
    produto
      .target_sale_price ??
    produto
      .target_app_sale_price ??
    produto.sale_price ??
    produto.app_sale_price ??
    null;

  const precoAnterior =
    produto
      .target_original_price ??
    produto.original_price ??
    null;

  const moedaAtual =
    produto
      .target_sale_price_currency ||
    produto
      .target_app_sale_price_currency ||
    produto
      .sale_price_currency ||
    produto
      .app_sale_price_currency ||
    "BRL";

  const categoria =
    produto
      .second_level_category_name ||
    produto
      .first_level_category_name ||
    null;

  const promotionLink =
    limparUrl(
      produto.promotion_link,
    );

  const productUrl =
    limparUrl(
      produto.product_detail_url,
    ) ||
    finalUrl;

  /*
   * O parser já existente do
   * AliExpress consegue ler
   * JSON embutido no HTML.
   *
   * Por isso criamos uma página
   * virtual com os dados oficiais
   * retornados pela API.
   */
  const dados = {
    productId,
    product_id:
      productId,

    externalId:
      productId,

    title:
      titulo,

    productTitle:
      titulo,

    product_title:
      titulo,

    image:
      imagem,

    mainImage:
      imagem,

    productMainImageUrl:
      imagem,

    product_main_image_url:
      imagem,

    images:
      imagens,

    imagePathList:
      imagens,

    productSmallImageUrls:
      imagens,

    product_small_image_urls:
      imagens,

    price:
      precoAtual,

    salePrice:
      precoAtual,

    sale_price:
      precoAtual,

    targetSalePrice:
      precoAtual,

    target_sale_price:
      precoAtual,

    currency:
      moedaAtual,

    currencyCode:
      moedaAtual,

    priceCurrency:
      moedaAtual,

    salePriceCurrency:
      moedaAtual,

    sale_price_currency:
      moedaAtual,

    targetSalePriceCurrency:
      moedaAtual,

    target_sale_price_currency:
      moedaAtual,

    oldPrice:
      precoAnterior,

    originalPrice:
      precoAnterior,

    original_price:
      precoAnterior,

    targetOriginalPrice:
      precoAnterior,

    target_original_price:
      precoAnterior,

    discount:
      produto.discount ??
      null,

    commissionRate:
      produto
        .commission_rate ??
      null,

    commission_rate:
      produto
        .commission_rate ??
      null,

    rating:
      produto
        .evaluate_rate ??
      null,

    evaluateRate:
      produto
        .evaluate_rate ??
      null,

    evaluate_rate:
      produto
        .evaluate_rate ??
      null,

    sales:
      produto
        .lastest_volume ??
      null,

    lastestVolume:
      produto
        .lastest_volume ??
      null,

    lastest_volume:
      produto
        .lastest_volume ??
      null,

    category:
      categoria,

    categoryName:
      categoria,

    firstLevelCategoryName:
      produto
        .first_level_category_name ??
      null,

    first_level_category_name:
      produto
        .first_level_category_name ??
      null,

    secondLevelCategoryName:
      produto
        .second_level_category_name ??
      null,

    second_level_category_name:
      produto
        .second_level_category_name ??
      null,

    seller:
      produto.shop_name ??
      null,

    shopName:
      produto.shop_name ??
      null,

    shop_name:
      produto.shop_name ??
      null,

    shopUrl:
      limparUrl(
        produto.shop_url,
      ),

    shop_url:
      limparUrl(
        produto.shop_url,
      ),

    video:
      limparUrl(
        produto.product_video_url,
      ),

    productVideoUrl:
      limparUrl(
        produto.product_video_url,
      ),

    product_video_url:
      limparUrl(
        produto.product_video_url,
      ),

    productUrl,

    productDetailUrl:
      productUrl,

    product_detail_url:
      productUrl,

    affiliateLink:
      affiliateLink ||
      promotionLink,

    promotionLink,

    promotion_link:
      promotionLink,
  };

  const json =
    JSON.stringify(dados)
      .replace(
        /</g,
        "\\u003c",
      );

  return [
    "<!doctype html>",
    '<html lang="pt-BR">',
    "<head>",
    '<meta charset="utf-8">',

    `<title>${escaparHtml(
      titulo,
    )}</title>`,

    `<meta property="og:title" content="${escaparHtml(
      titulo,
    )}">`,

    imagem
      ? `<meta property="og:image" content="${escaparHtml(
          imagem,
        )}">`
      : "",

    `<meta property="product:price:amount" content="${escaparHtml(
      String(
        precoAtual ?? "",
      ),
    )}">`,

    `<meta property="product:price:currency" content="${escaparHtml(
      moedaAtual,
    )}">`,

    "</head>",

    "<body>",

    '<script id="__OFERTANO_ALIEXPRESS_API__" type="application/json">',

    json,

    "</script>",

    "</body>",
    "</html>",
  ].join("");
}

export async function carregarPaginaAliExpress(
  url: string,
): Promise<PaginaAliExpress> {
  const requestedUrl =
    limparUrl(url) ??
    url.trim();

  if (!requestedUrl) {
    throw new Error(
      "Informe o link do produto do AliExpress.",
    );
  }

  const {
    finalUrl,
    productId,
  } =
    await resolverUrlProduto(
      requestedUrl,
    );

  const produtoApi =
    await buscarProdutoApi(
      productId,
    );

  /*
   * O preço mostrado ao comprador pode ser menor que o preço
   * genérico retornado pela Affiliate API (ex.: Welcome Deal /
   * SuperDeals). Por isso tentamos ler primeiro o preço
   * promocional publicado na própria página brasileira.
   *
   * Se a página não puder ser lida normalmente, mantemos
   * integralmente o preço oficial da API.
   */
  const precoPagina =
    await buscarPrecoExibidoNaPagina(
      productId,
      finalUrl,
    );

  /*
   * Em vários acessos o HTML entregue ao servidor não contém
   * o preço, embora o navegador mostre o valor normalmente.
   *
   * Quando isso acontece, o próprio link do AliExpress pode
   * carregar o contexto de preço no parâmetro pdp_npi.
   */
  const precoContextualLink =
    extrairPrecoContextualPdpNpi(
      finalUrl,
    ) ??
    extrairPrecoContextualPdpNpi(
      requestedUrl,
    );

  /*
   * Ordem de prioridade:
   *
   * 1. preço principal validado no HTML da página;
   * 2. preço contextual BRL do próprio link (pdp_npi);
   * 3. Affiliate API como fallback.
   */
  const precoPrincipal =
    precoPagina ??
    precoContextualLink;

  const produto:
    ProdutoAliExpressApi =
    precoPrincipal
      ? {
          ...produtoApi,

          target_sale_price:
            precoPrincipal.valor,

          target_sale_price_currency:
            "BRL",

          target_original_price:
            precoPrincipal
              .precoAnterior ??
            produtoApi
              .target_original_price,

          target_original_price_currency:
            precoPrincipal
              .precoAnterior !==
            undefined &&
            precoPrincipal
              .precoAnterior !==
            null
              ? "BRL"
              : produtoApi
                  .target_original_price_currency,

          /*
           * Impede o campo de app da API de voltar a sobrescrever
           * o preço contextual que acabamos de validar.
           */
          target_app_sale_price:
            undefined,

          target_app_sale_price_currency:
            undefined,
        }
      : produtoApi;

  const promotionLink =
    limparUrl(
      produto.promotion_link,
    );

  /*
   * Se o usuário colou um
   * s.click.aliexpress.com,
   * preservamos exatamente o
   * link individual de afiliado.
   *
   * Caso tenha sido colado um
   * link normal do produto,
   * usamos o promotion_link
   * devolvido pela API.
   */
  const affiliateLink =
    ehLinkAfiliado(
      requestedUrl,
    )
      ? requestedUrl
      : promotionLink;

  const html =
    criarHtmlVirtual(
      produto,
      productId,
      finalUrl,
      affiliateLink,
    );

  return {
    html,

    requestedUrl,

    finalUrl,

    affiliateLink,
  };
}