import { createHash } from "node:crypto";

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

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(
        "A API da Shopee retornou uma resposta inválida.",
      );
    }
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

  if (!ofertaExata.offerLink?.trim()) {
    throw new Error(
      "A Shopee não retornou um link de afiliado para este produto.",
    );
  }

  return ofertaExata;
}

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

async function fetchPaginaShopee(
  rawUrl: string,
): Promise<Response> {
  const url =
    validarUrlShopee(
      rawUrl.trim(),
    );

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  try {
    return await fetch(
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
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolverUrlShopee(
  originalUrl: string,
): Promise<string> {
  const urlOriginal =
    validarUrlShopee(
      originalUrl.trim(),
    );

  try {
    const response =
      await fetchPaginaShopee(
        urlOriginal.toString(),
      );

    const finalUrl =
      response.url ||
      urlOriginal.toString();

    const urlFinal =
      validarUrlShopee(finalUrl);

    return urlFinal.toString();
  } catch {
    throw new Error(
      "Não foi possível resolver o link curto da Shopee.",
    );
  }
}

function normalizarHtmlParaImagens(
  html: string,
): string {
  return html
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/gi, '"')
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"');
}

function obterIdImagemShopee(
  valor: string,
): string | null {
  const texto =
    valor.trim();

  const urlMatch = texto.match(
    /\/file\/([^?&#/"']+)/i,
  );

  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  if (
    /^[a-z0-9][a-z0-9._-]{15,}$/i.test(
      texto,
    )
  ) {
    return texto;
  }

  return null;
}

function montarUrlImagemShopee(
  valor: string,
): string | null {
  const texto =
    valor.trim();

  if (!texto) {
    return null;
  }

  if (
    /^https?:\/\/cf\.shopee\.com\.br\/file\//i.test(
      texto,
    )
  ) {
    try {
      const url = new URL(texto);

      return (
        `${url.protocol}//${url.host}${url.pathname}`
      );
    } catch {
      return null;
    }
  }

  const id =
    obterIdImagemShopee(texto);

  if (!id) {
    return null;
  }

  return `https://cf.shopee.com.br/file/${id}`;
}

function extrairGaleriaDoHtml(
  html: string,
  imagemPrincipal: string,
): string[] {
  const principal =
    montarUrlImagemShopee(
      imagemPrincipal,
    );

  if (!principal) {
    return [];
  }

  const principalId =
    obterIdImagemShopee(
      principal,
    );

  if (!principalId) {
    return [principal];
  }

  const conteudo =
    normalizarHtmlParaImagens(
      html,
    );

  const padraoArrays =
    /"(?:images|image_list|imageList)"\s*:\s*\[([\s\S]{0,20000}?)\]/gi;

  for (
    const match of conteudo.matchAll(
      padraoArrays,
    )
  ) {
    const bloco = match[1];

    if (!bloco) {
      continue;
    }

    const valores = Array.from(
      bloco.matchAll(
        /["']([^"']+)["']/g,
      ),
      (item) => item[1],
    );

    const imagens = valores
      .map(montarUrlImagemShopee)
      .filter(
        (imagem): imagem is string =>
          Boolean(imagem),
      );

    const contemPrincipal =
      imagens.some(
        (imagem) =>
          obterIdImagemShopee(
            imagem,
          ) === principalId,
      );

    if (!contemPrincipal) {
      continue;
    }

    return Array.from(
      new Set([
        principal,
        ...imagens,
      ]),
    ).slice(0, 12);
  }

  return [principal];
}

export async function buscarGaleriaShopee(
  productLink: string,
  imagemPrincipal: string,
): Promise<string[]> {
  const principal =
    montarUrlImagemShopee(
      imagemPrincipal,
    );

  if (!principal) {
    return [];
  }

  try {
    const response =
      await fetchPaginaShopee(
        productLink,
      );

    if (!response.ok) {
      return [principal];
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
      return [principal];
    }

    const html =
      await response.text();

    if (!html.trim()) {
      return [principal];
    }

    return extrairGaleriaDoHtml(
      html,
      principal,
    );
  } catch {
    /*
     * A galeria é enriquecimento opcional.
     * A importação principal não deve falhar
     * se a página pública da Shopee bloquear
     * a leitura automática.
     */
    return [principal];
  }
}

export async function buscarOfertasShopeePorPalavraChave(
  keywordRaw: string,
  limitRaw = 50,
): Promise<ShopeeAffiliateOffer[]> {
  const keyword =
    keywordRaw.trim();

  if (!keyword) {
    return [];
  }

  const limit =
    Math.min(
      Math.max(
        Number.isFinite(limitRaw)
          ? Math.trunc(limitRaw)
          : 20,
        1,
      ),
      50,
    );

  const keywordGraphql =
    JSON.stringify(keyword);

  const query = `{
    productOfferV2(
      keyword: ${keywordGraphql},
      page: 1,
      limit: ${limit}
    ) {
      nodes {
        itemId
        shopId
        productName
        shopName
        price
        priceMin
        priceMax
        imageUrl
        productLink
        offerLink
        ratingStar
        sales
        priceDiscountRate
        commissionRate
        commission
        appExistRate
        appNewRate
        webExistRate
        webNewRate
        periodStartTime
        periodEndTime
        productCatIds
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

  return (
    resultado.data
      ?.productOfferV2
      ?.nodes ?? []
  );
}

