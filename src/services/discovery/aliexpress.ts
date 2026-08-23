import { createHmac } from "node:crypto";

import type {
  DiscoveryCandidate,
  DiscoveryQuery,
  MarketplaceDiscoveryResult,
} from "./core/types";

const MARKETPLACE = "ALIEXPRESS" as const;
const MARKETPLACE_NAME = "AliExpress" as const;

const ENDPOINT =
  "https://api-sg.aliexpress.com/sync";

const METHOD =
  "aliexpress.affiliate.product.query";

const TIMEOUT_MS = 25_000;

const TERMOS_ACESSORIOS = [
  "capa",
  "capas",
  "capinha",
  "capinhas",
  "case",
  "cases",
  "pelicula",
  "peliculas",
  "vidro",
  "cabo",
  "cabos",
  "carregador",
  "carregadores",
  "fonte",
  "fontes",
  "adaptador",
  "adaptadores",
  "suporte",
  "suportes",
  "base",
  "bases",
  "stand",
  "stands",
  "pedestal",
  "pedestais",
  "protetor",
  "protetores",
  "bumper",
  "skin",
  "adesivo",
  "adesivos",
  "fone",
  "fones",
  "headset",
  "earphone",
  "earphones",
  "borracha",
  "borrachas",
  "vedacao",
  "vedacoes",
  "anel de vedacao",
  "aneis de vedacao",
  "anel",
  "aneis",
  "pino",
  "pinos",
  "peso",
  "pesos",
  "peso regulador",
  "pesos reguladores",
  "regulador",
  "reguladores",
  "valvula",
  "valvulas",
  "gaxeta",
  "gaxetas",
  "guarnicao",
  "guarnicoes",
  "reparo",
  "reparos",
  "kit reparo",
  "kit de reparo",
  "reposicao",
  "reposicoes",
  "peca de reposicao",
  "pecas de reposicao",
  "tampa",
  "tampas",
  "alca",
  "alcas",
  "antena",
  "antenas",
  "controle remoto",
  "controles remotos",
  "remote control",
  "remote controls",
  "soundbar",
  "sound bar",
  "barra de som",
  "pulseira",
  "pulseiras",
  "strap",
  "straps",
  "screen protector",
  "protetor de tela",
  "protetores de tela",
  "lenco",
  "lencos",
  "limpeza",
  "ferramenta",
  "ferramentas",
  "conector",
  "conectores",
  "flex",
];

const TERMOS_CONDICAO_NAO_NOVA = [
  "usado",
  "usada",
  "usados",
  "usadas",
  "seminovo",
  "seminova",
  "seminovos",
  "seminovas",
  "recondicionado",
  "recondicionada",
  "recondicionados",
  "recondicionadas",
  "refurbished",
  "renewed",
  "open box",
];

const FAMILIAS_VARIANTE_ESTRITA = [
  "iphone",
  "galaxy",
  "redmi",
  "poco",
  "moto g",
  "moto e",
  "moto edge",
  "macbook",
  "ipad",
  "echo dot",
  "echo show",
  "echo pop",
];

const QUALIFICADORES_MODELO = [
  "pro max",
  "pro",
  "max",
  "plus",
  "mini",
  "air",
  "ultra",
  "lite",
  "fe",
];

const MARCAS_CONHECIDAS = [
  "samsung",
  "lg",
  "apple",
  "motorola",
  "xiaomi",
  "redmi",
  "poco",
  "sony",
  "philips",
  "tcl",
  "hisense",
  "panasonic",
  "jbl",
  "lenovo",
  "asus",
  "acer",
  "dell",
  "hp",
  "electrolux",
  "brastemp",
  "consul",
  "mondial",
  "philco",
];

type AliExpressProduct = {
  product_id?: string | number;
  product_title?: string;
  product_main_image_url?: string;
  product_detail_url?: string;
  promotion_link?: string;

  sale_price?: string | number;
  sale_price_currency?: string;

  target_sale_price?: string | number;
  target_sale_price_currency?: string;

  original_price?: string | number;
  original_price_currency?: string;

  target_original_price?: string | number;
  target_original_price_currency?: string;

  app_sale_price?: string | number;
  app_sale_price_currency?: string;

  target_app_sale_price?: string | number;
  target_app_sale_price_currency?: string;

  lastest_volume?: string | number;

  first_level_category_name?: string;
  second_level_category_name?: string;

  shop_id?: string | number;
  shop_name?: string;
};

