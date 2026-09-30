import assert from "node:assert/strict";

import { runMercadoLivreWorker } from "./worker";
import type {
  GeneratorFn,
  WorkerRunResult,
} from "./worker";
import type {
  MercadoLivreApplyStore,
  MercadoLivrePending,
  MercadoLivrePendingStore,
} from "./pending";

const SOURCE_ML =
  "https://produto.mercadolivre.com.br/MLB-12345678-smartphone-_JM";
const AFFILIATE_ML = "https://meli.la/2qvdFzv";

function pending(overrides: Partial<MercadoLivrePending> = {}): MercadoLivrePending {
  return {
    offerId: "offer-1",
    productId: "prod-1",
    externalId: "MLB12345678",
    sourceUrl: SOURCE_ML,
    opportunityId: "opp-1",
    ...overrides,
  };
}

function createMemoryStores(seed: {
  pendingList?: MercadoLivrePending[];
  offers?: Map<string, { id: string; productId: string; marketplace: string; externalId: string | null; sourceUrl: string | null; affiliateLink: string | null }>;
}) {
  const pendingList = [...(seed.pendingList ?? [])];
  const offers = seed.offers ?? new Map();

  const applied: Array<{ offerId: string; opportunityId: string | null; affiliateUrl: string }> = [];

  const usedOfferIds = new Set<string>();
  for (const p of pendingList) {
    usedOfferIds.add(p.offerId);
    if (!offers.has(p.offerId)) {
      offers.set(p.offerId, {
        id: p.offerId,
        productId: p.productId,
        marketplace: "MERCADO_LIVRE",
        externalId: p.externalId,
        sourceUrl: p.sourceUrl,
        affiliateLink: null,
      });
    }
  }

  const pendingStore: MercadoLivrePendingStore = {
    async listPendingMercadoLivreOffers(limit) {
      return pendingList.slice(0, limit);
    },
    async countPending() {
      return pendingList.length;
    },
    async findOfferById(offerId) {
      const o = offers.get(offerId);
      return o ? { ...o } : null;
    },
  };

  const applyStore: MercadoLivreApplyStore = {
    async applyValidatedAffiliateLink(input) {
      applied.push(input);
      const o = offers.get(input.offerId);
      if (o) o.affiliateLink = input.affiliateUrl;
    },
  };

  return { pendingStore, applyStore, applied, offers };
}

function makeGenerator(seq: Array<Awaited<ReturnType<GeneratorFn>>>): GeneratorFn {
  const calls: Array<{ sourceUrl: string; expectedItemId: string | null }> = [];
  let i = 0;
  const fn: GeneratorFn = async (input) => {
    calls.push(input);
    return seq[Math.min(i++, seq.length - 1)];
  };
  (fn as unknown as { calls: typeof calls }).calls = calls;
  return fn;
}

async function runOne(seq: Array<Awaited<ReturnType<GeneratorFn>>>, opts: { dryRun?: boolean } = {}) {
  const generator = makeGenerator(seq);
  const stores = createMemoryStores({ pendingList: [pending()] });
  const result = await runMercadoLivreWorker(
    { ...stores, generate: generator },
    { limit: 1, cooldownMs: 0, dryRun: opts.dryRun ?? false, log: () => {} },
  );
  return { result, stores, generator: generator as unknown as { calls: Array<{ sourceUrl: string; expectedItemId: string | null }> } };
}

