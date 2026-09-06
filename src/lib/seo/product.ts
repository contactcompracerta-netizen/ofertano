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

export function createProductDescription(
  name: string,
  description: string | null | undefined,
): string {
  const descricaoLimpa = description?.replace(/\s+/g, " ").trim();

  if (descricaoLimpa) {
    return descricaoLimpa.length > 180
      ? `${descricaoLimpa.slice(0, 177).trimEnd()}...`
      : descricaoLimpa;
  }

  return `Compare o preço de ${name} no Ofertano e compre diretamente na loja parceira.`;
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

  return {
    title: product.name,
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
      title: `${product.name} | Ofertano`,
      description: descricao,
      url: urlProduto,
      siteName: "Ofertano",
      locale: "pt_BR",
      type: "website",
      images: imagemPrincipal
        ? [{ url: imagemPrincipal, alt: product.name }]
        : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: `${product.name} | Ofertano`,
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
        name: product.name,
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
    name: product.name,
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

  const marca = product.brand?.trim();
  if (marca) {
    base.brand = {
      "@type": "Brand",
      name: marca,
    };
  }

  if (ofertasAgregadas) {
    base.offers = ofertasAgregadas;
  }

  return base;
}