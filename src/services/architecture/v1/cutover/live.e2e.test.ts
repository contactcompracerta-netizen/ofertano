/**
 * CATALOG_ARCHITECTURE_V1 — FASE 7.1: PROVA END-TO-END DO GATE LIVE.
 *
 * `live.test.ts` prova a LÓGICA de decisão com executor falso. Este arquivo
 * prova a metade que só o banco real prova: o `saveProduct` DE VERDADE,
 * dentro do funil real, consumindo o orçamento global real.
 *
 * Cenários:
 *   E1) SEM rollout armado => LEGACY_ONLY, zero contabilidade, produto salvo.
 *   E2) rollout ARMADO => 1 listagem real consome EXATAMENTE 1 slot e grava
 *       o marcador V1_COMMITTED, na MESMA transação do catálogo.
 *   E3) REPLAY da mesma listagem => ZERO duplicata de Product/Offer/PriceHistory.
 *   E4) BYPASS interno => zero I/O de controle: nenhum slot, nenhum evento.
 *   E5) ORÇAMENTO ESGOTADO => a listagem segue pelo legado (não é erro).
 *   E6) BREAKER GLOBAL aberto => fail-closed de TODAS as instâncias, sem novo
 *       deploy, e a escrita continua pelo legado.
 *   E7) FALHA PRÉ-COMMIT TRANSITÓRIA => o fallback assume (1 write só).
 *   E8) MULTILOJA => 1 marketplace => DRAFT/inativo; 2 marketplaces => público.
 *   E9) AGNOSTICISMO => qualquer marketplaceId behaves igual (sem código
 *       por nome de marketplace).
 *
 * Requer o banco de missão local. NÃO faz parte de `npm test`.
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55471/ofertano_fase71_global_control \
 *     npx tsx src/services/architecture/v1/cutover/live.e2e.test.ts
 */
import assert from "node:assert/strict";
import { Client } from "pg";

/* Tripwire: só o banco de missão desta fase. Nunca produção. */
const MISSION_URL = process.env.DATABASE_URL ?? "";
{
  const target = new URL(MISSION_URL);
  if (
    target.hostname !== "127.0.0.1" ||
    Number(target.port) !== 55471 ||
    target.pathname !== "/ofertano_fase71_global_control"
  ) {
    throw new Error(
      `LOCAL_TRIPWIRE: banco de missão obrigatório (127.0.0.1:55471/ofertano_fase71_global_control), recebido ${MISSION_URL.replace(/:[^:@/]*@/, ":***@")}`,
    );
  }
}

/*
 * Importações DINÂMICAS: `prisma` e o pool do plano de controle capturam
 * `process.env.DATABASE_URL` no momento do import, então este arquivo tem de
 * carregar o cliente DEPOIS do tripwire. (O projeto compila para CJS: nada de
 * top-level await aqui.)
 */
type PrismaClient = import("@prisma/client").PrismaClient;
type SaveProduct = typeof import("@/services/database/saveProduct").saveProduct;
type Sync = typeof import("@/services/database/saveProduct").sincronizarMelhorOfertaDoProduto;
type GlobalControl = typeof import("./globalControl");

let prisma: PrismaClient;
let saveProduct: SaveProduct;
let sincronizarMelhorOfertaDoProduto: Sync;
let globalControl: GlobalControl;
let PUBLIC_MULTISTORE_MIN_MARKETPLACES: number;

async function loadRuntime(): Promise<void> {
  process.env.DATABASE_URL = MISSION_URL;
  prisma = (await import("@/lib/prisma")).default;
  const saveProductModule = await import("@/services/database/saveProduct");
  saveProduct = saveProductModule.saveProduct;
  sincronizarMelhorOfertaDoProduto =
    saveProductModule.sincronizarMelhorOfertaDoProduto;
  globalControl = await import("./globalControl");
  PUBLIC_MULTISTORE_MIN_MARKETPLACES = (
    await import("@/services/publicVisibility/multiStoreVisibility")
  ).PUBLIC_MULTISTORE_MIN_MARKETPLACES;
}

type Snapshot = {
  products: number;
  offers: number;
  history: number;
  events: number;
  usedWrites: number;
};

const createdProductIds: string[] = [];

/** Cliente administrativo dedicado: DDL de teste (gatilho de falha) e TRUNCATE. */
const admin = new Client({ connectionString: MISSION_URL });

