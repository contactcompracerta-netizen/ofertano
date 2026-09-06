import type { Metadata } from "next";

import { siteUrl, SITE_URL } from "./site";

/*
 * Construtores SEM débito de banco para a página de produto.
 *
 * Recebem apenas dados reais já carregados pela página e devolvem
 * estruturas determinísticas. Nunca inventam rating, reviews, marca,
 * GTIN, SKU, availability ou validade de preço.
 */

export type PublicOfferForSeo = {
  marketplace: string;
  price: number;
  available: boolean;
};

export type ProductSeoInput = {
  id: string;
  name: string;
  description?: string | null;
  image?: string | null;
  images?: Array<string | null>;
  active: boolean;
  publicationStatus: string;
  brand?: string | null;
  offers: PublicOfferForSeo[];
};

export function isProductIndexable(product: {
  active: boolean;
  publicationStatus: string;
}): boolean {
  return product.active && product.publicationStatus !== "DRAFT";
}

export function normalizeAbsoluteUrl(url: string): string | null {
  const valor = url.trim();

  if (!valor) {
    return null;
  }

  if (/^https?:\/\//i.test(valor)) {
    return valor;
  }

  return siteUrl(valor);
}

export function isCodeLike(token: string): boolean {
  if (/^(ASIN|SKU|GTIN|EAN|UPC|MPN)[:\s]*[A-Z0-9]+$/i.test(token)) return true;
  if (/^B0[A-Z0-9]{8}$/i.test(token)) return true;
  // Reject tokens with 2+ intercalated alpha/numeric blocks
  if (/(?:[a-zA-Z]+[0-9]+){2,}|(?:[0-9]+[a-zA-Z]+){2,}/i.test(token)) return true;
  return false;
}

export function isDescriptionInvalid(description: string | null | undefined): boolean {
  if (!description) return true;
  const clean = description.trim();
  if (!clean) return true;

  // Junk patterns
  if (/^[\d\s]+$/.test(clean)) return true; // Only numbers/spaces
  if (/^https?:\/\/[^\s]+$/i.test(clean)) return true; // URL
  if (/^[\p{P}\p{S}]+$/u.test(clean)) return true; // Only punctuation/symbols

  const lower = clean.toLowerCase();
  if (['---', 'null', 'n/a', 'na', 'não informado', 'sem descrição'].includes(lower)) return true;

  // Code-like detection
  if (isCodeLike(clean)) return true;
  if (/^[0-9a-fA-F]{16,}$/.test(clean)) return true; // Long hex

  if (/^\{.*\}$/.test(clean) || /^\[.*\]$/.test(clean)) return true; // JSON

  return false;
}

export function sanitizeProductTitle(name: string): string {
  return name
    .replace(/[\x00-\x1F\x7F-\x9F]/g, " ") // Control chars to space
    .replace(/,(\s*)$/, "")                // Trailing comma/spaces first
    .replace(/\s+/g, " ")                  // Extra whitespace
    .replace(/\s+([,.!?;:])/g, "$1")       // Space before punctuation
    .replace(/([,.!?;:])\1+$/g, "$1")      // Duplicate punct at end
    .trim();
}

/**
 * Removes deterministic boilerplate prefixes from brand values.
 * This ensures consistent normalization between canonical and structured brands.
 * Only removes prefixes at the start of the string.
 */
export function cleanBrandBoilerplate(value: string): string {
  return value
    .replace(/^visite\s+a\s+loja\s+da\s+/i, "")  // Must come before basic pattern
    .replace(/^visite\s+a\s+loja\s+/i, "")
    .replace(/^marca:\s*/i, "")
    .trim();
}

export function sanitizeBrand(brand: string | null | undefined): string | null {
  if (!brand) return null;
  const b = brand.trim();

  // Rejeitar apenas se for descrição clara (tamanho alto + muitas palavras)
  if (b.length > 80 && b.split(/\s+/).length > 5) return null;

  // Remove deterministic boilerplate prefixes for consistency
  const cleaned = cleanBrandBoilerplate(b);
  if (!cleaned) return null;

  const lower = cleaned.toLowerCase();
  const invalid = ['sem marca', 'genérico', 'generic', 'n/a', 'na', 'null', 'não informado'];
  if (invalid.includes(lower)) return null;

  if (/^https?:\/\/[^\s]+$/i.test(cleaned)) return null; // URL

  // Specific code detection
  if (isCodeLike(cleaned)) return null;

  if (/^[\p{P}\p{S}]+$/u.test(cleaned)) return null; // Only punctuation/symbols

  // Marketplaces
  const marketplaces = ['Amazon', 'Mercado Livre', 'Shopee', 'AliExpress', 'Magalu', 'Magazine Luiza'];
  if (marketplaces.some(m => lower === m.toLowerCase())) return null;

  return cleaned;
}

