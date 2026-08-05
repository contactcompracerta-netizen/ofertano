import * as cheerio from "cheerio";

const REQUEST_TIMEOUT_MS = 20_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/138.0.0.0 Safari/537.36";

export type AmazonPageResult = {
  $: ReturnType<typeof cheerio.load>;
  html: string;
  originalUrl: string;
  finalUrl: string;
};

function dominioAmazonPermitido(
  hostname: string,
): boolean {
  const dominio = hostname.toLowerCase();

  return (
    dominio === "amazon.com.br" ||
    dominio.endsWith(".amazon.com.br")
  );
}

function dominioCurtoPermitido(
  hostname: string,
): boolean {
  const dominio = hostname.toLowerCase();

  return (
    dominio === "amzn.to" ||
    dominio.endsWith(".amzn.to") ||
    dominio === "a.co" ||
    dominio.endsWith(".a.co")
  );
}

function validarUrlAmazon(
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
      "O link da Amazon precisa começar com http ou https.",
    );
  }

  const dominioValido =
    dominioAmazonPermitido(url.hostname) ||
    dominioCurtoPermitido(url.hostname);

  if (!dominioValido) {
    throw new Error(
      "O link informado não pertence à Amazon Brasil.",
    );
  }

  return url;
}

function paginaBloqueada(
  $: ReturnType<typeof cheerio.load>,
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

  return (
    $("#captchacharacters").length > 0 ||
    $("form[action*='validateCaptcha']").length >
      0 ||
    titulo.includes("robot check") ||
    titulo.includes("verificação de robô") ||
    textoPagina.includes(
      "digite os caracteres que você vê abaixo",
    ) ||
    textoPagina.includes(
      "enter the characters you see below",
    ) ||
    textoPagina.includes(
      "api-services-support@amazon.com",
    )
  );
}

export async function carregarPaginaAmazon(
  rawUrl: string,
): Promise<AmazonPageResult> {
  const originalUrl = rawUrl.trim();

  if (!originalUrl) {
    throw new Error(
      "Cole o link do produto da Amazon.",
    );
  }

  const url = validarUrlAmazon(originalUrl);

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      url.toString(),
      {
        method: "GET",
        redirect: "follow",

        headers: {
          "User-Agent": USER_AGENT,

          Accept:
            "text/html,application/xhtml+xml," +
            "application/xml;q=0.9,image/avif," +
            "image/webp,*/*;q=0.8",

          "Accept-Language":
            "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",

          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },

        cache: "no-store",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(
        `Não foi possível acessar a Amazon (${response.status}).`,
      );
    }

    const finalUrl =
      response.url || url.toString();

    let urlFinal: URL;

    try {
      urlFinal = new URL(finalUrl);
    } catch {
      throw new Error(
        "A Amazon retornou um endereço inválido.",
      );
    }

    if (
      !dominioAmazonPermitido(
        urlFinal.hostname,
      )
    ) {
      throw new Error(
        "O link não redirecionou para uma página da Amazon Brasil.",
      );
    }

    const contentType =
      response.headers.get("content-type") ??
      "";

    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes(
        "application/xhtml+xml",
      )
    ) {
      throw new Error(
        "A Amazon não retornou uma página de produto válida.",
      );
    }

    const html = await response.text();

    if (!html.trim()) {
      throw new Error(
        "A página da Amazon retornou vazia.",
      );
    }

    const $ = cheerio.load(html);

    if (paginaBloqueada($)) {
      throw new Error(
        "A Amazon bloqueou temporariamente a consulta automática. Tente novamente mais tarde.",
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
        "A Amazon demorou demais para responder.",
      );
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(
      "Não foi possível acessar a página da Amazon.",
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolverUrlAmazon(
  originalUrl: string,
): Promise<string> {
  const pagina =
    await carregarPaginaAmazon(originalUrl);

  return pagina.finalUrl;
}