type AliExpressRespResult = {
  resp_code?: string | number;
  resp_msg?: string;

  result?: {
    current_page_no?: string | number;
    current_record_count?: string | number;

    products?:
      | AliExpressProduct[]
      | {
          product?: AliExpressProduct[];
        };
  };
};

type AliExpressResponse = {
  code?: string | number;
  message?: string;
  request_id?: string;

  resp_result?: AliExpressRespResult;

  aliexpress_affiliate_product_query_response?: {
    resp_result?: AliExpressRespResult;
  };

  error_response?: {
    code?: string | number;
    msg?: string;
    sub_code?: string;
    sub_msg?: string;
    request_id?: string;
  };
};

function limitarQuantidade(
  valor: number,
): number {
  if (!Number.isFinite(valor)) {
    return 5;
  }

  return Math.min(
    Math.max(
      Math.trunc(valor),
      1,
    ),
    20,
  );
}

function normalizarTexto(
  valor: string,
): string {
  return valor
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .toLowerCase()
    .replace(
      /([a-z])(\d)/g,
      "$1 $2",
    )
    .replace(
      /(\d)([a-z])/g,
      "$1 $2",
    )
    .replace(
      /[^a-z0-9]+/g,
      " ",
    )
    .trim()
    .replace(/\s+/g, " ");
}

function contemExpressao(
  textoNormalizado: string,
  expressao: string,
): boolean {
  return (
    ` ${textoNormalizado} `
  ).includes(
    ` ${normalizarTexto(
      expressao,
    )} `,
  );
}

function calcularRelevancia(
  titulo: string,
  consulta: string,
): number {
  const tituloNormalizado =
    normalizarTexto(titulo);

  const termos =
    Array.from(
      new Set(
        normalizarTexto(consulta)
          .split(" ")
          .filter(
            (termo) =>
              termo.length >= 2 ||
              /^\d+$/.test(
                termo,
              ),
          ),
      ),
    );

  if (termos.length === 0) {
    return 0;
  }

  const tokensTitulo =
    new Set(
      tituloNormalizado.split(" "),
    );

  const encontrados =
    termos.filter(
      (termo) =>
        tokensTitulo.has(
          termo,
        ),
    ).length;

  return (
    encontrados /
    termos.length
  );
}

function possuiAcessorioNaoSolicitado(
  titulo: string,
  consulta: string,
): boolean {
  const tituloNormalizado =
    normalizarTexto(titulo);

  const consultaNormalizada =
    normalizarTexto(consulta);

  return TERMOS_ACESSORIOS.some(
    (termo) =>
      contemExpressao(
        tituloNormalizado,
        termo,
      ) &&
      !contemExpressao(
        consultaNormalizada,
        termo,
      ),
  );
}

function possuiCondicaoNaoNova(
  titulo: string,
): boolean {
  const normalizado =
    normalizarTexto(titulo);

  return TERMOS_CONDICAO_NAO_NOVA.some(
    (termo) =>
      contemExpressao(
        normalizado,
        termo,
      ),
  );
}

function marcaCompativel(
  titulo: string,
  consulta: string,
): boolean {
  const consultaNormalizada =
    normalizarTexto(consulta);

  const tituloNormalizado =
    normalizarTexto(titulo);

  const marcasSolicitadas =
    MARCAS_CONHECIDAS.filter(
      (marca) =>
        contemExpressao(
          consultaNormalizada,
          marca,
        ),
    );

  if (
    marcasSolicitadas.length === 0
  ) {
    return true;
  }

  return marcasSolicitadas.every(
    (marca) =>
      contemExpressao(
        tituloNormalizado,
        marca,
      ),
  );
}

function usaFamiliaComVarianteEstrita(
  consulta: string,
): boolean {
  const normalizado =
    normalizarTexto(consulta);

  return FAMILIAS_VARIANTE_ESTRITA.some(
    (familia) =>
      normalizado.includes(
        normalizarTexto(
          familia,
        ),
      ),
  );
}

