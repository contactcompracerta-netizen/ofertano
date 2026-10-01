/**
 * LISTING-FIRST: refresh de preco de oferta ML com identidade de anuncio.
 *
 * O monitor legado importa a oferta pela `sourceUrl` e chama `saveProduct`.
 * Esse caminho nao serve para uma oferta `identityVersion >= 1`, porque ela
 * deliberadamente nao tem `sourceUrl`: a prova da identidade esta em
 * `externalId` (item_id) + `catalogProductId` + `rawPayload.listing.item_id`.
 *
 * Este modulo faz o refresh pelo catalogo:
 *
 *   catalogProductId -> GET /products/{catalogProductId}/items
 *                    -> localiza item_id === externalId
 *                    -> atualiza AQUELA oferta
 *
 * O que ele nunca faz:
 *   - escolher o item mais barato, o primeiro, ou o `buy_box_winner`;
 *   - trocar `externalId` de uma oferta existente;
 *   - marcar a oferta como OUT_OF_STOCK porque o item nao veio na listagem
 *     (isso e NOT_SEEN, e o ultimo estado bom e preservado);
 *   - fabricar `sourceUrl`.
 */

import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import {
  ML_LISTING_REFRESH_SOURCE,
  buscarItensDeCatalogo,
  classificarItemCatalogoParaOferta,
  type CatalogoItem,
} from "@/services/mercadoLivre/catalogItems";
import { normalizeMercadoLivreListingItemId } from "@/services/mercadoLivre/listingIdentity";
import {
  historicoPrecisaNovaEntrada,
  precoValidoParaHistorico,
} from "@/services/priceHistory/priceHistoryService";

/**
 * Oferta ML elegivel para refresh listing-first.
 *
 * `identityVersion >= 1` e a condicao que separa as ofertas novas das 22
 * legadas: as legadas nao tem `catalogProductId` e nao podem ser refrescadas
 * por este caminho (ver `classificarOfertaParaRefreshListingFirst`).
 */
export type OfertaListingFirst = {
  id: string;
  productId: string;
  externalId: string | null;
  catalogProductId: string | null;
  rawPayload: Prisma.JsonValue | null;
  identityVersion: number;
  price: number;
};

export type ResultadoRefreshListingFirst =
  | {
      status: "UPDATED" | "NOOP";
      offerId: string;
      priceBefore: number;
      priceAfter: number;
      priceChanged: boolean;
    }
  | {
      status: "NOT_SEEN";
      offerId: string;
      priceBefore: number;
      itensRetornados: number;
    }
  | {
      status: "SKIPPED";
      offerId: string;
      reason:
        | "LEGACY_IDENTITY_VERSION_0"
        | "MISSING_CATALOG_PRODUCT_ID"
        | "MISSING_LISTING_ITEM_ID";
    }
  | {
      status: "ERROR";
      offerId: string;
      error: string;
    };

/**
 * Elegibilidade, funcao pura para teste.
 *
 * A oferta legada (identityVersion 0, tipicamente com URL `/p/` de catalogo)
 * nao e "errada": e historico que nao pode ser reescrito por este caminho.
 * Ela volta como SKIPPED, sem tocar em `consecutiveErrors` nem em
 * `errorMessage`, para nao inflar o contador de erro a cada cron.
 */
export function classificarOfertaParaRefreshListingFirst(
  oferta: Pick<
    OfertaListingFirst,
    "identityVersion" | "externalId" | "catalogProductId"
  >,
):
  | { elegivel: true; listingItemId: string; catalogProductId: string }
  | {
      elegivel: false;
      reason:
        | "LEGACY_IDENTITY_VERSION_0"
        | "MISSING_CATALOG_PRODUCT_ID"
        | "MISSING_LISTING_ITEM_ID";
    } {
  if (oferta.identityVersion < 1) {
    return { elegivel: false, reason: "LEGACY_IDENTITY_VERSION_0" };
  }

  const listingItemId = normalizeMercadoLivreListingItemId(
    oferta.externalId,
  );

  if (!listingItemId) {
    return { elegivel: false, reason: "MISSING_LISTING_ITEM_ID" };
  }

  const catalogProductId = oferta.catalogProductId?.trim() ?? "";

  if (!catalogProductId) {
    return { elegivel: false, reason: "MISSING_CATALOG_PRODUCT_ID" };
  }

  return { elegivel: true, listingItemId, catalogProductId };
}

/** Preco utilizavel: finito e positivo. `Infinity` quebra a constraint do banco. */
function precoUtilizavel(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) {
    return null;
  }

  return valor;
}

function sellerIdDoItem(item: CatalogoItem): string | null {
  const bruto = item.seller_id;

  if (bruto === null || bruto === undefined) {
    return null;
  }

  const texto = String(bruto).trim();

  return texto || null;
}

/**
 * Constroi o `rawPayload` atualizado.
 *
 * `rawPayload.listing.item_id` tem que continuar igual a `externalId`: e a
 * condicao que a constraint `ml_listing_identity_v1` checa, e e o que impede
 * que o payload prove um anuncio diferente do que a oferta afirma.
 *
 * O `catalog` anterior e preservado. Uma refresh de preco nao devolve o
 * catalogo, e apagar o nome/estrutura seria perda de dado.
 */