async function run() {
  // 1) SUCCESS grava e aplica
  {
    const { result, stores } = await runOne([
      {
        status: "SUCCESS",
        affiliateUrl: AFFILIATE_ML,
        sourceItemId: "MLB12345678",
        validated: true,
      },
    ]);
    assert.equal(result.updatedCount, 1);
    assert.equal(result.startedCount, 1);
    assert.equal(result.dryRun, false);
    assert.equal(stores.applied.length, 1);
    assert.equal(stores.applied[0].affiliateUrl, AFFILIATE_ML);
    const offer = stores.offers.get("offer-1");
    assert.equal(offer.affiliateLink, AFFILIATE_ML);
  }

  // 2) Oferta já afiliada = SKIP
  {
    const already = pending();
    const stores = createMemoryStores({
      pendingList: [already],
      offers: new Map([
        [
          "offer-1",
          {
            id: "offer-1",
            productId: "prod-1",
            marketplace: "MERCADO_LIVRE",
            externalId: "MLB12345678",
            sourceUrl: SOURCE_ML,
            affiliateLink: AFFILIATE_ML,
          },
        ],
      ]),
    });
    const generator = makeGenerator([]);
    const result = await runMercadoLivreWorker(
      { ...stores, generate: generator },
      { limit: 1, cooldownMs: 0, dryRun: false, log: () => {} },
    );
    assert.equal(result.skippedCount, 1);
    assert.equal(result.updatedCount, 0);
    assert.equal(result.results[0].result, "SKIP_ALREADY_AFFILIATED");
    assert.equal(stores.applied.length, 0);
  }

  // 3) Chrome offline → CHROME_NOT_RUNNING, não grava
  {
    const { result, stores } = await runOne([
      {
        status: "CHROME_NOT_RUNNING",
        reason: "Chrome não acessível em http://127.0.0.1:9222",
      },
    ]);
    assert.equal(result.failedCount, 1);
    assert.equal(result.updatedCount, 0);
    assert.equal(result.results[0].result, "CHROME_NOT_RUNNING");
    assert.equal(stores.applied.length, 0);
  }

  // 4) AUTH_REQUIRED, não grava
  {
    const { result, stores } = await runOne([
      { status: "AUTH_REQUIRED", reason: "autentique manualmente" },
    ]);
    assert.equal(result.failedCount, 1);
    assert.equal(result.results[0].result, "AUTH_REQUIRED");
    assert.equal(stores.applied.length, 0);
  }

  // 5) GENERATION_FAILED, não grava
  {
    const { result, stores } = await runOne([
      { status: "GENERATION_FAILED", reason: "botão não localizado" },
    ]);
    assert.equal(result.failedCount, 1);
    assert.equal(result.results[0].result, "GENERATION_FAILED");
    assert.equal(stores.applied.length, 0);
  }

  // 6) VALIDATION_FAILED, não grava (nunca substituir resultado não validado)
  {
    const { result, stores } = await runOne([
      { status: "VALIDATION_FAILED", reason: "esperado MLB-1, nenhum encontrado" },
    ]);
    assert.equal(result.failedCount, 1);
    assert.equal(result.results[0].result, "VALIDATION_FAILED");
    assert.equal(stores.applied.length, 0);
    const offer = stores.offers.get("offer-1");
    assert.equal(offer.affiliateLink, null);
  }

  // 7) Dry-run: gera e valida mas NÃO grava
  {
    const { result, stores } = await runOne(
      [
        {
          status: "SUCCESS",
          affiliateUrl: AFFILIATE_ML,
          sourceItemId: "MLB12345678",
          validated: true,
        },
      ],
      { dryRun: true },
    );
    assert.equal(result.dryRun, true);
    assert.equal(result.startedCount, 1);
    assert.equal(result.updatedCount, 0);
    assert.equal(stores.applied.length, 0);
    const offer = stores.offers.get("offer-1");
    assert.equal(offer.affiliateLink, null);
  }

  // 8) Limit limita quantidade processada
  {
    const generator = makeGenerator([
      {
        status: "SUCCESS",
        affiliateUrl: AFFILIATE_ML,
        sourceItemId: "MLB12345678",
        validated: true,
      },
      {
        status: "SUCCESS",
        affiliateUrl: AFFILIATE_ML,
        sourceItemId: "MLB-2",
        validated: true,
      },
      {
        status: "SUCCESS",
        affiliateUrl: AFFILIATE_ML,
        sourceItemId: "MLB-3",
        validated: true,
      },
    ]);
    const stores = createMemoryStores({
      pendingList: [
        pending({ offerId: "o1" }),
        pending({ offerId: "o2" }),
        pending({ offerId: "o3", externalId: "MLB11223344" }),
      ],
    });
    const result = await runMercadoLivreWorker(
      { ...stores, generate: generator },
      { limit: 2, cooldownMs: 0, dryRun: false, log: () => {} },
    );
    assert.equal(result.startedCount, 2);
    assert.equal(result.updatedCount, 2);
  }

  // 9) Cooldown aplicado (verifica que houve pausa) — sem asserção temporal frágil
  {
    const generator = makeGenerator([
      { status: "SUCCESS", affiliateUrl: AFFILIATE_ML, sourceItemId: "MLB12345678", validated: true },
    ]);
    const stores = createMemoryStores({ pendingList: [pending()] });
    const result = await runMercadoLivreWorker(
      { ...stores, generate: generator },
      { limit: 1, cooldownMs: 5, dryRun: false, log: () => {} },
    );
    assert.equal(result.updatedCount, 1);
  }

  // 10) Item ML válido: esperadoItemId extraído/base passado ao gerador
  {
    const generator = makeGenerator([
      { status: "SUCCESS", affiliateUrl: AFFILIATE_ML, sourceItemId: "MLB12345678", validated: true },
    ]);
    const stores = createMemoryStores({ pendingList: [pending()] });
    await runMercadoLivreWorker(
      { ...stores, generate: generator },
      { limit: 1, cooldownMs: 0, dryRun: true, log: () => {} },
    );
    const calls = (generator as unknown as { calls: Array<{ sourceUrl: string; expectedItemId: string | null }> }).calls;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].sourceUrl, SOURCE_ML);
    assert.equal(calls[0].expectedItemId, "MLB12345678");
  }

  /*
   * 11) LISTING-FIRST: oferta que NÃO é um anúncio comprovado nunca chega ao
   *     Link Builder.
   *
   * Este é o gate que sustenta ML_ITEM_403_BLOCKS_AFFILIATE=YES. Quando `/items`
   * responde 403, a hidratação fica parcial: sobra um id, e às vezes nem a
   * `sourceUrl` que prova aquele id. Uma oferta nesse estado não pode virar
   * alvo de afiliado — o ML devolveria o anúncio em destaque no momento e
   * gravaríamos um link para o anúncio ERRADO, trocando vendedor e preço sem
   * nenhuma escrita em `externalId`, ou seja, de forma invisível.
   *
   * Fail-closed e SEM redescoberta: o worker nunca escolhe um anúncio
   * substituto para uma oferta de catálogo.
   */
  for (const catalogo of [
    {
      rotulo: "externalId = catalogProductId + sourceUrl /p/",
      externalId: "MLB25263382",
      sourceUrl: "https://www.mercadolivre.com.br/p/MLB25263382",
      // a fonte de catálogo é recusada pelo gate de IDENTIDADE, porque tem URL
      esperado: "SKIP_CATALOG_ONLY",
    },
    {
      rotulo: "externalId de anúncio SEM sourceUrl que o prove",
      externalId: "MLB12345678",
      sourceUrl: null,
      // sem URL não há o que gerar: recusada antes, pelo gate de URL ausente
      esperado: "GENERATION_FAILED",
    },
    {
      rotulo: "externalId de anúncio com sourceUrl de OUTRO anúncio",
      externalId: "MLB12345678",
      sourceUrl: "https://produto.mercadolivre.com.br/MLB-99999999-outro",
      esperado: "SKIP_CATALOG_ONLY",
    },
  ]) {
    const generator = makeGenerator([
      {
        status: "SUCCESS",
        affiliateUrl: AFFILIATE_ML,
        sourceItemId: catalogo.externalId,
        validated: true,
      },
    ]);
    const stores = createMemoryStores({
      pendingList: [pending({ externalId: catalogo.externalId, sourceUrl: catalogo.sourceUrl })],
    });
    const result = await runMercadoLivreWorker(
      { ...stores, generate: generator },
      { limit: 1, cooldownMs: 0, dryRun: false, log: () => {} },
    );
    const calls = (generator as unknown as { calls: Array<{ sourceUrl: string; expectedItemId: string | null }> }).calls;
    assert.equal(calls.length, 0, `${catalogo.rotulo}: não pode chamar o gerador`);
    assert.equal(result.results[0].result, catalogo.esperado, catalogo.rotulo);
    assert.equal(result.updatedCount, 0, catalogo.rotulo);
    assert.equal(stores.applied.length, 0, `${catalogo.rotulo}: nada pode ser gravado`);
    assert.equal(stores.offers.get("offer-1")?.affiliateLink, null, catalogo.rotulo);
  }

  console.log("ML_AFFILIATE_WORKER_TEST_OK");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