function extrairQualificadoresModelo(
  valor: string,
): Set<string> {
  const texto =
    ` ${normalizarTexto(valor)} `;

  const encontrados =
    new Set<string>();

  if (
    texto.includes(
      " pro max ",
    )
  ) {
    encontrados.add(
      "pro max",
    );
  } else {
    if (
      texto.includes(
        " pro ",
      )
    ) {
      encontrados.add(
        "pro",
      );
    }

    if (
      texto.includes(
        " max ",
      )
    ) {
      encontrados.add(
        "max",
      );
    }
  }

  for (
    const qualificador of
    QUALIFICADORES_MODELO
  ) {
    if (
      qualificador ===
        "pro max" ||
      qualificador === "pro" ||
      qualificador === "max"
    ) {
      continue;
    }

    if (
      texto.includes(
        ` ${qualificador} `,
      )
    ) {
      encontrados.add(
        qualificador,
      );
    }
  }

  return encontrados;
}

function conjuntosIguais(
  primeiro: Set<string>,
  segundo: Set<string>,
): boolean {
  if (
    primeiro.size !==
    segundo.size
  ) {
    return false;
  }

  for (
    const valor of primeiro
  ) {
    if (
      !segundo.has(valor)
    ) {
      return false;
    }
  }

  return true;
}

function varianteCompativel(
  titulo: string,
  consulta: string,
): boolean {
  if (
    !usaFamiliaComVarianteEstrita(
      consulta,
    )
  ) {
    return true;
  }

  return conjuntosIguais(
    extrairQualificadoresModelo(
      consulta,
    ),
    extrairQualificadoresModelo(
      titulo,
    ),
  );
}

function extrairCapacidades(
  valor: string,
): Set<string> {
  const normalizado =
    normalizarTexto(valor);

  const encontrados =
    new Set<string>();

  const regex =
    /\b(\d+(?:[.,]\d+)?)\s*(gb|tb)\b/gi;

  for (
    const match of normalizado.matchAll(
      regex,
    )
  ) {
    const numero =
      match[1]
        ?.replace(",", ".")
        .trim();

    const unidade =
      match[2]
        ?.toLowerCase()
        .trim();

    if (
      numero &&
      unidade
    ) {
      encontrados.add(
        `${numero}${unidade}`,
      );
    }
  }

  return encontrados;
}

function extrairCapacidadesRam(
  valor: string,
): Set<string> {
  const normalizado =
    normalizarTexto(valor);

  const encontrados =
    new Set<string>();

  const regex =
    /\b(\d+(?:[.,]\d+)?)\s*(gb|tb)\b/gi;

  for (
    const match of normalizado.matchAll(
      regex,
    )
  ) {
    const inicio =
      match.index ?? 0;

    const fim =
      inicio +
      match[0].length;

    const antes =
      normalizado.slice(
        Math.max(
          0,
          inicio - 24,
        ),
        inicio,
      );

    const depois =
      normalizado.slice(
        fim,
        Math.min(
          normalizado.length,
          fim + 24,
        ),
      );

    const ramAntes =
      /(?:^|\s)(?:memoria\s+)?ram(?:\s+de)?\s*$/.test(
        antes,
      );

    const ramDepois =
      /^\s*(?:de\s+)?ram(?:\s|$)/.test(
        depois,
      );

    if (
      !ramAntes &&
      !ramDepois
    ) {
      continue;
    }

    const numero =
      match[1]
        ?.replace(",", ".")
        .trim();

    const unidade =
      match[2]
        ?.toLowerCase()
        .trim();

    if (
      numero &&
      unidade
    ) {
      encontrados.add(
        `${numero}${unidade}`,
      );
    }
  }

  return encontrados;
}

