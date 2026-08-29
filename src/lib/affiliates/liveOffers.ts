import {
  ehMarketplaceMercadoLivre,
  resolverCompraPublica,
  resolverHrefProprioOfertaPublica,
  type OfertaCompraPublica,
} from "./publicPurchase";

export type LivePublicOffer = OfertaCompraPublica & {
  oldPrice?: number | null;
  installments?: string | null;
};

export function sanitizarOfertaCompraPublica<T extends OfertaCompraPublica>(
  offer: T,
): T {
  const affiliateLink = resolverHrefProprioOfertaPublica(offer);

  return {
    ...offer,
    affiliateLink,
    sourceUrl: null,
  };
}

export function aindaAguardaAfiliadoMercadoLivre(
  offers: readonly OfertaCompraPublica[],
): boolean {
  return offers.some(
    (offer) =>
      ehMarketplaceMercadoLivre(offer.marketplace) &&
      offer.matchStatus === "EXACT" &&
      !resolverHrefProprioOfertaPublica(offer),
  );
}

export function mesclarOfertasAoVivo(
  atuais: LivePublicOffer[],
  recebidas: LivePublicOffer[],
): LivePublicOffer[] {
  const porId = new Map(recebidas.map((offer) => [offer.id, offer]));

  return atuais.map((offer) => {
    const atualizada = porId.get(offer.id);

    if (!atualizada) {
      return sanitizarOfertaCompraPublica(offer);
    }

    return sanitizarOfertaCompraPublica({
      ...offer,
      ...atualizada,
      sourceUrl: null,
    });
  });
}

export function compraPublicaDasOfertas(input: {
  store?: string | null;
  affiliateLink?: string | null;
  ofertas: readonly LivePublicOffer[];
}) {
  return resolverCompraPublica({
    store: input.store,
    affiliateLink: input.affiliateLink,
    ofertas: input.ofertas.map(sanitizarOfertaCompraPublica),
  });
}
