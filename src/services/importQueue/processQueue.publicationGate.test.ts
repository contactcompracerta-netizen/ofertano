import assert from "node:assert/strict";

import {
  avaliarRetryPublicacaoAutoCatalogo,
} from "./processQueue";

import {
  PUBLIC_MULTISTORE_MIN_MARKETPLACES,
  hasPublicMultiStore,
} from "../publicVisibility/multiStoreVisibility";

type OfertaPublica = {
  marketplace: string;
  active?: boolean;
  available?: boolean;
  status?: string;
  matchStatus?: string;
  price?: number | null;
};

const oferta = (
  marketplace: string,
  overrides: Partial<OfertaPublica> = {},
): OfertaPublica => ({
  marketplace,
  active: true,
  matchStatus: "EXACT",
  available: true,
  status: "ACTIVE",
  price: 100,
  ...overrides,
});

/*
 * REGRESSAO — retry de Product autoCreated em DRAFT
 *
 * Modo `item.productId && !item.opportunityId` de processImportQueue.
 * O retry NÃO pode fingir sucesso: se o Product automático não
 * alcançou os marketplaces públicos mínimos, a fila termina em ERROR
 * e o produto permanece publicamente oculto.
 */

// H. Product autoCreated DRAFT + 1 marketplace válido => NÃO SUCCESS
{
  const ofertas = [oferta("MERCADO_LIVRE")];

  const gate =
    avaliarRetryPublicacaoAutoCatalogo({
      autoCreated: true,
      ofertasPublicas: ofertas,
    });

  assert.equal(
    gate.permitirSucesso,
    false,
    "H: retry com 1 marketplace nao pode terminar SUCCESS",
  );

  assert.equal(
    gate.motivo,
    "AUTO_CATALOG_INSUFFICIENT_PUBLIC_MULTISTORE",
    "H: motivo determinístico para o tratamento ERROR da fila",
  );

  assert.equal(
    hasPublicMultiStore({ offers: ofertas }),
    false,
    "H: permanece publicamente oculto (pagina 404)",
  );
}

// H adicional: 2 entradas do MESMO marketplace também não publicam
{
  const gate =
    avaliarRetryPublicacaoAutoCatalogo({
      autoCreated: true,
      ofertasPublicas: [
        oferta("MERCADO_LIVRE"),
        oferta("MERCADO_LIVRE", { price: 90 }),
      ],
    });

  assert.equal(
    gate.permitirSucesso,
    false,
    "H: duas entradas da mesma loja nao constroem Multi Loja",
  );
}

// H adicional: segunda loja com oferta inválida não publica
{
  const gate =
    avaliarRetryPublicacaoAutoCatalogo({
      autoCreated: true,
      ofertasPublicas: [
        oferta("MERCADO_LIVRE"),
        oferta("AMAZON", { status: "ERROR" }),
      ],
    });

  assert.equal(
    gate.permitirSucesso,
    false,
    "H: oferta ERROR nao qualifica a segunda loja",
  );
}

// I. Product autoCreated DRAFT que alcançou 2 marketplaces => publica
{
  const ofertas = [
    oferta("MERCADO_LIVRE"),
    oferta("MAGAZINE_LUIZA"),
  ];

  const gate =
    avaliarRetryPublicacaoAutoCatalogo({
      autoCreated: true,
      ofertasPublicas: ofertas,
    });

  assert.equal(
    gate.permitirSucesso,
    true,
    "I: retry com 2 marketplaces distintos pode sincronizar e ir a SUCCESS",
  );

  assert.equal(
    gate.motivo,
    null,
    "I: sem motivo de erro",
  );

  assert.equal(
    hasPublicMultiStore({ offers: ofertas }),
    true,
    "I: página do produto fica elegível para visibilidade pública",
  );

  assert.ok(
    ofertas.length >= PUBLIC_MULTISTORE_MIN_MARKETPLACES,
    "I: atende ao mínimo público de marketplaces",
  );
}

// Product NÃO autoCreated preserva o comportamento anterior.
{
  const gate =
    avaliarRetryPublicacaoAutoCatalogo({
      autoCreated: false,
      ofertasPublicas: [oferta("MERCADO_LIVRE")],
    });

  assert.equal(
    gate.permitirSucesso,
    true,
    "fluxo manual não-autoCreated mantém o comportamento anterior",
  );
}

console.log(
  "processQueue.publicationGate: todos os casos passaram",
);
