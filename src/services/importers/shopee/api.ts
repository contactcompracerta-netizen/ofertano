import { createHash } from "node:crypto";

import * as cheerio from "cheerio";

const SHOPEE_GRAPHQL_ENDPOINT =
  "https://open-api.affiliate.shopee.com.br/graphql";

const REQUEST_TIMEOUT_MS = 20_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/138.0.0.0 Safari/537.36";

export type ShopeeAffiliateOffer = {
  itemId: number;
  shopId: number;

  productName: string;
  shopName: string;

  price: string;
  priceMin: string;
  priceMax: string;

  imageUrl: string;

  productLink: string;
  offerLink: string;

  ratingStar: string;
  sales: number;

  priceDiscountRate: number;

  commissionRate: string;
  commission: string;

  appExistRate: string;
  appNewRate: string;
  webExistRate: string;
  webNewRate: string;

  periodStartTime: number;
  periodEndTime: number;

  productCatIds: number[];
  shopType: number[];

  sellerCommissionRate: string;
  shopeeCommissionRate: string;
};

type ShopeeGraphqlError = {
  message?: string;

  extensions?: {
    code?: number | string;
    message?: string;
  };
};

type ShopeeProductOfferResponse = {
  data?: {
    productOfferV2?: {
      nodes?: ShopeeAffiliateOffer[];

      pageInfo?: {
        page: number;
        limit: number;
        hasNextPage: boolean;
        scrollId: string | null;
      };
    };
  };

  errors?: ShopeeGraphqlError[];
};

function obterCredenciaisShopee() {
  const appId =
    process.env.SHOPEE_AFFILIATE_APP_ID?.trim();

  const secret =
    process.env.SHOPEE_AFFILIATE_SECRET?.trim();

  if (!appId) {
    throw new Error(
      "SHOPEE_AFFILIATE_APP_ID não foi configurado.",
    );
  }

  if (!secret) {
    throw new Error(
      "SHOPEE_AFFILIATE_SECRET não foi configurado.",
    );
  }

  return {
    appId,
    secret,
  };
}

function validarIdNumerico(
  valor: string,
  nome: string,
): string {
  const id = valor.trim();

  if (!/^\d+$/.test(id)) {
    throw new Error(
      `${nome} da Shopee é inválido.`,
    );
  }

  return id;
}

function criarAuthorization(
  payload: string,
): string {
  const {
    appId,
    secret,
  } = obterCredenciaisShopee();

  const timestamp = Math.floor(
    Date.now() / 1000,
  ).toString();

  const signature = createHash("sha256")
    .update(
      `${appId}${timestamp}${payload}${secret}`,
      "utf8",
    )
    .digest("hex");

  return (
    `SHA256 Credential=${appId}, ` +
    `Timestamp=${timestamp}, ` +
    `Signature=${signature}`
  );
}

