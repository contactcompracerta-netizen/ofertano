import assert from "node:assert/strict";

import {
  DEFAULT_RECONCILE_MAX_WRITES,
  RECONCILE_MAX_WRITES_LIMIT,
  clampMaxWrites,
  identifyPresentationViolations,
  reconcileCatalog,
  type AutoCreatedActiveProductRow,
  type CatalogReconciliationRepository,
} from "./reconciliation";

/*
 * FASE F — RECONCILIADOR (EXECUÇÃO CONSERVADORA, A/B/C/D FICTÍCIOS)
 */

const product = (
  id: string,
  opts: {
    autoCreated?: boolean;
    active?: boolean;
    publicationStatus?: string;
    offers: Array<{
      marketplace: string;
      active?: boolean;
      available?: boolean;
      status?: string;
      matchStatus?: string;
      price?: number | null;
    }>;
  },
): AutoCreatedActiveProductRow => ({
  id,
  name: `Produto ${id}`,
  autoCreated: opts.autoCreated ?? true,
  active: opts.active ?? true,
  publicationStatus: opts.publicationStatus ?? "LIVE_COMPLETE",
  offers:
    opts.offers as AutoCreatedActiveProductRow["offers"],
});

const oferta = (
  marketplace: string,
  overrides: Partial<{
    active: boolean;
    available: boolean;
    status: string;
    matchStatus: string;
    price: number;
  }> = {},
) => ({
  marketplace,
  active: true,
  available: true,
  status: "ACTIVE",
  matchStatus: "EXACT",
  price: 100,
  ...overrides,
});

function repositorioCom(
  produtos: AutoCreatedActiveProductRow[],
): CatalogReconciliationRepository & {
  deactivateCalls: string[];
} {
  const deactivateCalls: string[] = [];

  return {
    deactivateCalls,

    async listAutoCreatedActiveProducts() {
      return produtos;
    },

    async deactivateProductToDraft(
      productId: string,
    ) {
      const alvo = produtos.find((p) => p.id === productId);

      if (!alvo) {
        return false;
      }

      if (
        alvo.active === false &&
        alvo.publicationStatus === "DRAFT"
      ) {
        return false;
      }

      alvo.active = false;
      alvo.publicationStatus = "DRAFT";
      deactivateCalls.push(productId);
      return true;
    },
  };
}

