import { NextResponse } from "next/server";

import { publicarProdutoComMultiloja } from "@/services/multiloja/publishWithMultiloja";
import { importarProduto } from "@/services/importers";
import type { ProductImport } from "@/services/importers/core/types";
import {
  extractMercadoLivreCatalogProductId,
  isMercadoLivreCatalogSourceUrl,
  mercadoLivreSourceUrlProvesListing,
  normalizeMercadoLivreListingItemId,
  resolveMercadoLivreListingSourceUrl,
} from "@/services/mercadoLivre/listingIdentity";

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

  /*
   * LISTING-FIRST: a ponte Chrome importa UM ANÚNCIO, não um produto de
   * catálogo.
   *
   * Numa página `/p/MLB<catalog>` o content script lê o catalog_product_id e
   * o buy-box pode ser de qualquer um dos N anúncios. Gravar esse id em
   * `externalId` criaria uma oferta de catálogo: o CTA abriria a página de
   * catálogo (não um anúncio), e preço/vendedor seriam os do anúncio sorteado.
   *
   * Sem prova de qual anúncio é o alvo, a resposta correta é recusar — nunca
   * escolher o mais barato nem o atual buy box (isso troca vendedor e preço e
   * destrói a identidade do anúncio).
   */
  if (isMercadoLivreCatalogSourceUrl(rawUrl)) {
    throw new ImportValidationError(
      "Esta importação é de um anúncio individual. Abra o anúncio do vendedor " +
        "no Mercado Livre e cole o link dele — páginas de catálogo (/p/...) " +
        "não representam um anúncio e não podem virar oferta.",
    );
  }

  const listingItemId = normalizeMercadoLivreListingItemId(
    textoSeguro(snapshot.externalId, 32),
  );

  if (!listingItemId) {
    throw new ImportValidationError(
      "A Ponte Chrome não retornou um código de anúncio MLB válido.",
    );
  }

  const catalogProductId = extractMercadoLivreCatalogProductId(rawUrl);

  /*
   * Se o id lido no Chrome coincide com o catalog_product_id da URL, o
   * content script leu a página de catálogo. O id tem a mesma forma de um
   * ITEM_ID (MLB + dígitos), então só a comparação com o catálogo desambigua.
   */
  if (catalogProductId === listingItemId) {
    throw new ImportValidationError(
      "O código lido no Chrome é um código de catálogo, não de anúncio. " +
        "Abra o anúncio do vendedor e tente novamente.",
    );
  }

  /*
   * A URL precisa provar o MESMO anúncio que o Chrome leu. Sem isso não há
   * vínculo entre preço/vendedor capturados e a página que o CTA abre.
   */
  if (!mercadoLivreSourceUrlProvesListing(rawUrl, listingItemId)) {
    throw new ImportValidationError(
      "O link informado não identifica o anúncio lido no Chrome. " +
        "Confira se o link é o do anúncio e não o de outra oferta.",
    );
  }

  const sourceUrl =
    resolveMercadoLivreListingSourceUrl(rawUrl, listingItemId) ?? rawUrl;

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
    externalId: listingItemId,
    url: sourceUrl,

    /*
     * METADADO, nunca identidade: se o anúncio pertence a um catálogo, o
     * catalog_product_id viaja aqui para rastreabilidade. `externalId`
     * permanece o ITEM_ID do anúncio.
     */
    catalogProductId,

    /*
     * O link individual colado pelo administrador é a oferta que será aberta
     * pelo botão do produto. A resolução de link de afiliado continua podendo
     * substituí-lo posteriormente pelo fluxo já existente.
     */
    affiliateLink: sourceUrl,

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
