export const FALLBACK_GENERICO_MELI_LA =
  "https://meli.la/1i7Te2C";

export type OfertaCompraPublica = {
  id: string;
  productId?: string | null;
  marketplace: string;
  affiliateLink?: string | null;
  sourceUrl?: string | null;
  matchStatus?: string | null;
  status: string;
  available: boolean;
  price: number;
};

function normalizarHost(hostname: string) {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function normalizarCaminho(pathname: string) {
  return pathname.replace(/\/+$/, "").toLowerCase();
}

export function ehMarketplaceMercadoLivre(
  marketplace: string | null | undefined,
) {
  const valor = marketplace
    ?.trim()
    .toUpperCase()
    .replaceAll(" ", "_");

  return valor === "MERCADO_LIVRE";
}

export function ehFallbackGenericoMeliLa(
  link: string | null | undefined,
) {
  const valor = link?.trim();

  if (!valor) {
    return false;
  }

  try {
    const url = new URL(valor);
    const host = normalizarHost(url.hostname);

    if (host !== "meli.la" && !host.endsWith(".meli.la")) {
      return false;
    }

    return normalizarCaminho(url.pathname) === "/1i7te2c";
  } catch {
    return false;
  }
}

function ehUrlComumMercadoLivre(url: URL) {
  const caminho = decodeURIComponent(url.pathname);

  if (/\/p\/MLB\d+/i.test(caminho) || /\/up\/MLBU\d+/i.test(caminho)) {
    return true;
  }

  if (/MLB-?\d+/i.test(caminho)) {
    return true;
  }

  const itemId =
    url.searchParams.get("item_id") ?? url.searchParams.get("wid");

  return Boolean(itemId && /^MLB-?\d+$/i.test(itemId.trim()));
}

export function ehLinkAfiliadoConfirmadoMercadoLivre(
  link: string | null | undefined,
) {
  const valor = link?.trim();

  if (!valor) {
    return false;
  }

  try {
    const url = new URL(valor);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    const host = normalizarHost(url.hostname);

    if (host === "meli.la" || host.endsWith(".meli.la")) {
      const caminho = normalizarCaminho(url.pathname);
      return caminho.length > 1 && caminho !== "/1i7te2c";
    }

    const hostMercadoLivre =
      host === "mercadolivre.com.br" ||
      host.endsWith(".mercadolivre.com.br") ||
      host === "mercadolibre.com" ||
      host.endsWith(".mercadolibre.com");

    if (!hostMercadoLivre) {
      return false;
    }

    if (ehUrlComumMercadoLivre(url)) {
      return false;
    }

    const caminhoSocial = url.pathname.toLowerCase().startsWith("/social/");
    const etiqueta = url.searchParams.get("matt_word")?.trim().toLowerCase();

    return caminhoSocial && etiqueta === "ofertano";
  } catch {
    return false;
  }
}

function mesmoProduto(
  oferta: OfertaCompraPublica,
  candidata: OfertaCompraPublica,
) {
  const produtoOferta = oferta.productId?.trim();
  const produtoCandidata = candidata.productId?.trim();

  if (!produtoOferta || !produtoCandidata) {
    return true;
  }

  return produtoOferta === produtoCandidata;
}

export function confirmarAffiliateLinkMercadoLivre(
  oferta: Pick<OfertaCompraPublica, "affiliateLink" | "sourceUrl">,
) {
  const affiliateLink = oferta.affiliateLink?.trim() || "";

  if (!affiliateLink) {
    return null;
  }

  if (ehFallbackGenericoMeliLa(affiliateLink)) {
    return null;
  }

  if (!ehLinkAfiliadoConfirmadoMercadoLivre(affiliateLink)) {
    return null;
  }

  const sourceUrl = oferta.sourceUrl?.trim() || "";

  if (
    sourceUrl &&
    affiliateLink === sourceUrl &&
    !ehLinkAfiliadoConfirmadoMercadoLivre(sourceUrl)
  ) {
    return null;
  }

  return affiliateLink;
}

export function encontrarOfertaMercadoLivreComAfiliadoConfirmado<
  T extends OfertaCompraPublica,
>(
  ofertasDoProduto: readonly T[],
  ofertaAtual?: T | null,
) {
  const candidatas = ofertasDoProduto
    .filter((oferta) => {
      if (!ehMarketplaceMercadoLivre(oferta.marketplace)) {
        return false;
      }

      if (ofertaAtual && oferta.id === ofertaAtual.id) {
        return false;
      }

      if (ofertaAtual && !mesmoProduto(ofertaAtual, oferta)) {
        return false;
      }

      return Boolean(confirmarAffiliateLinkMercadoLivre(oferta));
    })
    .sort((a, b) => a.price - b.price);

  return candidatas[0] ?? null;
}

/*
 * Href da linha/card da oferta: somente o affiliateLink próprio.
 * Mercado Livre nunca herda irmã, sourceUrl ou meli.la genérico.
 */
export function resolverHrefProprioOfertaPublica(
  oferta: Pick<OfertaCompraPublica, "marketplace" | "affiliateLink" | "sourceUrl">,
) {
  if (ehMarketplaceMercadoLivre(oferta.marketplace)) {
    return confirmarAffiliateLinkMercadoLivre(oferta);
  }

  const link = oferta.affiliateLink?.trim() || "";
  return link || null;
}

/*
 * Destino de compra do Product. Pode usar outra oferta ML do
 * mesmo Product quando a atual não tem affiliateLink confirmado.
 */
export function resolverHrefCompraPublica<T extends OfertaCompraPublica>(
  oferta: T,
  ofertasDoProduto: readonly T[] = [],
) {
  const hrefProprio = resolverHrefProprioOfertaPublica(oferta);

  if (hrefProprio) {
    return hrefProprio;
  }

  if (!ehMarketplaceMercadoLivre(oferta.marketplace)) {
    return null;
  }

  return confirmarAffiliateLinkMercadoLivre(
    encontrarOfertaMercadoLivreComAfiliadoConfirmado(
      ofertasDoProduto,
      oferta,
    ) ?? { affiliateLink: null, sourceUrl: null },
  );
}

function statusPermiteCompraPublica(oferta: OfertaCompraPublica) {
  if (!oferta.available) {
    return false;
  }

  if (ehMarketplaceMercadoLivre(oferta.marketplace)) {
    return oferta.status !== "UNAVAILABLE" && oferta.status !== "ERROR";
  }

  return oferta.status === "ACTIVE";
}

export function ofertaPossuiLinkMonetizadoProprio(
  oferta: OfertaCompraPublica,
) {
  return Boolean(resolverHrefProprioOfertaPublica(oferta));
}

export function escolherOfertaPrincipalCompravel<
  T extends OfertaCompraPublica,
>(ofertas: readonly T[]) {
  const elegiveis = ofertas
    .filter((oferta) => {
      return (
        oferta.matchStatus === "EXACT" &&
        ofertaPossuiLinkMonetizadoProprio(oferta) &&
        statusPermiteCompraPublica(oferta) &&
        Number.isFinite(oferta.price) &&
        oferta.price > 0
      );
    })
    .sort((a, b) => a.price - b.price);

  return elegiveis[0] ?? null;
}

export function resolverLinkLegadoPrincipal(
  store: string | null | undefined,
  affiliateLink: string | null | undefined,
) {
  const link = affiliateLink?.trim() || "";

  if (!link) {
    return "";
  }

  if (ehMarketplaceMercadoLivre(store)) {
    return ehLinkAfiliadoConfirmadoMercadoLivre(link) ? link : "";
  }

  return link;
}

export function resolverCompraPublica<T extends OfertaCompraPublica>(input: {
  store?: string | null;
  affiliateLink?: string | null;
  ofertas: readonly T[];
}) {
  const ofertaPrincipal = escolherOfertaPrincipalCompravel(input.ofertas);

  const linkOfertaPrincipal = ofertaPrincipal
    ? resolverHrefCompraPublica(ofertaPrincipal, input.ofertas) ?? ""
    : "";

  const linkLegadoPrincipal = resolverLinkLegadoPrincipal(
    input.store,
    input.affiliateLink,
  );

  const hrefPorOfertaId: Record<string, string | null> = {};

  for (const oferta of input.ofertas) {
    const href = resolverHrefProprioOfertaPublica(oferta);

    hrefPorOfertaId[oferta.id] =
      href && statusPermiteCompraPublica(oferta) ? href : null;
  }

  return {
    ofertaPrincipal,
    linkPrincipal: linkOfertaPrincipal || linkLegadoPrincipal,
    hrefPorOfertaId,
  };
}
