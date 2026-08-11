import type {
  PaginaMagazineLuiza,
} from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/151.0.0.0 Safari/537.36";

const MAGAZINE_VOCE_STORE =
  "magazineofertanobr";

function validarUrl(
  rawUrl: string,
): URL {
  const valor = rawUrl.trim();

  if (!valor) {
    throw new Error(
      "Cole o link do produto do Magazine Luiza.",
    );
  }

  let url: URL;

  try {
    url = new URL(valor);
  } catch {
    throw new Error(
      "O link do Magazine Luiza não é válido.",
    );
  }

  if (
    url.protocol !== "http:" &&
    url.protocol !== "https:"
  ) {
    throw new Error(
      "O link do Magazine Luiza não é válido.",
    );
  }

  return url;
}

function normalizarHostname(
  hostname: string,
): string {
  return hostname
    .toLowerCase()
    .replace(/^www\./, "");
}

function pertenceDominio(
  hostname: string,
  dominio: string,
): boolean {
  return (
    hostname === dominio ||
    hostname.endsWith(
      `.${dominio}`,
    )
  );
}

function criarUrlMagazineVoce(
  original: URL,
): URL {
  const hostname =
    normalizarHostname(
      original.hostname,
    );

  /*
   * Link comum do Magazine Luiza:
   *
   * https://www.magazineluiza.com.br/produto/p/CODIGO/...
   *
   * vira:
   *
   * https://www.magazinevoce.com.br/magazineofertanobr/produto/p/CODIGO/...
   *
   * A URL da vitrine responde normalmente
   * ao servidor e também é o link afiliado
   * individual do Ofertano.
   */
  if (
    pertenceDominio(
      hostname,
      "magazineluiza.com.br",
    ) ||
    pertenceDominio(
      hostname,
      "magalu.com.br",
    )
  ) {
    const url =
      new URL(
        original.toString(),
      );

    url.protocol = "https:";
    url.hostname =
      "www.magazinevoce.com.br";

    const caminho =
      original.pathname.startsWith("/")
        ? original.pathname
        : `/${original.pathname}`;

    url.pathname =
      `/${MAGAZINE_VOCE_STORE}${caminho}`;

    return url;
  }

  /*
   * Se já for Magazine Você,
   * garantimos que o link use a
   * vitrine do próprio Ofertano.
   */
  if (
    pertenceDominio(
      hostname,
      "magazinevoce.com.br",
    )
  ) {
    const url =
      new URL(
        original.toString(),
      );

    url.protocol = "https:";
    url.hostname =
      "www.magazinevoce.com.br";

    const partes =
      url.pathname
        .split("/")
        .filter(Boolean);

    if (partes.length > 0) {
      partes[0] =
        MAGAZINE_VOCE_STORE;

      url.pathname =
        `/${partes.join("/")}`;
    }

    return url;
  }

  /*
   * Outros formatos reconhecidos pelo
   * importador continuam sendo acessados
   * normalmente.
   */
  return new URL(
    original.toString(),
  );
}

export async function carregarPaginaMagazineLuiza(
  rawUrl: string,
): Promise<PaginaMagazineLuiza> {
  const originalUrl =
    validarUrl(rawUrl);

  const urlLeitura =
    criarUrlMagazineVoce(
      originalUrl,
    );

  const controller =
    new AbortController();

  const timeout =
    setTimeout(() => {
      controller.abort();
    }, 15_000);

  try {
    const response =
      await fetch(
        urlLeitura.toString(),
        {
          method: "GET",

          redirect: "follow",

          cache: "no-store",

          signal:
            controller.signal,

          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",

            "Accept-Language":
              "pt-BR,pt;q=0.9,en;q=0.8",

            "Cache-Control":
              "no-cache",

            Pragma:
              "no-cache",

            "User-Agent":
              USER_AGENT,
          },
        },
      );

    if (!response.ok) {
      throw new Error(
        `O Magazine Luiza respondeu com HTTP ${response.status}.`,
      );
    }

    const contentType =
      response.headers.get(
        "content-type",
      ) ?? "";

    if (
      !contentType
        .toLowerCase()
        .includes("text/html")
    ) {
      throw new Error(
        "O Magazine Luiza não retornou uma página de produto válida.",
      );
    }

    const html =
      await response.text();

    if (!html.trim()) {
      throw new Error(
        "O Magazine Luiza retornou uma página vazia.",
      );
    }

    return {
      html,

      /*
       * IMPORTANTE:
       *
       * requestedUrl recebe a URL da
       * magazineofertanobr.
       *
       * Dessa forma o parser existente
       * reconhece automaticamente esse
       * endereço como affiliateLink.
       */
      requestedUrl:
        urlLeitura.toString(),

      finalUrl:
        response.url ||
        urlLeitura.toString(),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name ===
        "AbortError"
    ) {
      throw new Error(
        "O Magazine Luiza demorou demais para responder.",
      );
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(
      "Não foi possível acessar o produto do Magazine Luiza.",
    );
  } finally {
    clearTimeout(timeout);
  }
}