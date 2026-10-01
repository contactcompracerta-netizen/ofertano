import assert from "node:assert/strict";

import {
  buildListingFirstMonitorCandidateWhere,
  buildPriceMonitorCandidateWhere,
} from "./processPriceMonitor";
import {
  classificarOfertaParaRefreshListingFirst,
  montarRawPayloadAtualizado,
} from "./listingFirstRefresh";
import { classificarItemCatalogoParaOferta } from "@/services/mercadoLivre/catalogItems";
import { normalizeMercadoLivreListingItemId } from "@/services/mercadoLivre/listingIdentity";

/*
 * MONITOR DE PRECO LISTING-FIRST — testes de regressao.
 *
 * O monitor legado importa a oferta pela `sourceUrl`. Uma oferta ML
 * `identityVersion >= 1` NAO tem `sourceUrl`: a prova da identidade esta em
 * `externalId` (item_id) + `catalogProductId` + `rawPayload.listing.item_id`.
 * Se o monitor continuasse exigindo `sourceUrl`, as 25 ofertas v1 ficariam
 * fora da observacao — e se ele fabricasse uma URL, estaria inventando dado.
 *
 * Este arquivo trava tres decisoes:
 *
 *   1. SELECAO — quem entra no lote (ML v1 entra sem `sourceUrl`; as 22
 *      legadas v0 ficam de fora, sem virar erro).
 *   2. IDENTIDADE — o item do catalogo procurado e o de
 *      `item_id === externalId`. Nunca o mais barato, o primeiro, nem o
 *      `buy_box_winner`.
 *   3. PRESERVACAO — `NOT_SEEN` nao marca ruptura e nao troca o preco; o
 *      `rawPayload` gravado continua provando o MESMO anuncio.
 *
 * Sem banco e sem HTTP: as funções exercitadas são puras.
 */

/** Avaliador mínimo do `where` do monitor, só para o formato que ele usa. */
function avaliar(
  oferta: Record<string, unknown>,
  filtro: Record<string, unknown>,
): boolean {
  for (const [campo, criterio] of Object.entries(filtro)) {
    if (campo === "AND") {
      const partes = criterio as Record<string, unknown>[];
      if (!partes.every((parte) => avaliar(oferta, parte))) return false;
      continue;
    }

    if (campo === "OR") {
      const partes = criterio as Record<string, unknown>[];
      if (!partes.some((parte) => avaliar(oferta, parte))) return false;
      continue;
    }

    if (campo === "nextCheckAt") {
      const alvo = oferta.nextCheckAt as string | null;

      if (criterio === null) {
        if (alvo !== null) return false;
        continue;
      }

      const bruto = (criterio as { lte?: Date | string } | null)?.lte ?? null;
      if (bruto === null || bruto === undefined) continue;
      const lte =
        bruto instanceof Date ? bruto.toISOString() : String(bruto);
      if (!(alvo === null || alvo <= lte)) return false;
      continue;
    }

    if (campo === "matchStatus") {
      if (oferta.matchStatus === (criterio as { not: string }).not) return false;
      continue;
    }

    if (campo === "identityVersion") {
      if ((oferta.identityVersion as number) < (criterio as { gte: number }).gte) {
        return false;
      }
      continue;
    }

    if (campo === "sourceUrl") {
      if (oferta.sourceUrl === null) return false;
      continue;
    }

    if (campo === "marketplace") {
      const esperado = criterio as string | { not: string };
      if (typeof esperado === "string") {
        if (oferta.marketplace !== esperado) return false;
        continue;
      }
      if (oferta.marketplace === esperado.not) return false;
      continue;
    }

    if (oferta[campo] !== criterio) return false;
  }

  return true;
}

const AGORA = "2026-09-30T12:00:00.000Z";

function oferta(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    active: true,
    matchStatus: "EXACT",
    nextCheckAt: null,
    sourceUrl: null,
    identityVersion: 1,
    ...extra,
  };
}