export function createProductDescription(
  name: string,
  description: string | null | undefined,
): string {
  const cleanName = sanitizeProductTitle(name);
  const cleanDesc = description?.trim() ?? "";

  const semanticName = cleanName.toLowerCase().replace(/[.,!?;:]$/g, "").replace(/\s+/g, " ");
  const semanticDesc = sanitizeProductTitle(cleanDesc).toLowerCase().replace(/[.,!?;:]$/g, "").replace(/\s+/g, " ");

  const isInvalid = isDescriptionInvalid(description) ||
                   (cleanDesc && semanticDesc === semanticName);

  if (isInvalid) {
    const fallback = `Compare o preço de ${cleanName} no Ofertano e confira ofertas em diferentes lojas parceiras.`;
    return fallback.length > 180 ? `${fallback.slice(0, 177).trimEnd()}...` : fallback;
  }

  const desc = cleanDesc.replace(/\s+/g, " ").trim();
  return desc.length > 180 ? `${desc.slice(0, 177).trimEnd()}...` : desc;
}
export function buildProductMetadata(product: ProductSeoInput): Metadata {
  const urlProduto = siteUrl(`/produto/${product.id}`);
  const imagemPrincipal = [product.image, ...(product.images ?? [])]
    .filter((imagem): imagem is string => Boolean(imagem?.trim()))
    .map(normalizeAbsoluteUrl)
    .find((imagem): imagem is string => Boolean(imagem));

  const descricao = createProductDescription(
    product.name,
    product.description,
  );
  const indexavel = isProductIndexable(product);
  const tituloSanitizado = sanitizeProductTitle(product.name);

  return {
    title: tituloSanitizado,
    description: descricao,
    robots: indexavel
      ? undefined
      : {
          index: false,
          follow: false,
        },
    alternates: {
      canonical: urlProduto,
    },
    openGraph: {
      title: `${tituloSanitizado} | Ofertano`,
      description: descricao,
      url: urlProduto,
      siteName: "Ofertano",
      locale: "pt_BR",
      type: "website",
      images: imagemPrincipal
        ? [{ url: imagemPrincipal, alt: tituloSanitizado }]
        : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: `${tituloSanitizado} | Ofertano`,
      description: descricao,
      images: imagemPrincipal ? [imagemPrincipal] : undefined,
    },
  };
}

export function buildProductBreadcrumbData(
  product: Pick<ProductSeoInput, "id" | "name">,
): {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: Array<{
    "@type": "ListItem";
    position: number;
    name: string;
    item: string;
  }>;
} {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Início",
        item: SITE_URL + "/",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: sanitizeProductTitle(product.name),
        item: siteUrl(`/produto/${product.id}`),
      },
    ],
  };
}

export type AggregateOfferResult = {
  "@type": "AggregateOffer";
  priceCurrency: "BRL";
  lowPrice: number;
  highPrice: number;
  offerCount: number;
  offers: Array<{
    "@type": "Offer";
    priceCurrency: "BRL";
    price: number;
    seller: {
      "@type": "Organization";
      name: string;
    };
  }>;
};

/*
 * Reflete SOMENTE ofertas que o Ofertano considera válidas e publicáveis
 * (ativas, EXACT, disponíveis e com preço positivo). Não expõe oferta
 * inválida, pendente ou quebrada.
 */
export function buildAggregateOffer(
  offers: PublicOfferForSeo[],
): AggregateOfferResult | null {
  const validadas = offers.filter(
    (oferta) =>
      oferta.available &&
      Number.isFinite(oferta.price) &&
      oferta.price > 0,
  );

  if (validadas.length === 0) {
    return null;
  }

  const precos = validadas
    .map((oferta) => oferta.price)
    .sort((a, b) => a - b);

  return {
    "@type": "AggregateOffer",
    priceCurrency: "BRL",
    lowPrice: precos[0],
    highPrice: precos[precos.length - 1],
    offerCount: validadas.length,
    offers: validadas.map((oferta) => ({
      "@type": "Offer",
      priceCurrency: "BRL",
      price: oferta.price,
      seller: {
        "@type": "Organization",
        name: oferta.marketplace,
      },
    })),
  };
}

export function buildProductStructuredData(
  product: ProductSeoInput,
): object | null {
  const indexavel = isProductIndexable(product);

  if (!indexavel) {
    return null;
  }

  const imagemPrincipal = [product.image, ...(product.images ?? [])]
    .filter((imagem): imagem is string => Boolean(imagem?.trim()))
    .map(normalizeAbsoluteUrl)
    .find((imagem): imagem is string => Boolean(imagem));

  const ofertasAgregadas = buildAggregateOffer(product.offers);

  const base = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: sanitizeProductTitle(product.name),
    url: siteUrl(`/produto/${product.id}`),
  } as Record<string, unknown>;

  if (imagemPrincipal) {
    base.image = imagemPrincipal;
  }

  const descricao = createProductDescription(
    product.name,
    product.description,
  );
  if (descricao) {
    base.description = descricao;
  }

  if (product.brand) {
    const marca = sanitizeBrand(product.brand);
    if (marca) {
      base.brand = {
        "@type": "Brand",
        name: marca,
      };
    }
  }

  if (ofertasAgregadas) {
    base.offers = ofertasAgregadas;
  }

  return base;
}