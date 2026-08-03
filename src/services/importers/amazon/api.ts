import * as cheerio from "cheerio";

export async function resolverUrlAmazon(
  originalUrl: string
): Promise<string> {
  const response = await fetch(originalUrl, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml",
      "Accept-Language":
        "pt-BR,pt;q=0.9,en;q=0.8",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Não foi possível acessar a Amazon (${response.status}).`
    );
  }

  return response.url;
}

export async function carregarPaginaAmazon(
  url: string
) {
  const finalUrl =
    await resolverUrlAmazon(url);

  const response = await fetch(finalUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml",
      "Accept-Language":
        "pt-BR,pt;q=0.9,en;q=0.8",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Amazon respondeu ${response.status}.`
    );
  }

  const html = await response.text();

  if (!html.trim()) {
    throw new Error(
      "A página retornou vazia."
    );
  }

  return cheerio.load(html);
}