// CASO 1 — SELECAO: a oferta ML v1 entra no lote SEM `sourceUrl`.
{
  const where = buildPriceMonitorCandidateWhere(new Date(AGORA));

  const mlV1 = oferta({ marketplace: "MERCADO_LIVRE", identityVersion: 1 });
  assert.equal(
    avaliar(mlV1, where as unknown as Record<string, unknown>),
    true,
    "ML v1 com sourceUrl NULL e elegivel",
  );

  const shopee = oferta({
    marketplace: "SHOPEE",
    sourceUrl: "https://shopee.com.br/item/1",
  });
  assert.equal(
    avaliar(shopee, where as unknown as Record<string, unknown>),
    true,
    "nao-ML com sourceUrl continua elegivel",
  );

  const magalu = oferta({
    marketplace: "MAGAZU",
    sourceUrl: "https://magazineluiza.com.br/p/MLA123",
  });
  assert.equal(
    avaliar(magalu, where as unknown as Record<string, unknown>),
    true,
    "nao-ML elegivel por marketplace",
  );
  console.log("MONITOR_SELECTS_V1_WITHOUT_SOURCE_URL=PASS");
}

// CASO 2 — SELECAO: as 22 legadas (identityVersion 0, URL `/p/`) ficam de
// fora. Nao por erro, nao por delete: elas simplesmente nao pertencem a este
// caminho.
{
  const where = buildPriceMonitorCandidateWhere(new Date(AGORA));

  for (const url of [
    "https://www.mercadolivre.com.br/p/MLB1234567890",
    "https://www.mercadolivre.com.br/MLB1234567890",
    null,
  ]) {
    const legada = oferta({
      marketplace: "MERCADO_LIVRE",
      identityVersion: 0,
      sourceUrl: url,
    });
    assert.equal(
      avaliar(legada, where as unknown as Record<string, unknown>),
      false,
      `legada ML (identityVersion 0, sourceUrl ${url}) fora do monitor novo`,
    );
  }

  /*
   * As ofertas nao-ML legadas NAO sao excluidas: elas tem `sourceUrl` de
   * verdade e continuam pelo caminho legado (`saveProduct`). A exclusao e
   * especifica do ML, onde `identityVersion` e o que separa a prova de
   * anuncio da URL de catalogo.
   */
  const naoMlLegada = oferta({
    marketplace: "SHOPEE",
    identityVersion: 0,
    sourceUrl: "https://shopee.com.br/item/1",
  });
  assert.equal(
    avaliar(naoMlLegada, where as unknown as Record<string, unknown>),
    true,
    "legada nao-ML continua elegivel pelo caminho legado (sourceUrl)",
  );
  console.log("MONITOR_EXCLUDES_LEGACY_V0=PASS");
}

// CASO 3 — SELECAO: as garantias antigas continuam valendo.
{
  const where = buildPriceMonitorCandidateWhere(new Date(AGORA));
  const w = where as unknown as Record<string, unknown>;

  assert.equal(w.active, true, "monitor mantem active");
  assert.deepEqual(
    w.matchStatus,
    { not: "REJECTED" },
    "monitor mantem matchStatus not REJECTED",
  );

  const rejeitada = oferta({
    marketplace: "MERCADO_LIVRE",
    matchStatus: "REJECTED",
  });
  assert.equal(
    avaliar(rejeitada, w),
    false,
    "REJECTED nunca e automaticamente reavaliada",
  );

  const inativa = oferta({
    marketplace: "MERCADO_LIVRE",
    active: false,
  });
  assert.equal(avaliar(inativa, w), false, "inativa fora do lote");

  const agendada = oferta({
    marketplace: "MERCADO_LIVRE",
    nextCheckAt: "2026-09-30T18:00:00.000Z",
  });
  assert.equal(
    avaliar(agendada, w),
    false,
    "oferta com nextCheckAt no futuro fica para o proximo ciclo",
  );

  const vencida = oferta({
    marketplace: "MERCADO_LIVRE",
    nextCheckAt: "2026-09-30T11:00:00.000Z",
  });
  assert.equal(
    avaliar(vencida, w),
    true,
    "oferta vencida entra no lote",
  );
  console.log("MONITOR_PRESERVES_PRIOR_GUARDS=PASS");
}

