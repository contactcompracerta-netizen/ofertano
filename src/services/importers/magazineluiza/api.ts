import type {
    PaginaMagazineLuiza,
  } from "./types";
  
  const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/151.0.0.0 Safari/537.36";
  
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
  
  export async function carregarPaginaMagazineLuiza(
    rawUrl: string,
  ): Promise<PaginaMagazineLuiza> {
    const url = validarUrl(rawUrl);
  
    const controller = new AbortController();
  
    const timeout = setTimeout(() => {
      controller.abort();
    }, 15_000);
  
    try {
      const response = await fetch(
        url.toString(),
        {
          method: "GET",
  
          redirect: "follow",
  
          cache: "no-store",
  
          signal: controller.signal,
  
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
  
        requestedUrl:
          url.toString(),
  
        finalUrl:
          response.url ||
          url.toString(),
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "AbortError"
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