import assert from "node:assert/strict";

import {
  rejeitarOfertaExistenteReavaliada,
} from "./manualComparison";

type LinhaOferta = {
  id: string;
  productId: string;
  marketplace: string;
  externalId: string | null;
  matchStatus: string;
  matchScore: number | null;
  reviewReason: string | null;
  isBest: boolean;
  reviewedAt: Date | null;

  // Campos fora do escopo da rejeicao — devem permanecer intactos.
  active: boolean;
  available: boolean;
  price: number;
  oldPrice: number | null;
  affiliateLink: string | null;
  sourceUrl: string | null;
  stock: number | null;
};

function criarLinha(
  overrides: Partial<LinhaOferta> = {},
) {
  return {
    id: "off-1",
    productId: "prod-1",
    marketplace: "MAGAZINE_LUIZA",
    externalId: "mag-123",
    matchStatus: "EXACT",
    matchScore: 1,
    reviewReason: null,
    isBest: true,
    reviewedAt: null,
    active: true,
    available: true,
    price: 69.98,
    oldPrice: null,
    affiliateLink: "https://af.example/link",
    sourceUrl: "https://magalu.example/123",
    stock: 5,
    ...overrides,
  } satisfies LinhaOferta;
}

function criarHarness(rows: LinhaOferta[]) {
  const sincronizacoes: Array<{ productId: string }> = [];

  const tx = {
    marketplaceOffer: {
      updateMany: async (args: {
        where: {
          productId: string;
          marketplace: string;
          externalId: string | null;
          matchStatus: string;
        };
        data: Partial<LinhaOferta>;
      }) => {
        const alvo = rows.find(
          (row) =>
            row.productId ===
              args.where.productId &&
            row.marketplace ===
              args.where.marketplace &&
            row.externalId ===
              args.where.externalId &&
            row.matchStatus ===
              args.where.matchStatus,
        );

        if (!alvo) {
          return { count: 0 };
        }

        Object.assign(alvo, args.data);
        return { count: 1 };
      },
    },
  };

  const client = {
    $transaction: async (
      callback: (tx: typeof tx) => Promise<unknown>,
    ) => {
      await callback(tx);
    },

    marketplaceOffer: tx.marketplaceOffer,
  };

  return {
    client: client as Parameters<
      typeof rejeitarOfertaExistenteReavaliada
    >[0],

    sincronizarMelhorOferta: async (
      _tx: unknown,
      productId: string,
    ) => {
      sincronizacoes.push({ productId });
    },

    sincronizacoes,
  };
}

const RAZAO =
  "Variante color diferente: cinza x azul.";

/*
 * A. Mesma marketplace + mesmo externalId + mesmo Product + oferta EXACT
 *    reavaliada como NOT EXACT => vira REJECTED (com reason, sem isBest,
 *    matchScore nulo, reviewedAt preenchido) e sincroniza o Product.
 */
async function testarCenarioA() {
  const linha = criarLinha();
  const harness = criarHarness([linha]);

  const rejeitada =
    await rejeitarOfertaExistenteReavaliada(
      harness.client,
      "prod-1",
      "MAGAZINE_LUIZA",
      "mag-123",
      RAZAO,
      {
        suppressProductSync: false,
        sincronizarMelhorOferta:
          harness.sincronizarMelhorOferta,
      },
    );

  assert.equal(rejeitada, true);

  assert.equal(
    linha.matchStatus,
    "REJECTED",
    "A) oferta existente deve virar REJECTED",
  );
  assert.equal(
    linha.matchScore,
    null,
    "A) matchScore deve ser anulado",
  );
  assert.equal(
    linha.reviewReason,
    RAZAO,
    "A) reviewReason deve carregar a razao do matcher",
  );
  assert.equal(
    linha.isBest,
    false,
    "A) oferta rejeitada nao pode ser isBest",
  );
  assert.ok(
    linha.reviewedAt instanceof Date,
    "A) reviewedAt deve ser preenchido",
  );

  assert.equal(
    harness.sincronizacoes.length,
    1,
    "A) sem suppressProductSync, Product deve ser sincronizado",
  );
  assert.equal(
    harness.sincronizacoes[0].productId,
    "prod-1",
  );

  assert.equal(
    linha.active,
    true,
    "A) active nao pode mudar",
  );
  assert.equal(
    linha.available,
    true,
    "A) available nao pode mudar",
  );
  assert.equal(
    linha.price,
    69.98,
    "A) price nao pode mudar",
  );
  assert.equal(
    linha.oldPrice,
    null,
    "A) oldPrice nao pode mudar",
  );
  assert.equal(
    linha.affiliateLink,
    "https://af.example/link",
    "A) affiliateLink nao pode mudar",
  );
  assert.equal(
    linha.sourceUrl,
    "https://magalu.example/123",
    "A) sourceUrl nao pode mudar",
  );
  assert.equal(
    linha.stock,
    5,
    "A) stock nao pode mudar",
  );
}