// CASO 4 — ELEGIBILIDADE do refresh: v1 precisa de item_id E de catálogo.
{
  const v1 = classificarOfertaParaRefreshListingFirst({
    identityVersion: 1,
    externalId: "MLB1234567890",
    catalogProductId: "MLB9876543210",
  });
  assert.deepEqual(v1, {
    elegivel: true,
    listingItemId: "MLB1234567890",
    catalogProductId: "MLB9876543210",
  });

  const legado = classificarOfertaParaRefreshListingFirst({
    identityVersion: 0,
    externalId: "MLB1234567890",
    catalogProductId: "MLB9876543210",
  });
  assert.deepEqual(legado, {
    elegivel: false,
    reason: "LEGACY_IDENTITY_VERSION_0",
  });

  const semItem = classificarOfertaParaRefreshListingFirst({
    identityVersion: 1,
    externalId: null,
    catalogProductId: "MLB9876543210",
  });
  assert.deepEqual(semItem, {
    elegivel: false,
    reason: "MISSING_LISTING_ITEM_ID",
  });

  const semCatalogo = classificarOfertaParaRefreshListingFirst({
    identityVersion: 1,
    externalId: "MLB1234567890",
    catalogProductId: "   ",
  });
  assert.deepEqual(semCatalogo, {
    elegivel: false,
    reason: "MISSING_CATALOG_PRODUCT_ID",
  });
  console.log("REFRESH_ELIGIBILITY=PASS");
}

// CASO 5 — IDENTIDADE: o item escolhido e o de `item_id === externalId`,
// mesmo quando o catalogo trouxer outros mais baratos, primeiro na lista ou
// com `buy_box_winner`.
{
  const resposta = {
    results: [
      {
        item_id: "MLB0000000001",
        price: 1,
        seller_id: 111,
        buy_box_winner: true,
      },
      {
        item_id: "MLB2222222222",
        price: 99,
        seller_id: 222,
        condition: "new",
        shipping: { free_shipping: true },
      },
      {
        item_id: "MLB3333333333",
        price: 50,
        seller_id: 333,
      },
    ],
    paging: { total: 3 },
  };

  const escolhido = classificarItemCatalogoParaOferta(
    resposta,
    "MLB2222222222",
  );
  assert.equal(escolhido.status, "FOUND");
  assert.equal(
    escolhido.status === "FOUND" && escolhido.itemId,
    "MLB2222222222",
    "escolhe pelo item_id, nao pelo primeiro/barato/buy_box",
  );
  assert.equal(
    escolhido.status === "FOUND" && escolhido.item.price,
    99,
    "o preco e o do anuncio certo, nao o menor da lista",
  );
  console.log("REFRESH_MATCHES_EXACT_ITEM_ID=PASS");
}

// CASO 6 — IDENTIDADE: catalogo 200 que nao traz o item e NOT_SEEN. Nao e
// "achou substituto", e nao prova ruptura.
{
  const resposta = {
    results: [
      { item_id: "MLB0000000001", price: 1 },
      { item_id: "MLB3333333333", price: 50 },
    ],
  };

  const ausente = classificarItemCatalogoParaOferta(
    resposta,
    "MLB2222222222",
  );
  assert.deepEqual(
    ausente,
    { status: "NOT_SEEN", itensRetornados: 2 },
    "ausente vira NOT_SEEN com a contagem para diagnostico",
  );

  assert.deepEqual(
    classificarItemCatalogoParaOferta(resposta, "MLB3333333333").status,
    "FOUND",
    "o item presente e encontrado",
  );

  assert.deepEqual(
    classificarItemCatalogoParaOferta({ results: [] }, "MLB3333333333"),
    { status: "NOT_SEEN", itensRetornados: 0 },
    "catalogo vazio nao prova ruptura",
  );

  assert.deepEqual(
    classificarItemCatalogoParaOferta(null, "MLB3333333333"),
    { status: "NOT_SEEN", itensRetornados: 0 },
    "resposta ausente nao prova ruptura",
  );
  console.log("REFRESH_NOT_SEEN_WHEN_ITEM_ABSENT=PASS");
}

