import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

type MercadoLivreData = {
  name?: string;
  image?: string;
  images?: string[];
  price?: number;
  oldPrice?: number | null;
  discount?: number | null;
  category?: string;
  store?: string;
  rating?: number | null;
  reviews?: number | null;
  sales?: number | null;
  description?: string | null;
  brand?: string | null;
  video?: string | null;
  installments?: string | null;
  specifications?: Record<string, string>;
};

function extrairMlId(texto: string) {
  const resultado = texto.match(/MLB-?\d+/i);

  if (!resultado) {
    return null;
  }

  return resultado[0].replace("-", "").toUpperCase();
}

function extrairJsonLd(html: string): Record<string, unknown>[] {
  const scripts = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ];

  const resultados: Record<string, unknown>[] = [];

  for (const script of scripts) {
    try {
      const conteudo = script[1].trim();
      const json = JSON.parse(conteudo);

      if (Array.isArray(json)) {
        resultados.push(...json);
      } else if (json && typeof json === "object") {
        resultados.push(json);
      }
    } catch {
      // Ignora blocos JSON-LD inválidos.
    }
  }

  return resultados;
}

function encontrarProdutoJsonLd(
  dados: Record<string, unknown>[],
): Record<string, unknown> | null {
  for (const dado of dados) {
    if (dado["@type"] === "Product") {
      return dado;
    }

    const graph = dado["@graph"];

    if (Array.isArray(graph)) {
      const produto = graph.find(
        (item) =>
          item &&
          typeof item === "object" &&
          (item as Record<string, unknown>)["@type"] === "Product",
      );

      if (produto && typeof produto === "object") {
        return produto as Record<string, unknown>;
      }
    }
  }

  return null;
}

function normalizarImagens(valor: unknown): string[] {
  if (typeof valor === "string") {
    return [valor];
  }

  if (Array.isArray(valor)) {
    return valor.filter(
      (item): item is string =>
        typeof item === "string" && item.startsWith("http"),
    );
  }

  return [];
}

function converterNumero(valor: unknown): number | null {
  if (typeof valor === "number" && Number.isFinite(valor)) {
    return valor;
  }

  if (typeof valor !== "string") {
    return null;
  }

  const limpo = valor
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");

  const numero = Number(limpo);

  return Number.isFinite(numero) ? numero : null;
}

function converterTexto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim()
    ? valor.trim()
    : null;
}

function extrairDados(html: string): MercadoLivreData {
  const jsonLd = extrairJsonLd(html);
  const produto = encontrarProdutoJsonLd(jsonLd);

  if (!produto) {
    throw new Error(
      "Não foi possível localizar os dados estruturados do produto.",
    );
  }

  const ofertas =
    produto.offers && typeof produto.offers === "object"
      ? (produto.offers as Record<string, unknown>)
      : {};

  const avaliacao =
    produto.aggregateRating &&
    typeof produto.aggregateRating === "object"
      ? (produto.aggregateRating as Record<string, unknown>)
      : {};

  const imagens = normalizarImagens(produto.image);
  const preco = converterNumero(ofertas.price);

  if (!converterTexto(produto.name)) {
    throw new Error("O nome do produto não foi encontrado.");
  }

  if (preco === null) {
    throw new Error("O preço do produto não foi encontrado.");
  }

  return {
    name: converterTexto(produto.name) ?? undefined,
    image: imagens[0],
    images: imagens,
    price: preco,
    rating: converterNumero(avaliacao.ratingValue),
    reviews: converterNumero(avaliacao.reviewCount),
    description: converterTexto(produto.description),
    brand:
      produto.brand && typeof produto.brand === "object"
        ? converterTexto(
            (produto.brand as Record<string, unknown>).name,
          )
        : converterTexto(produto.brand),
  };
}

