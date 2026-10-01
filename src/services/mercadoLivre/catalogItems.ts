/**
 * LISTING-FIRST: refresh de oferta ML a partir de `/products/{id}/items`.
 *
 * Por que este caminho existe
 * --------------------------
 * Uma oferta ML `identityVersion >= 1` tem `externalId` = item_id real e
 * `catalogProductId` = catalogo a que o anuncio pertence. Nao tem `sourceUrl`:
 * a URL publica individual ainda nao e prova suficiente, e fabricar
 * `produto.mercadolivre.com.br/...` seria inventar dado. A constraint
 * `ml_listing_identity_v1` nao exige `sourceUrl` — ela exige que
 * `rawPayload.listing.item_id` seja igual a `externalId`.
 *
 * O endpoint `/items/{id}` responde 403 sem token de vendedor. Ja
 * `/products/{catalogProductId}/items` responde 200 com o token que a
 * aplicacao ja mantem em `MarketplaceConnection`. Esse e o caminho usado aqui.
 *
 * Regra central: o item procurado e o de `item_id === externalId`. NUNCA o mais
 * barato, o primeiro, nem o `buy_box_winner`. Escolher outro anuncio seria
 * trocar o vendedor e o preco de uma oferta ja gravada, que e exatamente o
 * defeito que a engine LISTING-FIRST veio eliminar.
 */

import { mercadoLivreFetch } from "@/lib/mercadolivre";
import { normalizeMercadoLivreListingItemId } from "@/services/mercadoLivre/listingIdentity";

/** Subconjunto do item que o Mercado Livre devolve em `/products/{id}/items`. */
export type CatalogoItem = {
  item_id?: string | null;
  price?: number | null;
  original_price?: number | null;
  currency_id?: string | null;
  seller_id?: number | string | null;
  condition?: string | null;
  shipping?: unknown;
  [key: string]: unknown;
};

export type CatalogoItensResponse = {
  results?: CatalogoItem[] | null;
  paging?: { total?: number | null } | null;
  [key: string]: unknown;
};

/** Proveniencia registrada em `rawPayload.source`. */
export const ML_LISTING_REFRESH_SOURCE = "CATALOG_ITEMS";

export type ClassificacaoItemCatalogo =
  | {
      status: "FOUND";
      item: CatalogoItem;
      itemId: string;
    }
  | {
      status: "NOT_SEEN";
      /** Quantos itens o catalogo devolveu, para diagnostico. */
      itensRetornados: number;
    };

/**
 * Localiza o item do catalogo cujo `item_id` e EXATAMENTE `listingItemId`.
 *
 * Funcao pura e exportada: a decisao de qual anuncio pertence a oferta e o
 * coracao do contrato, entao precisa de teste sem HTTP nem banco.
 */
export function classificarItemCatalogoParaOferta(
  resposta: CatalogoItensResponse | null | undefined,
  listingItemId: string,
): ClassificacaoItemCatalogo {
  const esperado = normalizeMercadoLivreListingItemId(listingItemId);

  if (!esperado) {
    /*
     * Sem item_id valido nao existe "o item certo". Devolver NOT_SEEN aqui
     * seria mentir: o catalogo talvez nem tenha sido consultado.
     */
    return { status: "NOT_SEEN", itensRetornados: 0 };
  }

  const itens = Array.isArray(resposta?.results) ? resposta.results : [];

  for (const item of itens) {
    const candidato = normalizeMercadoLivreListingItemId(item.item_id);

    if (candidato === esperado) {
      return { status: "FOUND", item, itemId: esperado };
    }
  }

  return { status: "NOT_SEEN", itensRetornados: itens.length };
}

/**
 * Busca os anuncios de um produto de catalogo.
 *
 * `seller_id` nao vem em `/products/{id}/items` de forma confiavel em todos os
 * casos, mas o endpoint autenticado devolve; o preco tambem. O chamador decide o
 * que fazer quando um campo falta.
 */
export async function buscarItensDeCatalogo(
  catalogProductId: string,
): Promise<CatalogoItensResponse> {
  const catalogo = catalogProductId.trim();

  if (!/^MLB\d{8,}$/.test(catalogo)) {
    throw new Error(
      `[ML_LISTING_FIRST] catalogProductId invalido: "${catalogProductId}".`,
    );
  }

  const resposta = await mercadoLivreFetch(
    `/products/${encodeURIComponent(catalogo)}/items`,
  );

  if (
    typeof resposta !== "object" ||
    resposta === null ||
    !("results" in resposta)
  ) {
    throw new Error(
      `[ML_LISTING_FIRST] /products/${catalogo}/items devolveu payload inesperado.`,
    );
  }

  return resposta as CatalogoItensResponse;
}