// CASO 7 — IDENTIDADE: o item_id do catalogo nunca "encaixa" por proximidade
// nem por sufixo. Um item_id invalido no payload tambem nao serve.
{
  /*
   * `item_id` numerico e um formato inesperado da API. O normalizador tem de
   * recusar — um id que nao casa nao pode virar "o anuncio", porque a
   * constraint `ml_listing_identity_v1` compara `rawPayload.listing.item_id`
   * com `externalId` como texto.
   */
  const resposta = {
    results: [
      { item_id: "MLB22222222220", price: 10 },
      { item_id: "MLBU2222222222", price: 20 },
      { item_id: 12345 as unknown as string, price: 30 },
    ],
  };

  assert.deepEqual(
    classificarItemCatalogoParaOferta(resposta, "MLB2222222222"),
    { status: "NOT_SEEN", itensRetornados: 3 },
    "nenhum quase-igual e aceito como o anuncio",
  );

  assert.deepEqual(
    classificarItemCatalogoParaOferta(
      { results: [{ item_id: "MLB3333333333", price: 1 }] },
      "nao-e-item-ml",
    ),
    { status: "NOT_SEEN", itensRetornados: 0 },
    "procurar por algo que nao e item_id ML nunca casa por coincidencia",
  );

  assert.equal(
    normalizeMercadoLivreListingItemId("MLB1234567890"),
    "MLB1234567890",
  );
  assert.equal(
    normalizeMercadoLivreListingItemId("MLBU1234567890"),
    null,
    "prefixo MLU nao e identidade de anuncio ML",
  );
  console.log("REFRESH_ITEM_ID_IS_EXACT=PASS");
}

// CASO 8 — PRESERVACAO: o `rawPayload` gravado continua provando o MESMO
// anuncio, e o catalogo anterior nao e apagado.
{
  const anterior = {
    source: "CATALOG_ITEMS",
    catalogProductId: "MLB9876543210",
    catalog: { name: "Furadeira", attributes: [{ id: "BRAND", value: "X" }] },
    listing: { item_id: "MLB2222222222", price: 120, seller_id: 222 },
  };

  const novo = montarRawPayloadAtualizado(anterior, {
    catalogProductId: "MLB9876543210",
    listingItemId: "MLB2222222222",
    item: { price: 99, seller_id: 999, condition: "new", shipping: {} },
  }) as Record<string, Record<string, unknown>>;

  assert.equal(novo.source, "CATALOG_ITEMS");
  assert.equal(novo.catalogProductId, "MLB9876543210");
  assert.deepEqual(
    novo.catalog,
    anterior.catalog,
    "o catalogo anterior e preservado (refresh de preco nao devolve catalogo)",
  );
  assert.equal(
    novo.listing.item_id,
    "MLB2222222222",
    "listing.item_id e normalizado para o externalId da oferta",
  );
  assert.equal(novo.listing.price, 99);
  assert.equal(novo.listing.seller_id, 999);
  assert.equal(novo.listing.condition, "new");
  console.log("RAW_PAYLOAD_STILL_PROVES_SAME_LISTING=PASS");
}

