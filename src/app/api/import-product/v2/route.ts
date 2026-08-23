import { NextResponse } from "next/server";

import { publicarProdutoComMultiloja } from "@/services/multiloja/publishWithMultiloja";
import { importarProduto } from "@/services/importers";
import type { ProductImport } from "@/services/importers/core/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

class ImportValidationError extends Error {}

type MercadoLivreChromeSnapshot = {
  externalId?: unknown;
  title?: unknown;
  price?: unknown;
  oldPrice?: unknown;
  image?: unknown;
  images?: unknown;
  description?: unknown;
  brand?: unknown;
  category?: unknown;
  seller?: unknown;
  attributes?: unknown;
};

function obterLinkAfiliadoAmazon(
  rawUrl: string,
  marketplace: string,
): string | null {
  if (marketplace !== "Amazon") {
    return null;
  }

  try {
    const url = new URL(rawUrl);

    const hostname = url.hostname
      .toLowerCase()
      .replace(/^www\./, "");

    const dominioAmazon =
      hostname === "amazon.com.br" ||
      hostname.endsWith(".amazon.com.br") ||
      hostname === "amazon.com" ||
      hostname.endsWith(".amazon.com");

    if (!dominioAmazon) {
      return null;
    }

    const tagAtual = url.searchParams.get("tag")?.trim();
    const associateTag =
      process.env.AMAZON_ASSOCIATE_TAG?.trim() || "ofertano-20";

    if (tagAtual === associateTag) {
      return rawUrl.trim();
    }

    const match = url.pathname.match(
      /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i,
    );
    const asin = match?.[1]?.toUpperCase() ?? null;

    if (!asin) {
      return null;
    }

    return (
      `https://www.amazon.com.br/dp/${asin}` +
      `/ref=nosim?tag=${encodeURIComponent(associateTag)}`
    );
  } catch {
    return null;
  }
}

function textoSeguro(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.replace(/\s+/g, " ").trim().slice(0, maxLength);
  return text || null;
}

function urlHttpSegura(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function isMercadoLivreUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname
      .toLowerCase()
      .replace(/^www\./, "");

    return (
      hostname === "meli.la" ||
      hostname.endsWith(".meli.la") ||
      hostname === "mercadolivre.com.br" ||
      hostname.endsWith(".mercadolivre.com.br") ||
      hostname === "mercadolibre.com" ||
      hostname.endsWith(".mercadolibre.com")
    );
  } catch {
    return false;
  }
}

function obterIdMercadoLivreDaUrl(rawUrl: string): string | null {
  const match = rawUrl.match(/\bMLB[-_ ]?(\d{7,})\b/i);
  return match?.[1] ? `MLB${match[1]}` : null;
}

function numeroPositivo(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function normalizarAtributos(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const attributes: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 60)) {
    const key = textoSeguro(rawKey, 120);
    const item = textoSeguro(rawValue, 500);

    if (key && item) {
      attributes[key] = item;
    }
  }

  return attributes;
}

function criarProdutoDoChrome(
  rawUrl: string,
  snapshot: MercadoLivreChromeSnapshot,
): ProductImport {
  if (!isMercadoLivreUrl(rawUrl)) {
    throw new ImportValidationError(
      "A captura do Chrome só pode ser usada em links do Mercado Livre.",
    );
  }

  const externalId = textoSeguro(snapshot.externalId, 32)?.toUpperCase() ?? null;

  if (!externalId || !/^MLB\d{7,}$/.test(externalId)) {
    throw new ImportValidationError(
      "A Ponte Chrome não retornou um código MLB válido.",
    );
  }

  const idDoLink = obterIdMercadoLivreDaUrl(rawUrl);

  if (idDoLink && idDoLink !== externalId) {
    throw new ImportValidationError(
      "O código do anúncio lido no Chrome não corresponde ao link informado.",
    );
  }

  const title = textoSeguro(snapshot.title, 500);
  const price = numeroPositivo(snapshot.price);
  const image = urlHttpSegura(snapshot.image);

  if (!title || !price || !image) {
    throw new ImportValidationError(
      "A Ponte Chrome não retornou nome, preço e imagem válidos do anúncio.",
    );
  }

  const extraImages = Array.isArray(snapshot.images)
    ? snapshot.images
        .map(urlHttpSegura)
        .filter((value): value is string => Boolean(value))
    : [];

  const images = [...new Set([image, ...extraImages])].slice(0, 12);
  const oldPrice = numeroPositivo(snapshot.oldPrice);
  const normalizedOldPrice = oldPrice && oldPrice > price ? oldPrice : null;

  return {
    marketplace: "Mercado Livre",
    externalId,
    url: rawUrl,

    /*
     * O link individual colado pelo administrador é a oferta que será aberta
     * pelo botão do produto. A resolução de link de afiliado continua podendo
     * substituí-lo posteriormente pelo fluxo já existente.
     */
    affiliateLink: rawUrl,

    title,
    description: textoSeguro(snapshot.description, 8000),
    brand: textoSeguro(snapshot.brand, 160),
    category: textoSeguro(snapshot.category, 180) ?? "Ofertas",
    image,
    images,
    price,
    oldPrice: normalizedOldPrice,
    discount:
      normalizedOldPrice
        ? Math.round(((normalizedOldPrice - price) / normalizedOldPrice) * 100)
        : null,
    installments: null,
    rating: null,
    reviews: null,
    sales: null,
    stock: null,
    seller: textoSeguro(snapshot.seller, 240),
    attributes: normalizarAtributos(snapshot.attributes),
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const url = typeof body?.url === "string" ? body.url.trim() : "";

    if (!url) {
      return NextResponse.json(
        { success: false, error: "Cole o link do produto." },
        { status: 400 },
      );
    }

    const snapshot = body?.mercadoLivreSnapshot as
      | MercadoLivreChromeSnapshot
      | undefined;

    /*
     * Para Mercado Livre, a Ponte Chrome já leu a página que o usuário abriu
     * normalmente no navegador. Assim não chamamos /items nem /multiget,
     * endpoints que estão recusando diversos anúncios com HTTP 403.
     * Os outros marketplaces continuam usando o importador atual sem mudança.
     */
    const imported = snapshot
      ? criarProdutoDoChrome(url, snapshot)
      : await importarProduto(url);

    const affiliateLinkAmazon = obterLinkAfiliadoAmazon(
      url,
      imported.marketplace,
    );
    const affiliateLink =
      affiliateLinkAmazon ?? imported.affiliateLink?.trim() ?? null;

    const {
      product: saved,
      comparison,
    } = await publicarProdutoComMultiloja(
      imported,
      affiliateLink,
      {
        discoverySource: "MANUAL",
        autoCreated: false,
        queueOnFailure: true,
      },
    );

    return NextResponse.json({
      success: true,
      message: comparison.found
        ? `Produto importado com ${comparison.found + 1} loja(s) no comparador.`
        : "Produto importado. Nenhuma outra oferta EXACT foi encontrada nesta rodada.",
      product: {
        id: saved.id,
        mlId: saved.mlId,
        name: saved.name,
        image: saved.image,
        price: saved.price,
        oldPrice: saved.oldPrice,
        discount: saved.discount,
        category: saved.category,
        sourceMarketplace: imported.marketplace,
      },
      comparison,
      comparisonError: null,
    });
  } catch (error) {
    console.error("Erro na importação:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao importar produto.",
      },
      { status: error instanceof ImportValidationError ? 422 : 500 },
    );
  }
}