async function main() {
  // 1. DRY-RUN default: nenhuma escrita.
  {
    const repo = repositorioCom([
      product("violacao-1", {
        offers: [oferta("A")],
      }),
    ]);

    const resultado = await reconcileCatalog(repo);

    assert.equal(resultado.dryRun, true);
    assert.equal(resultado.scanned, 1);
    assert.equal(resultado.violations.length, 1);
    assert.equal(resultado.written, 0);
    assert.equal(resultado.skipped, 1);
    assert.equal(repo.deactivateCalls.length, 0);
  }

  // 2. Produto autoCreated single-store => violação identificada.
  {
    const produtos = [
      product("p-single", {
        offers: [oferta("A")],
      }),
      product("p-multi", {
        offers: [oferta("A"), oferta("B")],
      }),
    ];

    const violacoes = identifyPresentationViolations(produtos);

    assert.deepEqual(
      violacoes.map((v) => v.productId),
      ["p-single"],
      "apenas o single-store automático é violação",
    );
    assert.equal(
      violacoes[0].distinctPublicMarketplaces,
      1,
    );
  }

  // 3. canary: maxWrites default = 1.
  {
    assert.equal(DEFAULT_RECONCILE_MAX_WRITES, 1);
    assert.equal(RECONCILE_MAX_WRITES_LIMIT, 50);
    assert.equal(clampMaxWrites(undefined), 1);
    assert.equal(clampMaxWrites("x"), 1);
    assert.equal(clampMaxWrites(0), 0);
    assert.equal(clampMaxWrites(3), 3);
    assert.equal(clampMaxWrites(999), 50);
  }

  // 4. Escrita real com maxWrites=1 corrige somente 1 e re-audita.
  {
    const repo = repositorioCom([
      product("v1", { offers: [oferta("A")] }),
      product("v2", { offers: [oferta("B")] }),
    ]);

    const resultado = await reconcileCatalog(
      repo,
      {
        dryRun: false,
        maxWrites: 1,
      },
    );

    assert.equal(resultado.written, 1);
    assert.equal(resultado.skipped, 1);
    assert.deepEqual(repo.deactivateCalls, ["v1"]);
  }

  // 5. Idempotente: cada produto corrigido uma única vez; rodadas
  // seguintes não re-escrevem nem contam violações para DRAFT/inactive.
  {
    const repo = repositorioCom([
      product("v1", { offers: [oferta("A")] }),
      product("v2", { offers: [oferta("B")] }),
    ]);

    const primeira = await reconcileCatalog(
      repo,
      { dryRun: false, maxWrites: 2 },
    );

    assert.equal(primeira.written, 2);
    assert.deepEqual(repo.deactivateCalls, ["v1", "v2"]);

    const segunda = await reconcileCatalog(
      repo,
      { dryRun: true },
    );

    // Após corrigidos, não são mais violações de apresentação.
    assert.equal(segunda.violations.length, 0);
    assert.equal(segunda.written, 0);

    const reescrita = await reconcileCatalog(
      repo,
      { dryRun: false, maxWrites: 2 },
    );

    // Nenhuma escrita adicional: idempotente.
    assert.equal(reescrita.written, 0);
    assert.deepEqual(repo.deactivateCalls, ["v1", "v2"]);
  }

  // 6. Produtos manuais (autoCreated=false) não são tocados.
  {
    const repo = repositorioCom([
      product("manual-single", {
        autoCreated: false,
        offers: [oferta("A")],
      }),
    ]);

    const violacoes = identifyPresentationViolations(
      await repo.listAutoCreatedActiveProducts(),
    );

    assert.equal(violacoes.length, 0);

    const resultado = await reconcileCatalog(repo, { dryRun: false });

    assert.equal(resultado.written, 0);
    assert.equal(resultado.skipped, 0);
  }

  // 7. B→C real (novo marketplace) deixa de ser violação.
  {
    const produtos = await repositorioCom([
      product("p", { offers: [oferta("A"), oferta("C")] }),
    ]).listAutoCreatedActiveProducts();

    assert.equal(
      identifyPresentationViolations(produtos).length,
      0,
    );
  }

  // 8. Only-A (duas ofertas do mesmo marketplace) segue violação.
  {
    const produtos = await repositorioCom([
      product("p", {
        offers: [oferta("A"), oferta("A", { price: 90 })],
      }),
    ]).listAutoCreatedActiveProducts();

    const violacoes = identifyPresentationViolations(produtos);

    assert.equal(violacoes.length, 1);
    assert.equal(violacoes[0].distinctPublicMarketplaces, 1);
  }

  // 9. UNAVAILABLE/ERROR/não-EXACT/preco<=0 não contam como 2º marketplace.
  {
    for (const segundo of [
      oferta("B", { status: "UNAVAILABLE" }),
      oferta("B", { status: "ERROR" }),
      oferta("B", { matchStatus: "HIGH" }),
      oferta("B", { price: 0 }),
      oferta("B", { available: false }),
    ]) {
      const produtos = [product("p", { offers: [oferta("A"), segundo] })];
      const violacoes = identifyPresentationViolations(produtos);

      assert.equal(
        violacoes.length,
        1,
        `offerta inválida ${JSON.stringify(segundo)} não qualifica`,
      );
    }
  }

  console.log("reconciliation: todos os casos passaram");
}

main().catch((error) => {
  console.error("reconciliation: FALHOU", error);
  process.exit(1);
});