// CASO 9 — PRESERVACAO: se a API devolver um item_id inesperado, o payload
// gravado seria unable a provar a identidade. O normalizador garante que
// `item_id` gravado e o `listingItemId` da oferta, nunca o do catalogo.
{
  const anterior = null;

  const novo = montarRawPayloadAtualizado(anterior, {
    catalogProductId: "MLB9876543210",
    listingItemId: "MLB2222222222",
    item: {
      item_id: "MLB0000000001",
      price: 10,
      original_price: 20,
    },
  }) as Record<string, Record<string, unknown>>;

  assert.equal(
    novo.listing.item_id,
    "MLB2222222222",
    "o item_id do payload e o da oferta, nao o do item do catalogo",
  );
  assert.equal(novo.listing.price, 10);
  assert.equal(novo.listing.original_price, 20);
  console.log("RAW_PAYLOAD_ITEM_ID_OVERRIDDEN=PASS");
}

// CASO 10 — OBSERVAR NAO E PUBLICAR: o passo LISTING-FIRST entra mesmo sem
// `active`, porque uma oferta ML v1 nao tem `sourceUrl` e portanto nunca e
// publicavel. O que o passo NAO abre tambem fica travado aqui.
{
  const legado = buildPriceMonitorCandidateWhere(
    new Date(AGORA),
  ) as unknown as Record<string, unknown>;
  const listingFirst = buildListingFirstMonitorCandidateWhere(
    new Date(AGORA),
  ) as unknown as Record<string, unknown>;

  const inativaV1 = oferta({
    marketplace: "MERCADO_LIVRE",
    identityVersion: 1,
    active: false,
    sourceUrl: null,
  });

  assert.equal(
    avaliar(inativaV1, listingFirst),
    true,
    "ML v1 inativa ainda e observada: sem sourceUrl ela nunca e publica, logo nao ha preco obsoleto a preservar",
  );

  assert.equal(
    avaliar(inativaV1, legado),
    false,
    "o lote legado continua exigindo active",
  );

  assert.equal(
    listingFirst.active,
    undefined,
    "o passo listing-first nao exige active",
  );
  assert.equal(
    listingFirst.marketplace,
    "MERCADO_LIVRE",
    "o passo listing-first nao alcanca nenhuma outra marketplace",
  );

  // Nao abre as 22 legadas.
  for (const url of [
    "https://www.mercadolivre.com.br/p/MLB1234567890",
    null,
  ]) {
    assert.equal(
      avaliar(
        oferta({
          marketplace: "MERCADO_LIVRE",
          identityVersion: 0,
          active: false,
          sourceUrl: url,
        }),
        listingFirst,
      ),
      false,
      `legada ML (identityVersion 0, sourceUrl ${url}) fora do passo listing-first`,
    );
  }

  // Nao reabre REJECTED.
  assert.equal(
    avaliar(
      oferta({
        marketplace: "MERCADO_LIVRE",
        identityVersion: 1,
        active: false,
        matchStatus: "REJECTED",
      }),
      listingFirst,
    ),
    false,
    "REJECTED continua fora mesmo inativa",
  );

  // Nao alcança as nao-ML (que dependem de `sourceUrl`).
  assert.equal(
    avaliar(
      oferta({
        marketplace: "SHOPEE",
        identityVersion: 1,
        active: false,
        sourceUrl: "https://shopee.com.br/item/1",
      }),
      listingFirst,
    ),
    false,
    "nao-ML nunca entra pelo passo listing-first",
  );

  // E ainda respeita o agendamento.
  assert.equal(
    avaliar(
      oferta({
        marketplace: "MERCADO_LIVRE",
        identityVersion: 1,
        active: false,
        nextCheckAt: "2026-09-30T18:00:00.000Z",
      }),
      listingFirst,
    ),
    false,
    "ML v1 com nextCheckAt no futuro espera o proximo ciclo",
  );
  console.log("LISTING_FIRST_OBSERVES_INACTIVE_WITHOUT_PUBLISHING=PASS");
}

console.log("listingFirstMonitor: todos os casos passaram");