async function executarGraphqlShopee<T>(
  query: string,
): Promise<T> {
  const payload = JSON.stringify({
    query,
  });

  const authorization =
    criarAuthorization(payload);

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      SHOPEE_GRAPHQL_ENDPOINT,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            authorization,
        },

        body: payload,

        cache: "no-store",

        signal: controller.signal,
      },
    );

    const text =
      await response.text();

    if (!response.ok) {
      throw new Error(
        `A API da Shopee respondeu com HTTP ${response.status}.`,
      );
    }

    let json: T;

    try {
      json = JSON.parse(text) as T;
    } catch {
      throw new Error(
        "A API da Shopee retornou uma resposta inválida.",
      );
    }

    return json;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new Error(
        "A API da Shopee demorou demais para responder.",
      );
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(
      "Não foi possível consultar a API da Shopee.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

function mensagemErroGraphql(
  errors: ShopeeGraphqlError[] | undefined,
): string | null {
  if (!errors?.length) {
    return null;
  }

  const primeiroErro = errors[0];

  const mensagem =
    primeiroErro.extensions?.message?.trim() ||
    primeiroErro.message?.trim();

  return (
    mensagem ||
    "A API da Shopee retornou um erro."
  );
}

export async function buscarOfertaShopeePorIds(
  shopIdRaw: string,
  itemIdRaw: string,
): Promise<ShopeeAffiliateOffer> {
  const shopId =
    validarIdNumerico(
      shopIdRaw,
      "shopId",
    );

  const itemId =
    validarIdNumerico(
      itemIdRaw,
      "itemId",
    );

  const query = `{
    productOfferV2(
      itemId: ${itemId},
      shopId: ${shopId}
    ) {
      nodes {
        itemId
        commissionRate
        appExistRate
        appNewRate
        webExistRate
        webNewRate
        commission
        price
        sales
        imageUrl
        productName
        shopName
        productLink
        offerLink
        periodEndTime
        periodStartTime
        priceMin
        priceMax
        productCatIds
        ratingStar
        priceDiscountRate
        shopId
        shopType
        sellerCommissionRate
        shopeeCommissionRate
      }

      pageInfo {
        page
        limit
        hasNextPage
        scrollId
      }
    }
  }`;

  const resultado =
    await executarGraphqlShopee<
      ShopeeProductOfferResponse
    >(query);

  const erro =
    mensagemErroGraphql(
      resultado.errors,
    );

  if (erro) {
    throw new Error(
      `Erro na API da Shopee: ${erro}`,
    );
  }

  const ofertas =
    resultado.data
      ?.productOfferV2
      ?.nodes ?? [];

  const ofertaExata =
    ofertas.find(
      (oferta) =>
        String(oferta.itemId) ===
          itemId &&
        String(oferta.shopId) ===
          shopId,
    );

  if (!ofertaExata) {
    throw new Error(
      "Esse produto não foi encontrado no programa de afiliados da Shopee.",
    );
  }

  if (
    !ofertaExata.offerLink?.trim()
  ) {
    throw new Error(
      "A Shopee não retornou um link de afiliado para este produto.",
    );
  }

  return ofertaExata;
}

/*
 * ==========================================================
 * COMPATIBILIDADE TEMPORÁRIA
 * ==========================================================
 *
 * As funções abaixo permanecem somente enquanto migramos
 * o index.ts da Shopee para a API oficial.
 *
 * Depois que a migração estiver concluída e validada,
 * poderemos remover a leitura antiga por HTML.
 */

export type ShopeePageResult = {
  $: ReturnType<typeof cheerio.load>;
  html: string;
  originalUrl: string;
  finalUrl: string;
};

function dominioShopeePermitido(
  hostname: string,
): boolean {
  const dominio =
    hostname.toLowerCase();

  return (
    dominio === "shopee.com.br" ||
    dominio.endsWith(
      ".shopee.com.br",
    )
  );
}

function validarUrlShopee(
  valor: string,
): URL {
  let url: URL;

  try {
    url = new URL(valor);
  } catch {
    throw new Error(
      "O endereço informado não é um link válido.",
    );
  }

  if (
    url.protocol !== "https:" &&
    url.protocol !== "http:"
  ) {
    throw new Error(
      "O link da Shopee precisa começar com http ou https.",
    );
  }

  if (
    !dominioShopeePermitido(
      url.hostname,
    )
  ) {
    throw new Error(
      "O link informado não pertence à Shopee Brasil.",
    );
  }

  return url;
}

function paginaBloqueada(
  $: ReturnType<typeof cheerio.load>,
  html: string,
): boolean {
  const titulo = $("title")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const textoPagina = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const htmlNormalizado = html
    .replace(/\s+/g, " ")
    .toLowerCase();

  return (
    titulo.includes(
      "access denied",
    ) ||
    titulo.includes("captcha") ||
    textoPagina.includes(
      "access denied",
    ) ||
    textoPagina.includes(
      "verifique que você é humano",
    ) ||
    textoPagina.includes(
      "verify you are human",
    ) ||
    textoPagina.includes(
      "unusual activity",
    ) ||
    htmlNormalizado.includes(
      "cf-chl-captcha",
    ) ||
    htmlNormalizado.includes(
      "challenge-platform",
    )
  );
}

export async function carregarPaginaShopee(
  rawUrl: string,
): Promise<ShopeePageResult> {
  const originalUrl =
    rawUrl.trim();

  if (!originalUrl) {
    throw new Error(
      "Cole o link do produto da Shopee.",
    );
  }

  const url =
    validarUrlShopee(
      originalUrl,
    );

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(
      url.toString(),
      {
        method: "GET",
        redirect: "follow",

        headers: {
          "User-Agent":
            USER_AGENT,

          Accept:
            "text/html,application/xhtml+xml," +
            "application/xml;q=0.9,image/avif," +
            "image/webp,*/*;q=0.8",

          "Accept-Language":
            "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",

          "Cache-Control":
            "no-cache",

          Pragma: "no-cache",
        },

        cache: "no-store",

        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(
        `Não foi possível acessar a Shopee (${response.status}).`,
      );
    }

    const finalUrl =
      response.url ||
      url.toString();

    let urlFinal: URL;

    try {
      urlFinal =
        new URL(finalUrl);
    } catch {
      throw new Error(
        "A Shopee retornou um endereço inválido.",
      );
    }

    if (
      !dominioShopeePermitido(
        urlFinal.hostname,
      )
    ) {
      throw new Error(
        "O link não redirecionou para uma página da Shopee Brasil.",
      );
    }

    const contentType =
      response.headers.get(
        "content-type",
      ) ?? "";

    if (
      contentType &&
      !contentType.includes(
        "text/html",
      ) &&
      !contentType.includes(
        "application/xhtml+xml",
      )
    ) {
      throw new Error(
        "A Shopee não retornou uma página de produto válida.",
      );
    }

    const html =
      await response.text();

    if (!html.trim()) {
      throw new Error(
        "A página da Shopee retornou vazia.",
      );
    }

    const $ =
      cheerio.load(html);

    if (
      paginaBloqueada(
        $,
        html,
      )
    ) {
      throw new Error(
        "A Shopee bloqueou temporariamente a consulta automática. Tente novamente mais tarde.",
      );
    }

    return {
      $,
      html,
      originalUrl,
      finalUrl,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new Error(
        "A Shopee demorou demais para responder.",
      );
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(
      "Não foi possível acessar a página da Shopee.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolverUrlShopee(
  originalUrl: string,
): Promise<string> {
  const pagina =
    await carregarPaginaShopee(
      originalUrl,
    );

  return pagina.finalUrl;
}