function capacidadeCompativel(
  titulo: string,
  consulta: string,
): boolean {
  const referencia =
    extrairCapacidades(
      consulta,
    );

  if (
    referencia.size === 0
  ) {
    return true;
  }

  const candidato =
    extrairCapacidades(
      titulo,
    );

  if (
    candidato.size === 0
  ) {
    return false;
  }

  if (
    conjuntosIguais(
      referencia,
      candidato,
    )
  ) {
    return true;
  }

  for (
    const capacidade of referencia
  ) {
    if (
      !candidato.has(
        capacidade,
      )
    ) {
      return false;
    }
  }

  const capacidadesRam =
    extrairCapacidadesRam(
      titulo,
    );

  for (
    const capacidade of candidato
  ) {
    if (
      referencia.has(
        capacidade,
      )
    ) {
      continue;
    }

    if (
      !capacidadesRam.has(
        capacidade,
      )
    ) {
      return false;
    }
  }

  return true;
}

function possuiBundleNaoSolicitado(
  titulo: string,
  consulta: string,
): boolean {
  const tituloNormalizado =
    normalizarTexto(titulo);

  const consultaNormalizada =
    normalizarTexto(consulta);

  const termos = [
    "kit",
    "combo",
    "bundle",
    "conjunto",
  ];

  return termos.some(
    (termo) =>
      contemExpressao(
        tituloNormalizado,
        termo,
      ) &&
      !contemExpressao(
        consultaNormalizada,
        termo,
      ),
  );
}

function converterPreco(
  valor:
    | string
    | number
    | null
    | undefined,
): number | null {
  if (
    typeof valor === "number"
  ) {
    return (
      Number.isFinite(valor) &&
      valor > 0
    )
      ? valor
      : null;
  }

  if (
    typeof valor !== "string"
  ) {
    return null;
  }

  let texto =
    valor
      .trim()
      .replace(
        /[^\d,.-]/g,
        "",
      );

  if (!texto) {
    return null;
  }

  const ultimaVirgula =
    texto.lastIndexOf(",");

  const ultimoPonto =
    texto.lastIndexOf(".");

  if (
    ultimaVirgula >= 0 &&
    ultimoPonto >= 0
  ) {
    if (
      ultimaVirgula >
      ultimoPonto
    ) {
      texto =
        texto
          .replace(/\./g, "")
          .replace(",", ".");
    } else {
      texto =
        texto.replace(/,/g, "");
    }
  } else if (
    ultimaVirgula >= 0
  ) {
    texto =
      texto.replace(",", ".");
  }

  const numero =
    Number(texto);

  return (
    Number.isFinite(numero) &&
    numero > 0
  )
    ? numero
    : null;
}

function moedaEhBrl(
  moeda:
    | string
    | null
    | undefined,
): boolean {
  return (
    moeda
      ?.trim()
      .toUpperCase() ===
    "BRL"
  );
}

function extrairPrecoContextualPdpNpi(
  rawUrl:
    | string
    | null
    | undefined,
): {
  preco: number;
  precoAnterior: number | null;
} | null {
  if (!rawUrl) {
    return null;
  }

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

    const partes =
      decodeURIComponent(
        pdpNpi,
      ).split("!");

    const indiceBrl =
      partes.findIndex(
        (parte) =>
          parte
            .trim()
            .toUpperCase() ===
          "BRL",
      );

    if (
      indiceBrl < 0 ||
      indiceBrl + 2 >=
        partes.length
    ) {
      return null;
    }

    const precoAnterior =
      converterPreco(
        partes[
          indiceBrl + 1
        ],
      );

    const preco =
      converterPreco(
        partes[
          indiceBrl + 2
        ],
      );

    if (!preco) {
      return null;
    }

    return {
      preco,

      precoAnterior:
        precoAnterior &&
        precoAnterior > preco
          ? precoAnterior
          : null,
    };
  } catch {
    return null;
  }
}

function obterPreco(
  produto: AliExpressProduct,
): number | null {
  const contextual =
    extrairPrecoContextualPdpNpi(
      produto
        .product_detail_url,
    );

  if (contextual) {
    return contextual.preco;
  }

  if (
    moedaEhBrl(
      produto
        .target_sale_price_currency,
    )
  ) {
    const valor =
      converterPreco(
        produto.target_sale_price,
      );

    if (valor) {
      return valor;
    }
  }

  if (
    moedaEhBrl(
      produto
        .target_app_sale_price_currency,
    )
  ) {
    const valor =
      converterPreco(
        produto
          .target_app_sale_price,
      );

    if (valor) {
      return valor;
    }
  }

  if (
    moedaEhBrl(
      produto.sale_price_currency,
    )
  ) {
    return converterPreco(
      produto.sale_price,
    );
  }

  return null;
}