function calcularDesconto(
  preco: number,
  precoAntigo: number | null | undefined,
) {
  if (!precoAntigo || precoAntigo <= preco) {
    return null;
  }

  return Math.round(((precoAntigo - preco) / precoAntigo) * 100);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const link =
      typeof body.link === "string"
        ? body.link.trim()
        : typeof body.url === "string"
          ? body.url.trim()
          : "";

    if (!link) {
      return NextResponse.json(
        { error: "Cole o link do produto." },
        { status: 400 },
      );
    }

    let url: URL;

    try {
      url = new URL(link);
    } catch {
      return NextResponse.json(
        { error: "O link informado é inválido." },
        { status: 400 },
      );
    }

    const dominioPermitido =
      url.hostname === "mercadolivre.com.br" ||
      url.hostname.endsWith(".mercadolivre.com.br") ||
      url.hostname === "mercadolivre.com" ||
      url.hostname.endsWith(".mercadolivre.com");

    if (!dominioPermitido) {
      return NextResponse.json(
        {
          error:
            "Informe um link válido do Mercado Livre.",
        },
        { status: 400 },
      );
    }

    const resposta = await fetch(link, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
      cache: "no-store",
      redirect: "follow",
    });

    if (!resposta.ok) {
      return NextResponse.json(
        {
          error: `Não foi possível acessar o produto. Código: ${resposta.status}.`,
        },
        { status: 400 },
      );
    }

    const html = await resposta.text();
    const dados = extrairDados(html);

    const mlId =
      extrairMlId(resposta.url) ||
      extrairMlId(link) ||
      extrairMlId(html);

    if (!mlId) {
      return NextResponse.json(
        {
          error:
            "Não foi possível identificar o código MLB do produto.",
        },
        { status: 400 },
      );
    }

    const preco = dados.price;

    if (preco === undefined) {
      return NextResponse.json(
        { error: "Preço não localizado." },
        { status: 400 },
      );
    }

    const imagemPrincipal = dados.image || dados.images?.[0];

    if (!imagemPrincipal) {
      return NextResponse.json(
        { error: "Imagem do produto não localizada." },
        { status: 400 },
      );
    }

    const produto = await prisma.product.upsert({
      where: {
        mlId,
      },
      update: {
        name: dados.name!,
        image: imagemPrincipal,
        images: dados.images?.length
          ? dados.images
          : [imagemPrincipal],
        price: preco,
        oldPrice: dados.oldPrice,
        discount:
          dados.discount ??
          calcularDesconto(preco, dados.oldPrice),
        category: dados.category || "Ofertas",
        store: dados.store || "Mercado Livre",
        affiliateLink: link,
        rating: dados.rating,
        reviews: dados.reviews
          ? Math.round(dados.reviews)
          : null,
        sales: dados.sales
          ? Math.round(dados.sales)
          : null,
        description: dados.description,
        brand: dados.brand,
        video: dados.video,
        installments: dados.installments,
        specifications: dados.specifications || {},
        active: true,
      },
      create: {
        mlId,
        name: dados.name!,
        image: imagemPrincipal,
        images: dados.images?.length
          ? dados.images
          : [imagemPrincipal],
        price: preco,
        oldPrice: dados.oldPrice,
        discount:
          dados.discount ??
          calcularDesconto(preco, dados.oldPrice),
        category: dados.category || "Ofertas",
        store: dados.store || "Mercado Livre",
        affiliateLink: link,
        rating: dados.rating,
        reviews: dados.reviews
          ? Math.round(dados.reviews)
          : null,
        sales: dados.sales
          ? Math.round(dados.sales)
          : null,
        description: dados.description,
        brand: dados.brand,
        video: dados.video,
        installments: dados.installments,
        specifications: dados.specifications || {},
      },
    });

    return NextResponse.json({
      success: true,
      message: "Produto importado com sucesso.",
      product: {
        id: produto.id,
        mlId: produto.mlId,
        name: produto.name,
        image: produto.image,
        price: produto.price,
      },
    });
  } catch (error) {
    console.error("Erro ao importar produto:", error);

    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro interno ao importar produto.";

    return NextResponse.json(
      {
        error: mensagem,
      },
      {
        status: 500,
      },
    );
  }
}