export function montarRawPayloadAtualizado(
  rawPayloadAnterior: Prisma.JsonValue | null,
  entrada: {
    catalogProductId: string;
    listingItemId: string;
    item: CatalogoItem;
  },
): Prisma.InputJsonValue {
  const anterior =
    typeof rawPayloadAnterior === "object" &&
    rawPayloadAnterior !== null &&
    !Array.isArray(rawPayloadAnterior)
      ? (rawPayloadAnterior as Record<string, unknown>)
      : {};

  /*
   * O item do catalogo e reescrito com `item_id` normalizado. Se a API
   * devolvesse o id em formato inesperado, o payload gravado deixaria de
   * provar a identidade e a constraint recusaria a escrita.
   */
  const listing: Record<string, unknown> = {
    ...entrada.item,
    item_id: entrada.listingItemId,
  };

  /*
   * O cast e de forma, nao de conteudo: os dois lados vem de `JSON.parse` de
   * resposta da API, entao todo valor ja e JSON-serializavel. O TS nao
   * consegue provar isso a partir de `Record<string, unknown>`.
   */
  return {
    ...anterior,
    source: ML_LISTING_REFRESH_SOURCE,
    catalogProductId: entrada.catalogProductId,
    listing,
  } as Prisma.InputJsonValue;
}

/**
 * Refresh de UMA oferta listing-first.
 *
 * Nao lanca: devolve `status: "ERROR"` com a mensagem. O monitor decide como
 * contabilizar, e um erro de rede em uma oferta nao pode derrubar o lote.
 *
 * Escreve em SUCESSO/NOOP/NOT_SEEN. Em ERROR nao toca no banco: quem chama
 * registra o erro e aplica o backoff.
 */
export async function refreshOfertaListingFirst(
  oferta: OfertaListingFirst,
  agora: Date = new Date(),
): Promise<ResultadoRefreshListingFirst> {
  const classificacao = classificarOfertaParaRefreshListingFirst(oferta);

  if (!classificacao.elegivel) {
    return {
      status: "SKIPPED",
      offerId: oferta.id,
      reason: classificacao.reason,
    };
  }

  const { listingItemId, catalogProductId } = classificacao;

  let classificacaoItem: ReturnType<typeof classificarItemCatalogoParaOferta>;

  try {
    const resposta = await buscarItensDeCatalogo(catalogProductId);
    classificacaoItem = classificarItemCatalogoParaOferta(
      resposta,
      listingItemId,
    );
  } catch (error) {
    return {
      status: "ERROR",
      offerId: oferta.id,
      error:
        error instanceof Error
          ? error.message
          : "Erro desconhecido ao consultar o catalogo.",
    };
  }

  if (classificacaoItem.status === "NOT_SEEN") {
    /*
     * O catalogo respondeu e NAO trouxe aquele anuncio. Isso nao prova
     * ruptura: o anuncio pode ter saido do catalogo mantendo o item ativo.
     * Marcar OUT_OF_STOCK aqui seria afirmar algo que a fonte nao disse.
     *
     * Preservamos o ultimo estado bom: o unico campo tocado e
     * `lastCheckedAt`, para o lote nao repetir a oferta no mesmo ciclo.
     */
    await prisma.marketplaceOffer.update({
      where: { id: oferta.id },
      data: {
        lastCheckedAt: agora,
      },
    });

    return {
      status: "NOT_SEEN",
      offerId: oferta.id,
      priceBefore: oferta.price,
      itensRetornados: classificacaoItem.itensRetornados,
    };
  }

  const item = classificacaoItem.item;
  const preco = precoUtilizavel(item.price);

  if (preco === null) {
    return {
      status: "ERROR",
      offerId: oferta.id,
      error:
        `[ML_LISTING_FIRST] ${listingItemId}: preco ausente ou invalido ` +
        `(${JSON.stringify(item.price)}). Oferta nao foi alterada.`,
    };
  }

  const precoAntigo = oferta.price;
  const mudouPreco = Math.abs(precoAntigo - preco) > 0.009;

  const rawPayload = montarRawPayloadAtualizado(oferta.rawPayload, {
    catalogProductId,
    listingItemId,
    item,
  });

  /*
   * Campos que a fonte nao devolve ficam `undefined` e o Prisma NAO os
   * altera. Sobrescrever com `null` a cada ciclo apagaria prova coletada
   * antes, e a ausencia de um campo na resposta nao e evidencia de que ele
   * mudou.
   */
  const seller = sellerIdDoItem(item) ?? undefined;
  const condition =
    typeof item.condition === "string" && item.condition.trim() !== ""
      ? item.condition
      : undefined;
  const shipping =
    item.shipping === null || item.shipping === undefined
      ? undefined
      : (item.shipping as Prisma.InputJsonValue);

  const ultimoHistorico = await prisma.priceHistory.findFirst({
    where: { offerId: oferta.id },
    orderBy: { recordedAt: "desc" },
    select: { price: true },
  });

  await prisma.$transaction(async (tx) => {
    await tx.marketplaceOffer.update({
      where: { id: oferta.id },
      data: {
        price: preco,
        seller,
        condition,
        shipping,
        rawPayload,
        lastCheckedAt: agora,
        consecutiveErrors: 0,
        errorMessage: null,
        ...(mudouPreco ? { lastPriceChangeAt: agora } : {}),
      },
    });

    if (
      historicoPrecisaNovaEntrada({
        precoAnterior: ultimoHistorico?.price ?? null,
        precoNovo: preco,
      })
    ) {
      const precoOriginal = precoUtilizavel(item.original_price);

      await tx.priceHistory.create({
        data: {
          productId: oferta.productId,
          offerId: oferta.id,
          marketplace: "MERCADO_LIVRE",
          price: preco,
          oldPrice:
            precoOriginal !== null &&
            precoValidoParaHistorico(precoOriginal)
              ? precoOriginal
              : null,
          source: "PRICE_MONITOR",
        },
      });
    }
  });

  return {
    status: mudouPreco ? "UPDATED" : "NOOP",
    offerId: oferta.id,
    priceBefore: precoAntigo,
    priceAfter: preco,
    priceChanged: mudouPreco,
  };
}