/*
 * B. Mesma marketplace, externalId diferente
 *    => nenhuma oferta e alterada.
 */
async function testarCenarioB() {
  const linha = criarLinha();
  const harness = criarHarness([linha]);

  const rejeitada =
    await rejeitarOfertaExistenteReavaliada(
      harness.client,
      "prod-1",
      "MAGAZINE_LUIZA",
      "mag-outro-id",
      RAZAO,
      {
        suppressProductSync: false,
        sincronizarMelhorOferta:
          harness.sincronizarMelhorOferta,
      },
    );

  assert.equal(
    rejeitada,
    false,
    "B) externalId diferente nao pode rejeitar",
  );
  assert.equal(
    linha.matchStatus,
    "EXACT",
    "B) oferta com externalId diferente permanece EXACT",
  );
  assert.equal(
    linha.matchScore,
    1,
    "B) matchScore intacto",
  );
  assert.equal(
    linha.isBest,
    true,
    "B) isBest intacto",
  );
  assert.equal(
    harness.sincronizacoes.length,
    0,
    "B) nao deve sincronizar",
  );
}

/*
 * C. Mesmo externalId, Product diferente
 *    => nenhuma oferta do outro Product e alterada.
 */
async function testarCenarioC() {
  const linha = criarLinha({
    productId: "prod-2",
  });
  const harness = criarHarness([linha]);

  const rejeitada =
    await rejeitarOfertaExistenteReavaliada(
      harness.client,
      "prod-1",
      "MAGAZINE_LUIZA",
      "mag-123",
      RAZAO,
      {
        suppressProductSync: false,
        sincronizarMelhorOferta:
          harness.sincronizarMelhorOferta,
      },
    );

  assert.equal(
    rejeitada,
    false,
    "C) oferta de outro Product nao pode ser rejeitada",
  );
  assert.equal(
    linha.productId,
    "prod-2",
    "C) Product intacto",
  );
  assert.equal(
    linha.matchStatus,
    "EXACT",
    "C) oferta do outro Product permanece EXACT",
  );
  assert.equal(
    harness.sincronizacoes.length,
    0,
    "C) nao deve sincronizar",
  );
}

/*
 * D. suppressProductSync = true
 *    => rejeita a oferta existente, mas nao sincroniza o Product.
 */
async function testarSuppressProductSync() {
  const linha = criarLinha();
  const harness = criarHarness([linha]);

  const rejeitada =
    await rejeitarOfertaExistenteReavaliada(
      harness.client,
      "prod-1",
      "MAGAZINE_LUIZA",
      "mag-123",
      RAZAO,
      {
        suppressProductSync: true,
        sincronizarMelhorOferta:
          harness.sincronizarMelhorOferta,
      },
    );

  assert.equal(
    rejeitada,
    true,
    "D) rejeicao deve ocorrer mesmo com suppressProductSync",
  );
  assert.equal(
    linha.matchStatus,
    "REJECTED",
    "D) oferta existente vira REJECTED",
  );
  assert.equal(
    harness.sincronizacoes.length,
    0,
    "D) suppressProductSync=true nao pode sincronizar",
  );
}

async function main() {
  await testarCenarioA();
  await testarCenarioB();
  await testarCenarioC();
  await testarSuppressProductSync();

  console.log(
    "manualComparison.test: OK (revalidacao de oferta existente)",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});