async function counts(): Promise<Snapshot> {
  const control = globalControl.globalControlPool(MISSION_URL)!;
  const [products, offers, history, events, rollout] = await Promise.all([
    prisma.product.count(),
    prisma.marketplaceOffer.count(),
    prisma.priceHistory.count(),
    control.query<{ total: number }>(
      'SELECT COUNT(*)::int AS "total" FROM "CatalogCutoverEvent"',
    ),
    control.query<{ used: number }>(
      'SELECT COALESCE(SUM("usedWrites"), 0)::int AS "used" FROM "CatalogCutoverRollout"',
    ),
  ]);
  return {
    products,
    offers,
    history,
    events: events.rows[0].total,
    usedWrites: rollout.rows[0].used,
  };
}

async function eventsOf(kind: string): Promise<
  Array<{ kind: string; executionId: string; reason: string | null }>
> {
  const res = await globalControl.globalControlPool(MISSION_URL)!.query<{
    kind: string;
    executionId: string;
    reason: string | null;
  }>(
    `SELECT "kind"::text AS "kind", "executionId", "reason"
       FROM "CatalogCutoverEvent"
      WHERE "kind" = $1::"CatalogCutoverEventKind"
      ORDER BY "createdAt" ASC`,
    [kind],
  );
  return res.rows;
}

function listing(marketplace: string, externalId: string, price: number) {
  return {
    marketplace,
    externalId,
    url: `https://exemplo.fase71.test/${externalId}`,
    title: `Produto Canario FASE 7.1 ${externalId}`,
    description: null as string | null,
    brand: "MarcaFase71",
    category: "TesteFase71",
    image: "https://exemplo.fase71.test/img.jpg",
    images: [] as string[],
    price,
    oldPrice: null as number | null,
    discount: null as number | null,
    installments: null as number | null,
    rating: null as number | null,
    reviews: null as number | null,
    sales: null as number | null,
    stock: null as number | null,
    seller: null as string | null,
    attributes: {} as Record<string, unknown>,
  };
}

async function save(
  marketplace: string,
  externalId: string,
  price: number,
  options: Record<string, unknown> = {},
) {
  /*
   * `autoCreated: true` é o fluxo REAL do canário (aquisição/Discovery). É
   * também o único fluxo sujeito ao gate de publicação multiloja: produto
   * manual (autoCreated=false) mantém o comportamento legado. Sem esta flag
   * os cenários de DRAFT não estariam provando nada.
   */
  const product = await saveProduct(
    listing(marketplace, externalId, price) as never,
    null,
    { discoverySource: "MANUAL", autoCreated: true, ...options } as never,
  );
  createdProductIds.push(product.id);
  return product;
}

async function resetControl(): Promise<void> {
  await admin.query(
    'TRUNCATE "CatalogCutoverEvent", "CatalogCutoverRollout" CASCADE',
  );
}

/*
 * Limpeza por NOME, não por id: uma execução abortada no meio deixa ids
 * órfãos, e o nome é o único marcador determinístico das fixtures deste
 * arquivo. Cada passo é isolado para que uma falha não impeça o resto.
 */