function obterPrecoAnterior(
  produto: AliExpressProduct,
  precoAtual: number,
): number | null {
  const contextual =
    extrairPrecoContextualPdpNpi(
      produto
        .product_detail_url,
    );

  if (
    contextual
      ?.precoAnterior &&
    contextual.precoAnterior >
      precoAtual
  ) {
    return contextual.precoAnterior;
  }

  let anterior: number | null =
    null;

  if (
    moedaEhBrl(
      produto
        .target_original_price_currency,
    )
  ) {
    anterior =
      converterPreco(
        produto
          .target_original_price,
      );
  } else if (
    moedaEhBrl(
      produto
        .original_price_currency,
    )
  ) {
    anterior =
      converterPreco(
        produto.original_price,
      );
  }

  return (
    anterior &&
    anterior > precoAtual
  )
    ? anterior
    : null;
}

function obterRespResult(
  resposta: AliExpressResponse,
): AliExpressRespResult | null {
  return (
    resposta.resp_result ??
    resposta
      .aliexpress_affiliate_product_query_response
      ?.resp_result ??
    null
  );
}

function obterProdutos(
  resposta: AliExpressResponse,
): AliExpressProduct[] {
  const products =
    obterRespResult(
      resposta,
    )
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

function obterVariavelAmbiente(
  nome: string,
): string {
  const valor =
    process.env[nome]?.trim();

  if (!valor) {
    throw new Error(
      `A variÃ¡vel ${nome} nÃ£o estÃ¡ configurada.`,
    );
  }

  return valor;
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
          chaveA < chaveB
            ? -1
            : chaveA > chaveB
              ? 1
              : 0,
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

async function consultarAliExpress(
  query: string,
  quantidade: number,
): Promise<AliExpressProduct[]> {
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
    method: METHOD,
    app_key: appKey,
    timestamp:
      String(Date.now()),
    sign_method: "sha256",

    keywords: query,

    page_no: "1",

    page_size:
      String(
        Math.min(
          Math.max(
            quantidade,
            10,
          ),
          50,
        ),
      ),

    target_currency:
      "BRL",

    target_language:
      "PT",

    ship_to_country:
      "BR",

    platform_product_type:
      "ALL",

    sort:
      "LAST_VOLUME_DESC",

    fields: [
      "product_id",
      "product_title",
      "product_main_image_url",
      "product_detail_url",
      "promotion_link",
      "sale_price",
      "sale_price_currency",
      "target_sale_price",
      "target_sale_price_currency",
      "original_price",
      "original_price_currency",
      "target_original_price",
      "target_original_price_currency",
      "app_sale_price",
      "app_sale_price_currency",
      "target_app_sale_price",
      "target_app_sale_price_currency",
      "lastest_volume",
      "first_level_category_name",
      "second_level_category_name",
      "shop_id",
      "shop_name",
    ].join(","),
  };

  const assinatura =
    gerarAssinatura(
      parametros,
      appSecret,
    );

  const body =
    new URLSearchParams({
      ...parametros,

      sign:
        assinatura,
    });

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      TIMEOUT_MS,
    );

  try {
    const response =
      await fetch(
        ENDPOINT,
        {
          method: "POST",

          cache:
            "no-store",

          headers: {
            Accept:
              "application/json",

            "Content-Type":
              "application/x-www-form-urlencoded;charset=utf-8",
          },

          body,

          signal:
            controller.signal,
        },
      );

    const texto =
      await response.text();

    let resposta:
      AliExpressResponse;

    try {
      resposta =
        JSON.parse(texto) as
          AliExpressResponse;
    } catch {
      throw new Error(
        `AliExpress API retornou resposta invÃ¡lida. HTTP ${response.status}.`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `AliExpress API respondeu HTTP ${response.status}.`,
      );
    }

    if (
      resposta.error_response
    ) {
      const erro =
        resposta.error_response;

      const codigoErro =
        erro.code !== undefined
          ? String(erro.code)
          : "";

      const mensagemErro = [
        erro.msg ?? "",
        erro.sub_msg ?? "",
      ]
        .join(" ")
        .trim()
        .toLowerCase();

      /*
       * A AliExpress usa o código 405 com
       * "The result is empty" quando a consulta
       * simplesmente não encontrou produtos.
       *
       * Isso não é falha de integração.
       * Tratamos como busca válida com zero resultados.
       */
      if (
        codigoErro === "405" &&
        mensagemErro.includes(
          "result is empty",
        )
      ) {
        return [];
      }

      throw new Error(
        [
          "AliExpress API:",
          codigoErro,
          erro.msg ?? "",
          erro.sub_code ?? "",
          erro.sub_msg ?? "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    }

    if (
      resposta.code !==
      undefined
    ) {
      const codigoResposta =
        String(resposta.code);

      const mensagemResposta =
        String(
          resposta.message ?? "",
        )
          .trim()
          .toLowerCase();

      /*
       * A AliExpress também pode retornar
       * "405 The result is empty" no nível
       * principal da resposta.
       *
       * Isso significa zero resultados,
       * não falha da integração.
       */
      if (
        codigoResposta === "405" &&
        mensagemResposta.includes(
          "result is empty",
        )
      ) {
        return [];
      }

      if (
        codigoResposta !== "0"
      ) {
        throw new Error(
          `AliExpress API: ${codigoResposta} ${resposta.message ?? ""}`
            .trim(),
        );
      }
    }

    const respResult =
      obterRespResult(
        resposta,
      );

    if (!respResult) {
      const chaves =
        Object.keys(
          resposta,
        )
          .slice(0, 8)
          .join(", ");

      throw new Error(
        `AliExpress API respondeu sem resp_result. Chaves recebidas: ${chaves || "nenhuma"}.`,
      );
    }

    const respCode =
      respResult.resp_code;

    const respCodeTexto =
      respCode !== undefined
        ? String(respCode)
        : "";

    const respMensagem =
      String(
        respResult.resp_msg ?? "",
      )
        .trim()
        .toLowerCase();

    /*
     * A AliExpress também pode informar
     * "405 The result is empty" dentro de
     * resp_result.
     *
     * Isso representa uma busca válida
     * sem produtos encontrados.
     */
    if (
      respCodeTexto === "405" &&
      respMensagem.includes(
        "result is empty",
      )
    ) {
      return [];
    }

    if (
      !respCodeTexto ||
      ![
        "0",
        "200",
      ].includes(
        respCodeTexto,
      )
    ) {
      throw new Error(
        `AliExpress API: ${
          respCodeTexto || "sem codigo"
        } ${respResult.resp_msg ?? ""}`
          .trim(),
      );
    }
    const produtos =
      obterProdutos(
        resposta,
      );

    const quantidadeDeclarada =
      Number(
        respResult
          .result
          ?.current_record_count ??
        0,
      );

    if (
      quantidadeDeclarada > 0 &&
      produtos.length === 0
    ) {
      throw new Error(
        "AliExpress informou produtos na resposta, mas o formato recebido nÃ£o pÃ´de ser interpretado.",
      );
    }

    return produtos;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name ===
        "AbortError"
    ) {
      throw new Error(
        "A busca do AliExpress ultrapassou 25 segundos.",
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function urlHttpValida(
  valor:
    | string
    | null
    | undefined,
): string | null {
  const texto =
    valor?.trim();

  if (!texto) {
    return null;
  }

  try {
    const url =
      new URL(texto);

    if (
      url.protocol !== "https:" &&
      url.protocol !== "http:"
    ) {
      return null;
    }

    return texto;
  } catch {
    return null;
  }
}

export async function buscarAliExpress(
  request: DiscoveryQuery,
): Promise<MarketplaceDiscoveryResult> {

  const modoMultiloja =
    request.mode === "MULTILOJA";

  const query =
    request.query.trim();

  const limit =
    limitarQuantidade(
      request.limit,
    );

  if (!query) {
    return {
      marketplace:
        MARKETPLACE,

      query,

      success:
        false,

      candidates:
        [],

      scanned:
        0,

      error:
        "Consulta vazia.",
    };
  }

  try {
    const quantidadeBusca =
      Math.min(
        Math.max(
          limit * 10,
          30,
        ),
        50,
      );

    const produtos =
      await consultarAliExpress(
        query,
        quantidadeBusca,
      );

    const encontrados: Array<{
      candidate:
        DiscoveryCandidate;
      relevance:
        number;
      sales:
        number;
    }> = [];

    const ids =
      new Set<string>();

    for (
      const produto of produtos
    ) {
      const externalId =
        String(
          produto.product_id ??
            "",
        ).trim();

      const titulo =
        produto.product_title
          ?.trim() ??
        "";

      if (
        !externalId ||
        !titulo ||
        ids.has(
          externalId,
        )
      ) {
        continue;
      }

      if (
        possuiCondicaoNaoNova(
          titulo,
        )
      ) {
        continue;
      }

      if (
        !modoMultiloja && (
        possuiAcessorioNaoSolicitado(
          titulo,
          query,
        )
      
        )) {
        continue;
      }

      if (
        !modoMultiloja && (
        possuiBundleNaoSolicitado(
          titulo,
          query,
        )
      
        )) {
        continue;
      }

      if (
        !modoMultiloja && (
        !marcaCompativel(
          titulo,
          query,
        )
      
        )) {
        continue;
      }

      if (
        !modoMultiloja && (
        !varianteCompativel(
          titulo,
          query,
        )
      
        )) {
        continue;
      }

      if (
        !modoMultiloja && (
        !capacidadeCompativel(
          titulo,
          query,
        )
      
        )) {
        continue;
      }

      const relevancia =
        calcularRelevancia(
          titulo,
          query,
        );

      if (
        !modoMultiloja && (
        relevancia < 0.65
      
        )) {
        continue;
      }

      const preco =
        obterPreco(
          produto,
        );

      if (!preco) {
        continue;
      }

      const sourceUrl =
        urlHttpValida(
          produto
            .product_detail_url,
        ) ??
        `https://www.aliexpress.com/item/${externalId}.html`;

      const affiliateLink =
        urlHttpValida(
          produto
            .promotion_link,
        );

      ids.add(
        externalId,
      );

      encontrados.push({
        relevance:
          relevancia,

        sales:
          Number.isFinite(
            Number(
              produto
                .lastest_volume,
            ),
          )
            ? Number(
                produto
                  .lastest_volume,
              )
            : 0,

        candidate: {
          marketplace:
            MARKETPLACE,

          marketplaceName:
            MARKETPLACE_NAME,

          externalId,

          sourceUrl,

          affiliateLink,

          title:
            titulo,

          image:
            urlHttpValida(
              produto
                .product_main_image_url,
            ),

          price:
            preco,

          oldPrice:
            obterPrecoAnterior(
              produto,
              preco,
            ),

          category:
            produto
              .second_level_category_name
              ?.trim() ||
            produto
              .first_level_category_name
              ?.trim() ||
            null,

          brand:
            null,

          seller:
            produto.shop_name
              ?.trim() ||
            "AliExpress",

          status:
            "FOUND",

          error:
            null,
        },
      });
    }

    const candidates =
      encontrados
        .sort(
          (a, b) => {
            if (
              b.relevance !==
              a.relevance
            ) {
              return (
                b.relevance -
                a.relevance
              );
            }

            if (
              b.sales !==
              a.sales
            ) {
              return (
                b.sales -
                a.sales
              );
            }

            return (
              (
                a.candidate
                  .price ??
                Number
                  .POSITIVE_INFINITY
              ) -
              (
                b.candidate
                  .price ??
                Number
                  .POSITIVE_INFINITY
              )
            );
          },
        )
        .slice(
          0,
          limit,
        )
        .map(
          (resultado) =>
            resultado.candidate,
        );

    return {
      marketplace:
        MARKETPLACE,

      query,

      success:
        true,

      candidates,

      scanned:
        produtos.length,

      error:
        null,
    };
  } catch (error) {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido.";

    return {
      marketplace:
        MARKETPLACE,

      query,

      success:
        false,

      candidates:
        [],

      scanned:
        0,

      error:
        mensagem.slice(
          0,
          1000,
        ),
    };
  }
}