async function cleanCatalog(): Promise<void> {
  const step = async (label: string, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      console.error(`[E2E] limpeza ${label} falhou`, error);
    }
  };

  const sweep = async () => {
    const leftovers = await prisma.product.findMany({
      where: { name: { startsWith: "Produto Canario FASE 7.1" } },
      select: { id: true },
    });
    const ids = [
      ...new Set([...createdProductIds, ...leftovers.map((p) => p.id)]),
    ];
    createdProductIds.length = 0;
    if (ids.length === 0) {
      return;
    }
    await prisma.priceHistory.deleteMany({ where: { productId: { in: ids } } });
    await prisma.marketplaceOffer.deleteMany({ where: { productId: { in: ids } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
  };

  await step("catálogo", sweep);
}

const evidence: string[] = [];

async function main(): Promise<void> {
  await loadRuntime();
  await admin.connect();
  await resetControl();
  const base = await counts();

  /* ====================================================================== */
  /* E1) SEM ROLLOUT => LEGACY_ONLY, ZERO CONTABILIDADE                    */
  /* ====================================================================== */
  {
    const before = await counts();
    const product = await save("Mercado Livre", "FASE71-E1", 100);
    const after = await counts();

    assert.equal(after.products - before.products, 1, "produto persistido");
    assert.equal(after.offers - before.offers, 1, "oferta persistida");
    assert.equal(
      after.events,
      before.events,
      "sem rollout armado => ZERO evento de controle",
    );
    assert.equal(after.usedWrites, before.usedWrites, "ZERO consumo de orçamento");
    assert.equal(
      product.publicationStatus,
      "DRAFT",
      "1 marketplace => DRAFT (invariante de publicação, não do writer)",
    );
    assert.equal(product.active, false, "1 marketplace => active=false");
    evidence.push("E1 sem_rollout_um_write_zero_contabilidade ok");
  }

  /* ====================================================================== */
  /* E2) ROLLOUT ARMADO => 1 LISTAGEM REAL = 1 SLOT + MARCADOR              */
  /* ====================================================================== */
  let rolloutId = "";
  {
    const armed = await globalControl.armGlobalRollout(globalControl.globalControlPool(MISSION_URL)!, {
      marketplaceId: "mercado_livre",
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      enabled: true,
      legacyFallbackEnabled: true,
      maxWrites: 5,
      note: "FASE 7.1 e2e",
    });
    rolloutId = armed.id;
    assert.equal(armed.breakerState, "CLOSED", "rollout armado nasce CLOSED");
    assert.equal(armed.usedWrites, 0);

    const before = await counts();
    const product = await save("Mercado Livre", "FASE71-E2", 100);
    const after = await counts();

    assert.equal(
      after.usedWrites - before.usedWrites,
      1,
      "1 listagem real consome EXATAMENTE 1 slot do orçamento global",
    );
    const grants = await eventsOf("PERMIT_GRANTED");
    assert.equal(grants.length, 1, "1 concessão => 1 evento PERMIT_GRANTED");

    const commits = await eventsOf("V1_COMMITTED");
    assert.equal(commits.length, 1, "1 marcador V1_COMMITTED");
    assert.equal(
      commits[0].executionId,
      grants[0].executionId,
      "o marcador de commit pertence à MESMA execução que recebeu a permissão",
    );

    const offer = await prisma.marketplaceOffer.findFirstOrThrow({
      where: { productId: product.id },
    });
    assert.equal(offer.productId, product.id, "a oferta ficou no produto canônico");
    assert.equal(product.publicationStatus, "DRAFT");
    assert.equal(product.active, false);
    evidence.push(
      `E2 armando_um_slot_um_marcador executionId=${grants[0].executionId} ok`,
    );
  }

  /* ====================================================================== */
  /* E3) REPLAY => ZERO DUPLICATA NO CATÁLOGO                               */
  /* ====================================================================== */
  {
    const before = await counts();
    const replay = await save("Mercado Livre", "FASE71-E2", 100); // mesma listagem
    const after = await counts();

    assert.equal(
      after.products,
      before.products,
      "replay NÃO cria Product duplicado",
    );
    assert.equal(after.offers, before.offers, "replay NÃO cria Offer duplicada");
    assert.equal(
      after.history,
      before.history,
      "replay com o MESMO preço NÃO cria PriceHistory duplicada",
    );
    assert.equal(
      after.usedWrites - before.usedWrites,
      1,
      "o replay é um NOVO evento de escrita: consome seu próprio slot",
    );
    const commits = await eventsOf("V1_COMMITTED");
    assert.equal(commits.length, 2, "2 eventos, 2 marcadores, 1 produto");
    evidence.push(`E3 replay_um_produto_uma_oferta_um_historico productId=${replay.id} ok`);
  }

  /* ====================================================================== */
  /* E4) BYPASS INTERNO => ZERO I/O DE CONTROLE                            */
  /* ====================================================================== */
  {
    const before = await counts();
    const product = await save("Mercado Livre", "FASE71-E4", 100, {
      __internalSkipLiveCutoverGate: true,
    });
    const after = await counts();

    assert.equal(after.events, before.events, "bypass => ZERO evento de controle");
    assert.equal(
      after.usedWrites,
      before.usedWrites,
      "bypass => ZERO slot consumido (o replay/canário não gasta o teto live)",
    );
    assert.equal(after.products - before.products, 1, "o bypass ainda persiste");
    assert.equal(after.offers - before.offers, 1, "o bypass ainda persiste a oferta");
    assert.equal(product.publicationStatus, "DRAFT", "o bypass não força publicação");
    assert.equal(product.active, false, "o bypass não ativa o produto");
    evidence.push("E4 bypass_zero_evento_zero_slot_mesma_semantica ok");
  }

  /* ====================================================================== */
  /* E5) ORÇAMENTO ESGOTADO => SEGUE PELO LEGADO (NÃO É ERRO)               */
  /* ====================================================================== */
  {
    // Janela limpa com teto 1: a PRIMEIRA listagem é autoritativa, a segunda
    // já nasce com o orçamento esgotado. Sem ambiguidade sobre o que resta.
    const armed = await globalControl.armGlobalRollout(
      globalControl.globalControlPool(MISSION_URL)!,
      {
        marketplaceId: "mercado_livre",
        mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 1,
        resetBudget: true,
        closeBreaker: true,
        note: "FASE 7.1 e2e: teto 1",
      },
    );
    rolloutId = armed.id;

    const commitsBefore = (await eventsOf("V1_COMMITTED")).length;
    await save("Mercado Livre", "FASE71-E5-1", 100);
    const used = await globalControl.globalControlPool(MISSION_URL)!.query<{ used: number }>(
      'SELECT "usedWrites"::int AS "used" FROM "CatalogCutoverRollout" WHERE "id" = $1',
      [rolloutId],
    );
    assert.equal(used.rows[0].used, 1, "orçamento global NO BANCO = 1/1 (esgotado)");
    assert.equal(
      (await eventsOf("V1_COMMITTED")).length,
      commitsBefore + 1,
      "1 marcador V1_COMMITTED na 1ª listagem",
    );
    const commitsAfterFirst = (await eventsOf("V1_COMMITTED")).length;

    const before = await counts();
    const product = await save("Mercado Livre", "FASE71-E5-2", 100);
    const after = await counts();

    assert.equal(after.products - before.products, 1, "a listagem ainda é salva");
    assert.equal(after.offers - before.offers, 1, "a oferta ainda é salva");
    assert.equal(
      after.usedWrites,
      before.usedWrites,
      "orçamento esgotado NÃO avança o contador (esgotar não é violação)",
    );
    assert.equal(
      (await eventsOf("V1_COMMITTED")).length,
      commitsAfterFirst,
      "nenhum marcador novo: a 2ª listagem foi pelo legado",
    );
    assert.equal(
      (await globalControl.globalControlPool(MISSION_URL)!.query<{ s: string }>(
        'SELECT "breakerState"::text AS "s" FROM "CatalogCutoverRollout" WHERE "id" = $1',
        [rolloutId],
      )).rows[0].s,
      "CLOSED",
      "esgotar o orçamento NÃO abre o breaker",
    );
    assert.equal(product.publicationStatus, "DRAFT");
    evidence.push("E5 orcamento_esgotado_legado_sem_erro ok");
  }

  /* ====================================================================== */
  /* E6) BREAKER GLOBAL => FAIL-CLOSED SEM NOVO DEPLOY                     */
  /* ====================================================================== */
  {
    await globalControl.armGlobalRollout(globalControl.globalControlPool(MISSION_URL)!, {
      marketplaceId: "mercado_livre",
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      enabled: true,
      legacyFallbackEnabled: true,
      maxWrites: 100,
      resetBudget: true,
      closeBreaker: true,
      note: "FASE 7.1 e2e: breaker",
    });

    // Abre o breaker por "instância A" (outra conexão, como em produção).
    const outraInstancia = globalControl.globalControlPool(
      `${MISSION_URL}#instancia=A`,
    );
    assert.ok(outraInstancia, "segunda instância (conexão própria) obrigatória");
    const opened = await globalControl.tripGlobalBreaker(outraInstancia!, {
      rolloutId,
      marketplaceId: "mercado_livre",
      reason: "V1_ERRORS_ABOVE_LIMIT",
      executionId: "e2e-breaker",
    });
    assert.equal(opened, true, "a instância A abriu o breaker");

    const before = await counts();
    const commitsBefore = (await eventsOf("V1_COMMITTED")).length;
    const product = await save("Mercado Livre", "FASE71-E6", 100);
    const after = await counts();

    assert.equal(
      after.usedWrites,
      before.usedWrites,
      "breaker aberto => NENHUMA aquisição, mesmo com orçamento disponível",
    );
    assert.equal(after.products - before.products, 1, "a escrita segue pelo legado");
    assert.equal(
      (await eventsOf("V1_COMMITTED")).length,
      commitsBefore,
      "breaker aberto => nenhum marcador novo",
    );
    assert.equal(product.publicationStatus, "DRAFT");
    evidence.push("E6 breaker_global_fail_closed_sem_deploy ok");
  }

  /* ====================================================================== */
  /* E7) FALHA PRÉ-COMMIT TRANSITÓRIA => FALLBACK ASSUME (1 WRITE)          */
  /* ====================================================================== */
  {
    await resetControl();
    await globalControl.armGlobalRollout(globalControl.globalControlPool(MISSION_URL)!, {
      marketplaceId: "mercado_livre",
      mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      enabled: true,
      legacyFallbackEnabled: true,
      maxWrites: 10,
      note: "FASE 7.1 e2e: falha transitoria",
    });

    /*
     * Falha transória de UMA VEZ, no primeiro INSERT de Product: é a
     * materialização de "o banco falhou antes do commit" (serialization,
     * deadlock, blip de conexão). O SEQUENCE é a chave: `nextval` NÃO é
     * desfeito pelo ROLLBACK, então a tentativa V1 falha e a retentativa do
     * fallback passa — exatamente como na vida real.
     */
    await admin.query(`
      DROP TRIGGER IF EXISTS "fase71_precommit_fault" ON "Product";
      DROP SEQUENCE IF EXISTS fase71_fault_seq;
      CREATE SEQUENCE fase71_fault_seq;
      CREATE OR REPLACE FUNCTION fase71_precommit_fault() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        IF nextval('fase71_fault_seq') = 1 THEN
          RAISE EXCEPTION
            'FASE71 pre-commit transient fault: P1001 database is not accepting connections';
        END IF;
        RETURN NEW;
      END $fn$;
      CREATE TRIGGER "fase71_precommit_fault"
        BEFORE INSERT ON "Product"
        FOR EACH ROW EXECUTE FUNCTION fase71_precommit_fault();
    `);

    const before = await counts();
    const product = await save("Mercado Livre", "FASE71-E7", 100);
    const after = await counts();

    await admin.query(`
      DROP TRIGGER IF EXISTS "fase71_precommit_fault" ON "Product";
      DROP FUNCTION IF EXISTS fase71_precommit_fault();
      DROP SEQUENCE IF EXISTS fase71_fault_seq;
    `);

    assert.equal(after.products - before.products, 1, "o fallback persistiu 1 Product");
    assert.equal(after.offers - before.offers, 1, "o fallback persistiu 1 Offer");
    assert.equal(
      (await eventsOf("V1_COMMITTED")).length,
      0,
      "a tentativa V1 ROLLOU BACK: nenhum marcador V1_COMMITTED",
    );
    assert.equal(
      (await eventsOf("FALLBACK_ATTEMPTED")).length,
      1,
      "o fallback foi tentado",
    );
    assert.equal(
      (await eventsOf("FALLBACK_COMMITTED")).length,
      1,
      "o fallback COMMITOU (1 write, não 2)",
    );
    assert.equal(
      (await eventsOf("V1_FAILED")).length,
      1,
      "a falha V1 pré-commit foi registrada",
    );
    const failed = await eventsOf("V1_FAILED");
    assert.match(
      String(failed[0].reason ?? ""),
      /DB_TRANSIENT|UNEXPECTED_V1_FAILURE/,
      "falha pré-commit transitória => código elegível a fallback",
    );
    assert.equal(
      (await globalControl.globalControlPool(MISSION_URL)!.query<{ s: string }>(
        'SELECT "breakerState"::text AS "s" FROM "CatalogCutoverRollout"',
      )).rows[0].s,
      "CLOSED",
      "uma falha transitória isolada NÃO abre o breaker",
    );
    assert.equal(product.publicationStatus, "DRAFT");
    evidence.push("E7 falha_precommit_fallback_assumiu_um_write ok");
  }

  /* ====================================================================== */
  /* E8) MULTILOJA: 1 MARKETPLACE => DRAFT; 2 => PÚBLICO                    */
  /* ====================================================================== */
  {
    assert.equal(PUBLIC_MULTISTORE_MIN_MARKETPLACES, 2, "invariante do gate");

    const single = await prisma.product.findFirstOrThrow({
      where: { id: { in: createdProductIds } },
      orderBy: { createdAt: "desc" },
      select: { id: true, publicationStatus: true, active: true },
    });
    assert.equal(single.publicationStatus, "DRAFT", "1 marketplace => DRAFT");
    assert.equal(single.active, false, "1 marketplace => inativo");

    // Segunda oferta EXATA de OUTRO marketplace no MESMO produto.
    await prisma.marketplaceOffer.create({
      data: {
        productId: single.id,
        marketplace: "SHOPEE" as never,
        externalId: `FASE71-E8-${Date.now()}`,
        sourceUrl: "https://shopee.fase71.test/item",
        title: "Produto Canario FASE 7.1 E8",
        price: 90,
        oldPrice: null,
        available: true,
        active: true,
        status: "ACTIVE" as never,
        matchStatus: "EXACT" as never,
        isBest: false,
      } as never,
    });

    const after = await prisma.$transaction(async (tx) =>
      sincronizarMelhorOfertaDoProduto(tx, single.id),
    );

    assert.notEqual(
      after.publicationStatus,
      "DRAFT",
      "2 marketplaces distintos => sai de DRAFT",
    );
    assert.equal(after.active, true, "2 marketplaces distintos => público (active=true)");

    // Sem o gate, a volta ao caminho de 1 marketplace volta a DRAFT.
    await prisma.marketplaceOffer.deleteMany({
      where: { productId: single.id, marketplace: "SHOPEE" as never },
    });
    const back = await prisma.$transaction(async (tx) =>
      sincronizarMelhorOfertaDoProduto(tx, single.id),
    );
    assert.equal(back.publicationStatus, "DRAFT", "regressão => DRAFT de novo");
    assert.equal(back.active, false);
    evidence.push("E8 um_marketplace_draft_dois_publico ok");
  }

  /* ====================================================================== */
  /* E9) AGNOSTICISMO: qualquer marketplaceId se comporta igual              */
  /* ====================================================================== */
  {
    for (const [legacy, marketplaceId] of [
      ["Shopee", "shopee"],
      ["Magazine Luiza", "magazine_luiza"],
    ] as const) {
      await resetControl();
      await globalControl.armGlobalRollout(globalControl.globalControlPool(MISSION_URL)!, {
        marketplaceId,
        mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 5,
        note: "FASE 7.1 e2e: agnosticismo",
      });

      const before = await counts();
      await save(legacy, `FASE71-E9-${marketplaceId}`, 100);
      const after = await counts();

      assert.equal(
        after.usedWrites - before.usedWrites,
        1,
        `${marketplaceId}: 1 listagem => 1 slot`,
      );
      assert.equal(
        (await eventsOf("V1_COMMITTED")).length,
        1,
        `${marketplaceId}: marcador V1_COMMITTED gravado`,
      );
    }
    evidence.push("E9 agnosticismo_shopee_magazine_luiza ok");
  }

  /* ====================================================================== */
  /* LIMPEZA E EVIDÊNCIA                                                     */
  /* ====================================================================== */
  await cleanCatalog();
  await resetControl();
  const finalCounts = await counts();

  assert.deepEqual(
    {
      products: finalCounts.products,
      offers: finalCounts.offers,
      history: finalCounts.history,
      events: finalCounts.events,
      usedWrites: finalCounts.usedWrites,
    },
    {
      products: base.products,
      offers: base.offers,
      history: base.history,
      events: 0,
      usedWrites: 0,
    },
    "o teste devolve o banco ao estado inicial",
  );

  console.log("LIVE_CUTOVER_E2E_EVIDENCE");
  for (const line of evidence) {
    console.log(`  ${line}`);
  }
  console.log("LIVE_CUTOVER_E2E_TEST=PASS");
}

main()
  .then(async () => {
    await admin.end().catch(() => {});
    await globalControl.disconnectGlobalControlPools();
    await prisma.$disconnect().catch(() => {});
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await cleanCatalog().catch(() => {});
    await admin.end().catch(() => {});
    if (globalControl) {
      await globalControl.disconnectGlobalControlPools();
    }
    if (prisma) {
      await prisma.$disconnect().catch(() => {});
    }
    process.exit(1);
  });
