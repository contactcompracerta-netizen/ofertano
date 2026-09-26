/**
 * CATALOG_ARCHITECTURE_V1 — FASE 7.2: PROVAS DE BANCO DO AUTOPILOT.
 *
 * A máquina de estados pura está provada em `autopilot.test.ts`. Aqui está o
 * que só o PostgreSQL real pode provar, porque é exatamente o que a memória de
 * processo não garante em Vercel:
 *
 *   PARTE 0 — guardas estáticas: o autopilot não publica, não escreve catálogo
 *             e não tem cutover global.
 *   PARTE 1 — ORÇAMENTO ESGOTADO É SEGURO (regra crítica da missão): com
 *             maxWrites=1, o evento 1 é V1-autoritativo, o evento 2 é
 *             NEGADO — e mesmo assim processado corretamente, sem perda, sem
 *             erro, sem double-write e SEM estourar o orçamento.
 *   PARTE 2 — idempotência: o MESMO ciclo reexecutado não duplica nada.
 *   PARTE 3 — concorrência: N controllers simultâneos => exatamente UMA
 *             promoção (FASE S).
 *   PARTE 4 — a mesma corrida SEM o advisory lock: quem garante é o
 *             compare-and-swap de versão, não o lock.
 *   PARTE 5 — PAUSED não promove.
 *   PARTE 6 — violação crítica => TRIP: breaker aberto SEM deploy, estado
 *             TRIPPED, e nenhum fechamento automático.
 *   PARTE 7 — reconciliação: promoção interrompida no meio é consertada pelo
 *             ciclo seguinte, a partir do estado.
 *   PARTE 8 — a escada inteira 1 -> 5 -> 25 -> 100 -> COMPLETED só avança
 *             com evidência REAL injetada no ledger.
 *
 * Requer o banco de missão local. NÃO faz parte de `npm test`.
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55471/ofertano_fase71_global_control \
 *   DIRECT_URL=postgresql://postgres@127.0.0.1:55471/ofertano_fase71_global_control \
 *     npx tsx src/services/architecture/v1/cutover/autopilot.concurrency.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "pg";

import {
  applyOperatorAction,
  collectStageMetrics,
  readAutopilot,
  runAutopilotCycle,
  runAutopilotCycleLocked,
  type AutopilotState,
  type PublicationAudit,
  type ProbeResult,
} from "./autopilot";
import {
  acquireGlobalPermit,
  armGlobalRollout,
  disconnectGlobalControlPools,
  globalControlPool,
  readGlobalRollout,
  resetGlobalBreaker,
  type CutoverSqlExecutor,
} from "./globalControl";
import {
  beginLiveCutoverWrite,
  completeLiveCutoverWrite,
  runLiveCutoverWrite,
} from "./live";

const url = process.env.DATABASE_URL ?? "";

/* Tripwire: só o banco de missão desta fase. Nunca produção. */
const target = new URL(url);
if (
  target.hostname !== "127.0.0.1" ||
  Number(target.port) !== 55471 ||
  target.pathname !== "/ofertano_fase71_global_control"
) {
  throw new Error(
    `LOCAL_TRIPWIRE: banco de missão obrigatório (127.0.0.1:55471/ofertano_fase71_global_control), recebido ${url.replace(/:[^:@/]*@/, ":***@")}`,
  );
}

const MARKETPLACE = "mercado_livre";
const MODE = "V1_PRIMARY_WITH_LEGACY_FALLBACK";
const MIN_OBSERVATION_MS = 86_400_000;

const admin = new Client({ connectionString: url });
const evidence: string[] = [];

/** Executor independente = uma INSTÂNCIA serverless com seu próprio pool. */
function instanceExecutor(index: number): CutoverSqlExecutor {
  const pool = globalControlPool(`${url}#fase72=${String(index)}`);
  if (pool === null) {
    throw new Error("pool de instância indisponível");
  }
  return pool;
}

const GREEN_AUDIT: PublicationAudit = { scanned: 40, violations: 0 };

async function resetState(): Promise<void> {
  await admin.query(
    'TRUNCATE "CatalogCutoverEvent", "CatalogCutoverRollout", "CatalogCutoverAutopilot", "CatalogCutoverAutopilotRun", "CatalogCutoverStageMetric" CASCADE',
  );
}

async function countEvents(kind: string): Promise<number> {
  const res = await admin.query<{ total: number }>(
    'SELECT count(*)::int AS "total" FROM "CatalogCutoverEvent" WHERE "kind" = $1::"CatalogCutoverEventKind"',
    [kind],
  );
  return res.rows[0].total;
}

async function countRuns(marketplaceId: string): Promise<number> {
  const res = await admin.query<{ total: number }>(
    'SELECT count(*)::int AS "total" FROM "CatalogCutoverAutopilotRun" WHERE "marketplaceId" = $1',
    [marketplaceId],
  );
  return res.rows[0].total;
}

/**
 * Simula tráfego REAL: um permit GLOBAL consumido (o mesmo caminho do gate
 * live) e o marcador durável de commit do V1. Não é atalho de teste — é
 * exatamente o que `saveProduct` grava em produção quando o V1 é o writer
 * autoritativo daquele marketplaceId.
 */
async function simulateRealWrite(
  executor: CutoverSqlExecutor,
  externalListingId: string,
  options: { maxWrites: number; productId: string; seller: string; writePath: string },
): Promise<{ granted: boolean; executionId: string }> {
  const permit = await acquireGlobalPermit(executor, {
    marketplaceId: MARKETPLACE,
    externalListingId,
  });
  if (!permit.granted) {
    return { granted: false, executionId: `denied:${externalListingId}` };
  }

  await admin.query(
    `INSERT INTO "CatalogCutoverEvent"
       ("id", "rolloutId", "marketplaceId", "kind", "reason", "usedWrites",
        "maxWrites", "executionId", "externalListingId", "metadata", "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, 'V1_COMMITTED', 'COMMITTED', $3, $4, $5, $6, $7::jsonb, NOW())`,
    [
      permit.rollout.id,
      MARKETPLACE,
      permit.usedWrites,
      options.maxWrites,
      permit.executionId,
      externalListingId,
      JSON.stringify({
        commitPhase: "COMMITTED",
        marketplace: MARKETPLACE,
        writePath: options.writePath,
        productId: options.productId,
        offerId: `offer-${externalListingId}`,
        seller: options.seller,
        priceChanged: true,
      }),
    ],
  );
  return { granted: true, executionId: permit.executionId };
}

/** Tempo do controlador: depois do cooldown, para não depender de relógio. */
function afterCooldown(executor: CutoverSqlExecutor): Date {
  void executor;
  return new Date(Date.now() + MIN_OBSERVATION_MS + 60_000);
}

function noProbes(): () => Promise<ProbeResult[]> {
  return async () => [];
}

async function main(): Promise<void> {
  await admin.connect();

  try {
    /* ==================================================================== */
    /* PARTE 0 — GUARDAS ESTÁTICAS                                         */
    /* ==================================================================== */
    {
      const here = path.dirname(fileURLToPath(import.meta.url));
      const rawSource = readFileSync(path.join(here, "autopilot.ts"), "utf8");
      // Comentários explicam POR QUE o módulo é seguro; o que interessa aqui é
      // o CÓDIGO. Removemos comentários antes de procurar qualquer nome de
      // entidade de catálogo, senão a própria justificativa acusaria a si mesma.
      const source = rawSource
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");

      // Publicação é intocada: nenhuma entidade nem regra de publicação.
      for (const forbidden of [
        "MarketplaceOffer",
        "PriceHistory",
        "PublicationEligibility",
        "publicationStatus",
        "PUBLIC_MULTISTORE_MIN_MARKETPLACES",
        "evaluatePublicationEligibility",
      ]) {
        assert.ok(
          !source.includes(forbidden),
          `autopilot.ts não pode mencionar ${forbidden}`,
        );
      }
      // O controlador lê o catálogo SOMENTE através do reconciliador
      // injetado (dry-run) e do ledger do plano de controle.
      assert.ok(!/from\s+"\/lib\/prisma"/.test(source), "sem Prisma direto");
      assert.ok(!/from\s+"@prisma\/client"/.test(source), "sem Prisma types");
      // Cutover global continua NO.
      assert.ok(
        !/CATALOG_V1_GLOBAL_CUTOVER\s*=\s*"ON"/.test(source),
        "cutover global permanece NO",
      );
      // Nenhum loop residente: o módulo não tem laço de espera nem timer.
      assert.ok(
        !/setInterval|while\s*\(\s*true\s*\)/.test(source),
        "sem loop em memória",
      );
      // A transição é condicional: existe WHERE version = $2.
      assert.ok(/WHERE\s+"marketplaceId"\s*=\s*\$1\s*\n\s*AND\s+"version"\s*=\s*\$2/.test(source));
      evidence.push("P0a autopilot nao publica nem escreve catalogo (estatico)");
      evidence.push("P0b transicao de estado e compare-and-swap por versao");
      evidence.push("P0c sem loop residente e sem cutover global");

      /*
       * A ferramenta de operador tem de auditar publicação DE VERDADE. Houve
       * aqui um stub `{scanned: 0, violations: 0}`: o `autopilot-run --yes`
       * promovia degrau com o gate de publicação nunca sequer consultado. Verde
       * porque ninguém olhou é a pior forma de verde, e o conserto é invisível
       * numa revisão de rotina — então vira guarda.
       */
      const ctl = readFileSync(
        path.join(here, "..", "..", "..", "..", "..", "scripts", "live-cutover-control.ts"),
        "utf8",
      );
      // Comentários explicam a história do bug; o que interessa é o código.
      // Sem esta limpeza, a própria justificativa acusaria a si mesma.
      const ctlCode = ctl
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      assert.ok(
        ctlCode.includes("reconcileCatalog("),
        "o operador tem de chamar o reconciliador de verdade",
      );
      assert.ok(
        ctlCode.includes("createPrismaCatalogReconciliationRepository()"),
        "o operador tem de usar o repositorio real",
      );
      assert.ok(
        !/scanned:\s*0\s*,\s*violations:\s*0/.test(ctlCode),
        "proibido stub de auditoria de publicacao no operador",
      );
      assert.ok(
        ctlCode.includes("runAutopilotProbes("),
        "o operador usa a MESMA definicao de probes do cron",
      );
      assert.ok(
        !/const\s+PROBES\s*[:=]/.test(ctlCode),
        "proibido uma segunda lista de probes no operador",
      );
      evidence.push("P0d operador audita publicacao de verdade, sem stub");

      // A lista de probes mora no módulo, e só lá: duas definições divergentes
      // seriam duas fontes de verdade sobre a saúde do site.
      const route = readFileSync(
        path.join(here, "..", "..", "..", "..", "..", "src", "app", "api", "cron", "cutover-autopilot", "route.ts"),
        "utf8",
      );
      const routeCode = route
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      assert.ok(
        !/const\s+PROBES\s*[:=]/.test(routeCode),
        "a rota usa a lista do modulo, nao a sua propria",
      );
      assert.ok(routeCode.includes("runAutopilotProbes("));
      evidence.push("P0e cron e operador compartilham a definicao de probes");
    }

    /* ==================================================================== */
    /* PARTE 1 — ORÇAMENTO ESGOTADO É SEGURO (REGRA CRÍTICA)                */
    /* ==================================================================== */
    {
      await resetState();
      const executor = instanceExecutor(0);
      await armGlobalRollout(executor, {
        marketplaceId: MARKETPLACE,
        mode: MODE,
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 1,
        resetBudget: true,
        note: "FASE 7.2 P1: maxWrites=1",
      });

      /* --- Evento 1: orçamento disponível => V1 autoritativo. --------- */
      const w1 = simulateRealWrite(
        executor,
        "FASE72-EVENTO-1",
        {
          maxWrites: 1,
          productId: "produto-1",
          seller: "Vendedor A",
          writePath: "STRUCTURAL",
        },
      ).then((r) => r);
      const first = await w1;

      assert.equal(first.granted, true, "evento 1 deveria ser V1-autoritativo");
      const afterFirst = await readGlobalRollout(executor, MARKETPLACE);
      assert.equal(afterFirst?.usedWrites, 1);
      assert.equal(await countEvents("PERMIT_GRANTED"), 1);
      assert.equal(await countEvents("V1_COMMITTED"), 1);
      assert.equal(await countEvents("PERMIT_DENIED"), 0);
      evidence.push("P1a evento 1 com orcamento => V1 autoritativo (usedWrites 1)");

      /* --- Evento 2: orçamento ESGOTADO, mas processado do mesmo jeito. -- */
      // Caminho real: o MESMO saveProduct, com o MESMO gate live. Só muda
      // que não há mais permissão => rota segura LEGACY_ONLY.
      const w2 = simulateRealWrite(
        executor,
        "FASE72-EVENTO-2",
        {
          maxWrites: 1,
          productId: "produto-2",
          seller: "Vendedor B",
          writePath: "OFFER_ONLY",
        },
      ).then((r) => r);
      const second = await w2;
      assert.equal(second.granted, false, "evento 2 tem de ser negado por orçamento");

      // E o caminho de escrita real com o orçamento esgotado.
      const ctx = await beginLiveCutoverWrite({
        executor,
        marketplaceId: MARKETPLACE,
        externalListingId: "FASE72-EVENTO-3",
      });
      assert.equal(ctx.authoritative, false);
      assert.equal(ctx.denyReason, "BUDGET_EXHAUSTED");

      let canonicalWrites = 0;
      let fallbackWrites = 0;
      let commitBoundaryMarked = false;
      const outcome = await runLiveCutoverWrite<{ productId: string }>({
        ctx,
        executor,
        v1Write: async (mark) => {
          canonicalWrites += 1;
          mark();
          commitBoundaryMarked = true;
          return { productId: "produto-3" };
        },
        legacyWrite: async () => {
          fallbackWrites += 1;
          return { productId: "produto-3" };
        },
        onSuccess: async () => undefined,
        onFailure: async () => undefined,
      });
      await completeLiveCutoverWrite(ctx, {
        ok: outcome.failure === null,
        executor,
        commitPhase: "COMMITTED",
      });

      // ORÇAMENTO NÃO ESTOUROU — a parte que a missão exige literalmente.
      const afterExhaustion = await readGlobalRollout(executor, MARKETPLACE);
      assert.equal(afterExhaustion?.usedWrites, 1, "usedWrites DEVE continuar 1");
      assert.equal(afterExhaustion?.maxWrites, 1);
      assert.equal(afterExhaustion?.breakerState, "CLOSED", "exaustão não é violação");

      // NENHUMA escrita perdida: o evento 3 foi processado pela rota segura.
      assert.equal(outcome.kind, "LEGACY_ONLY", "a rota segura é LEGACY_ONLY");
      assert.equal(canonicalWrites, 1, "EXATAMENTE uma escrita canônica");
      assert.equal(fallbackWrites, 0, "o slot de fallback é só pós-falha do V1");
      assert.equal(
        commitBoundaryMarked,
        true,
        "a fronteira de commit foi marcada: o write aconteceu",
      );
      assert.equal(outcome.result.productId, "produto-3");
      assert.equal(outcome.failure, null, "sem perda, sem erro");
      assert.equal(await countEvents("DOUBLE_WRITE"), 0, "nenhum double-write");
      assert.equal(await countEvents("V1_COMMITTED"), 1, "o V1 não escreveu além do teto");
      assert.equal(await countEvents("PERMIT_DENIED"), 1, "a exaustão ficou registrada");
      assert.equal(await countEvents("TRIP"), 0, "exaustão não abre breaker");
      assert.equal(await countEvents("FALLBACK_COMMITTED"), 0, "sem commit V1 não há fallback");

      // A exaustão é OBSERVÁVEL (FASE K: budgetSkipped) sem virar erro.
      const metrics = await collectStageMetrics(executor, MARKETPLACE, 1);
      assert.equal(metrics.budgetSkipped, 1);
      assert.equal(metrics.v1Committed, 1);
      assert.equal(metrics.systemCriticalErrors, 0);
      evidence.push("P1b evento 2 com orcamento ESGOTADO: negado, processado, usedWrites=1");
      evidence.push("P1c nenhum double-write, nenhum trip, nenhuma perda");
      evidence.push("P1d exaustao registrada como budgetSkipped (observavel)");
    }

    /* ==================================================================== */
    /* PARTE 2 — IDEMPOTÊNCIA                                               */
    /* ==================================================================== */
    {
      await resetState();
      const executor = instanceExecutor(1);
      await armGlobalRollout(executor, {
        marketplaceId: MARKETPLACE,
        mode: MODE,
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 1,
        resetBudget: true,
        note: "FASE 7.2 P2",
      });
      await simulateRealWrite(executor, "FASE72-IDEM-1", {
        maxWrites: 1,
        productId: "p1",
        seller: "S1",
        writePath: "STRUCTURAL",
      });

      const now = afterCooldown(executor);

      // Passo 1: WAITING_1 -> VALIDATING_1
      const r1 = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now,
        executionId: "exec-idem-1",
      });
      assert.equal(r1.state, "VALIDATING_1");
      assert.equal(r1.promoted, false);

      // Passo 2: a promoção, com executionId FIXO.
      const r2 = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now,
        executionId: "exec-idem-2",
      });
      assert.equal(r2.state, "WAITING_5");
      assert.equal(r2.promoted, true);
      assert.equal(r2.rollout?.maxWrites, 5, "orçamento rearmado em 5");
      assert.equal(r2.rollout?.legacyFallbackEnabled, true, "fallback legado preservado");

      const afterPromo = await readAutopilot(executor, MARKETPLACE);
      const versionAfterPromo = afterPromo?.version ?? -1;
      const runsAfterPromo = await countRuns(MARKETPLACE);

      // Reexecutar o MESMO ciclo (retry de cron, double-trigger do Vercel).
      for (let i = 0; i < 3; i += 1) {
        const again = await runAutopilotCycle({
          executor,
          marketplaceId: MARKETPLACE,
          enabled: true,
          publicationAudit: async () => GREEN_AUDIT,
          probes: noProbes(),
          now,
          executionId: "exec-idem-2",
        });
        assert.equal(again.promoted, false, "reexecutar não promove de novo");
        assert.equal(again.lostRace, false);
      }
      assert.equal(
        await countRuns(MARKETPLACE),
        runsAfterPromo,
        "o MESMO executionId não cria linha nova",
      );

      // E ciclos NOVOS (executionId novo) no mesmo instante também não promovem:
      // o cooldown do estágio 5 recomeçou.
      for (let i = 0; i < 3; i += 1) {
        const fresh = await runAutopilotCycle({
          executor,
          marketplaceId: MARKETPLACE,
          enabled: true,
          publicationAudit: async () => GREEN_AUDIT,
          probes: noProbes(),
          now,
          executionId: `exec-idem-fresh-${String(i)}`,
        });
        assert.equal(fresh.promoted, false);
        assert.equal(fresh.state, "WAITING_5");
      }
      const afterFresh = await readAutopilot(executor, MARKETPLACE);
      assert.equal(afterFresh?.version, versionAfterPromo, "nenhuma transição nova");
      assert.equal(afterFresh?.state, "WAITING_5");
      const rolloutAfterFresh = await readGlobalRollout(executor, MARKETPLACE);
      assert.equal(rolloutAfterFresh?.maxWrites, 5);
      assert.equal(rolloutAfterFresh?.usedWrites, 0, "rearm não roda a cada ciclo");
      evidence.push("P2a mesmo executionId reexecutado => 1 linha, 0 promocoes");
      evidence.push("P2b ciclos novos no mesmo instante => nenhuma promocao extra");
      evidence.push("P2c versao do estado estavel => sem escrita inutil");
    }

    /* ==================================================================== */
    /* PARTE 3 — CONCORRÊNCIA: N CONTROLLERS => UMA PROMOÇÃO (FASE S)      */
    /* ==================================================================== */
    {
      await resetState();
      const setup = instanceExecutor(2);
      await armGlobalRollout(setup, {
        marketplaceId: MARKETPLACE,
        mode: MODE,
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 1,
        resetBudget: true,
        note: "FASE 7.2 P3",
      });
      await simulateRealWrite(setup, "FASE72-RACE-1", {
        maxWrites: 1,
        productId: "p1",
        seller: "S1",
        writePath: "STRUCTURAL",
      });
      // Coloca o estado em VALIDATING_1: a próxima decisão é a promoção.
      await runAutopilotCycle({
        executor: setup,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now: afterCooldown(setup),
        executionId: "exec-race-setup",
      });
      assert.equal((await readAutopilot(setup, MARKETPLACE))?.state, "VALIDATING_1");

      const now = afterCooldown(setup);
      const contenders = 8;
      const outcomes = await Promise.all(
        Array.from({ length: contenders }, (_, i) =>
          runAutopilotCycleLocked({
            executor: instanceExecutor(3 + i),
            marketplaceId: MARKETPLACE,
            enabled: true,
            publicationAudit: async () => GREEN_AUDIT,
            probes: noProbes(),
            now,
          }),
        ),
      );

      const promotions = outcomes.filter(
        (o) => !("skipped" in o) && o.promoted,
      );
      const skipped = outcomes.filter((o) => "skipped" in o);
      assert.equal(
        promotions.length,
        1,
        `exatamente 1 promoção, obtidas ${String(promotions.length)}`,
      );
      assert.equal(
        skipped.length,
        contenders - 1,
        "os demais foram barrados pelo advisory lock",
      );

      const promoted = await readAutopilot(setup, MARKETPLACE);
      assert.equal(promoted?.state, "WAITING_5", "UM degrau, nunca dois");
      assert.equal(promoted?.stage, 5);

      const armEvents5 = (
        await admin.query<{ total: number }>(
          'SELECT count(*)::int AS "total" FROM "CatalogCutoverEvent" WHERE "kind" = \'ARM\' AND "maxWrites" = 5',
        )
      ).rows[0].total;
      assert.equal(armEvents5, 1, "só um ARM do teto 5");
      evidence.push(`P3a ${String(contenders)} controllers simultaneos => 1 promocao`);
      evidence.push("P3b perdedores sao no-op explicito (advisory lock)");
      evidence.push("P3c estado final WAITING_5 / stage 5 e um unico ARM de teto 5");
    }

    /* ==================================================================== */
    /* PARTE 4 — SEM O LOCK, O CAS DECIDE                                   */
    /* ==================================================================== */
    {
      await resetState();
      const setup = instanceExecutor(12);
      await armGlobalRollout(setup, {
        marketplaceId: MARKETPLACE,
        mode: MODE,
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 1,
        resetBudget: true,
        note: "FASE 7.2 P4",
      });
      await simulateRealWrite(setup, "FASE72-CAS-1", {
        maxWrites: 1,
        productId: "p1",
        seller: "S1",
        writePath: "STRUCTURAL",
      });
      await runAutopilotCycle({
        executor: setup,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now: afterCooldown(setup),
        executionId: "exec-cas-setup",
      });

      // Sem advisory lock: 6 atores leem a MESMA versão e tentam promover.
      const now = afterCooldown(setup);
      const racers = 6;
      const results = await Promise.all(
        Array.from({ length: racers }, (_, i) =>
          runAutopilotCycle({
            executor: instanceExecutor(13 + i),
            marketplaceId: MARKETPLACE,
            enabled: true,
            publicationAudit: async () => GREEN_AUDIT,
            probes: noProbes(),
            now,
          }),
        ),
      );

      const promotedResults = results.filter((r) => r.promoted);
      const lost = results.filter((r) => r.lostRace);
      assert.equal(
        promotedResults.length,
        1,
        `1 promoção sem lock, obtidas ${String(promotedResults.length)}`,
      );
      assert.ok(
        lost.length > 0,
        "pelo menos um ator leu a mesma versão e perdeu o CAS de verdade",
      );
      /*
       * Os perdedores dividem-se em dois grupos, e ambos são corretos:
       *   - os que DECIDIRAM promover e perderam o CAS (é a corrida real);
       *   - os que leram DEPOIS da promoção, viram o cooldown do estágio novo
       *     e corretamente não decidem nada.
       * O invariante é: quem decidiu promover só pode ter promovido se o CAS
       * foi seu. Ninguém promote a partir de leitura velha.
       */
      for (const other of results.filter((r) => !r.promoted)) {
        if (other.decision.kind === "PROMOTE") {
          assert.equal(
            other.lostRace,
            true,
            "decidiu promover sem promover e sem perder a corrida",
          );
        }
        assert.ok(
          other.lostRace || other.state === "WAITING_5",
          `perdedor em estado inesperado ${other.state}/${String(other.decision.reason)}`,
        );
        assert.notEqual(other.stage, 25, "ninguém pula para 25");
      }
      const final = await readAutopilot(setup, MARKETPLACE);
      assert.equal(final?.state, "WAITING_5");
      assert.equal(final?.stage, 5, "1 -> 5, nunca 1 -> 25");
      evidence.push("P4a sem advisory lock, o compare-and-swap ainda promove 1 vez");
      evidence.push("P4b perdedores da corrida abortam sem promover (lostRace)");
    }

    /* ==================================================================== */
    /* PARTE 5 — PAUSED NÃO PROMOVE                                          */
    /* ==================================================================== */
    {
      await resetState();
      const executor = instanceExecutor(20);
      await armGlobalRollout(executor, {
        marketplaceId: MARKETPLACE,
        mode: MODE,
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 1,
        resetBudget: true,
        note: "FASE 7.2 P5",
      });
      await simulateRealWrite(executor, "FASE72-PAUSE-1", {
        maxWrites: 1,
        productId: "p1",
        seller: "S1",
        writePath: "STRUCTURAL",
      });
      const now = afterCooldown(executor);
      await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now,
        executionId: "exec-pause-setup",
      });

      await applyOperatorAction(executor, {
        marketplaceId: MARKETPLACE,
        action: "pause",
        reason: "FASE 7.2: prova",
        now,
      });
      assert.equal((await readAutopilot(executor, MARKETPLACE))?.state, "PAUSED");

      for (let i = 0; i < 5; i += 1) {
        const paused = await runAutopilotCycle({
          executor,
          marketplaceId: MARKETPLACE,
          enabled: true,
          publicationAudit: async () => GREEN_AUDIT,
          probes: noProbes(),
          now: new Date(now.getTime() + i * MIN_OBSERVATION_MS),
          executionId: `exec-pause-${String(i)}`,
        });
        assert.equal(paused.promoted, false, "PAUSED não promove");
        assert.equal(paused.state, "PAUSED");
        assert.equal(paused.decision.reason, "pausado-pelo-operador");
      }
      const rolloutPaused = await readGlobalRollout(executor, MARKETPLACE);
      assert.equal(rolloutPaused?.maxWrites, 1, "pausa não mexe no orçamento");
      evidence.push("P5a PAUSED bloqueia promocao em 5 ciclos consecutivos");
      evidence.push("P5b pausa nao altera o teto do rollout");

      // RESUME volta ao estado derivado do estágio e reinicia o cooldown.
      const resumed = await applyOperatorAction(executor, {
        marketplaceId: MARKETPLACE,
        action: "resume",
        now,
      });
      assert.equal(resumed.state, "WAITING_1");
      assert.ok(
        resumed.cooldownUntil.getTime() > now.getTime(),
        "resume reinicia o cooldown",
      );
      const afterResume = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now,
        executionId: "exec-resume-0",
      });
      assert.equal(afterResume.promoted, false, "logo após retomar, nada é promovido");
      evidence.push("P5c resume volta a WAITING_<estagio> com cooldown reiniciado");
    }

    /* ==================================================================== */
    /* PARTE 6 — VIOLAÇÃO CRÍTICA => TRIP (SEM DEPLOY, SEM AUTO-CLOSE)     */
    /* ==================================================================== */
    {
      await resetState();
      const executor = instanceExecutor(21);
      await armGlobalRollout(executor, {
        marketplaceId: MARKETPLACE,
        mode: MODE,
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 1,
        resetBudget: true,
        note: "FASE 7.2 P6",
      });
      await simulateRealWrite(executor, "FASE72-TRIP-1", {
        maxWrites: 1,
        productId: "p1",
        seller: "S1",
        writePath: "STRUCTURAL",
      });
      const now = afterCooldown(executor);
      await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now,
        executionId: "exec-trip-setup",
      });
      assert.equal((await readAutopilot(executor, MARKETPLACE))?.state, "VALIDATING_1");

      // Violação crítica: publicação com AUTO_ACTIVE_LT2 > 0.
      const tripped = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => ({ scanned: 40, violations: 2 }),
        probes: noProbes(),
        now,
        executionId: "exec-trip-1",
      });
      assert.equal(tripped.tripped, true);
      assert.equal(tripped.state, "TRIPPED");
      assert.equal(tripped.rollout?.breakerState, "OPEN", "breaker global aberto");
      const tripEvents = (
        await admin.query<{ reason: string | null }>(
          'SELECT "reason" FROM "CatalogCutoverEvent" WHERE "kind" = \'TRIP\' ORDER BY "createdAt" DESC LIMIT 1',
        )
      ).rows;
      assert.equal(tripEvents[0]?.reason, "PUBLICATION_VIOLATION");
      const row = await readAutopilot(executor, MARKETPLACE);
      assert.equal(row?.state, "TRIPPED");
      assert.equal(row?.tripReason, "PUBLICATION_VIOLATION");
      assert.ok(row?.trippedAt !== null, "timestamp do trip persistido");
      evidence.push("P6a violacao de publicacao => TRIP imediato com motivo persistido");
      evidence.push("P6a2 breaker aberto no MESMO banco (rollback sem deploy)");

      // Nenhum fechamento automático, nem com tudo verde depois.
      for (let i = 0; i < 3; i += 1) {
        const afterTrip = await runAutopilotCycle({
          executor,
          marketplaceId: MARKETPLACE,
          enabled: true,
          publicationAudit: async () => GREEN_AUDIT,
          probes: noProbes(),
          now: new Date(now.getTime() + (i + 1) * MIN_OBSERVATION_MS),
          executionId: `exec-trip-after-${String(i)}`,
        });
        assert.equal(afterTrip.state, "TRIPPED");
        assert.equal(afterTrip.promoted, false);
        assert.equal(afterTrip.rollout?.breakerState, "OPEN", "breaker segue aberto");
      }
      evidence.push("P6b trip nao se fecha sozinho, nem com gates verdes");

      // Fechar o breaker SOZINHO não basta: o estado TRIPPED é terminal por
      // decisão (FASE I) e o ciclo continua no-op. A recuperação completa é
      // do OPERADOR em dois passos, e ambos no MESMO banco, sem deploy.
      const closed = await resetGlobalBreaker(executor, {
        rolloutId: (await readGlobalRollout(executor, MARKETPLACE))?.id ?? "",
        marketplaceId: MARKETPLACE,
        note: "FASE 7.2: fechamento manual",
      });
      assert.equal(closed, true);
      assert.equal((await readGlobalRollout(executor, MARKETPLACE))?.breakerState, "CLOSED");
      const stillNoop = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now: new Date(now.getTime() + 4 * MIN_OBSERVATION_MS),
        executionId: "exec-trip-closed-only",
      });
      assert.equal(
        stillNoop.promoted,
        false,
        "breaker fechado, mas o estado TRIPPED não se recupera sozinho",
      );
      assert.equal(stillNoop.state, "TRIPPED");
      evidence.push("P6c fechar o breaker sozinho NAO recupera o estado TRIPPED");

      // Segundo passo do operador: `resume` devolve ao estado derivado do
      // estágio e REINICIA o cooldown — retomar não promove na mesma rajada.
      const resumeAt = new Date(now.getTime() + 4 * MIN_OBSERVATION_MS);
      const resumed = await applyOperatorAction(executor, {
        marketplaceId: MARKETPLACE,
        action: "resume",
        reason: "FASE 7.2: falha corrigida, retomando",
        now: resumeAt,
      });
      assert.equal(resumed.state, "WAITING_1");
      assert.equal(resumed.stage, 1);
      // O motivo e o instante do ÚLTIMO trip são rastro forense e sobrevivem
      // ao resume; quem governa o comportamento é `state`, que já saiu de
      // TRIPPED. Apagar a ocorrência seria perder a prova.
      assert.equal(resumed.tripReason, "PUBLICATION_VIOLATION", "rastro forense preservado");
      assert.ok(resumed.trippedAt !== null, "instante do trip preservado");

      const immediatelyAfterResume = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now: resumeAt,
        executionId: "exec-trip-resume-0",
      });
      assert.equal(immediatelyAfterResume.promoted, false, "cooldown reiniciado");
      assert.equal(immediatelyAfterResume.state, "WAITING_1");

      // Primeiro ciclo depois do cooldown: só inspeciona (VALIDATING_n).
      const afterCooldownCycle = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now: new Date(resumeAt.getTime() + MIN_OBSERVATION_MS + 60_000),
        executionId: "exec-trip-inspect",
      });
      assert.equal(afterCooldownCycle.state, "VALIDATING_1");
      assert.equal(afterCooldownCycle.promoted, false, "inspeciona antes de promover");

      const backToWork = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now: new Date(resumeAt.getTime() + MIN_OBSERVATION_MS + 60_000),
        executionId: "exec-trip-closed",
      });
      assert.equal(backToWork.promoted, true, "após close+resume o ciclo retoma");
      assert.equal(backToWork.state, "WAITING_5");
      assert.equal(backToWork.rollout?.breakerState, "CLOSED");
      evidence.push("P6d so o operador (close+resume) recupera; depois o autopilot retoma");
    }

    /* ==================================================================== */
    /* PARTE 7 — RECONCILIAÇÃO APÓS INTERRUPÇÃO                             */
    /* ==================================================================== */
    {
      await resetState();
      const executor = instanceExecutor(22);
      await armGlobalRollout(executor, {
        marketplaceId: MARKETPLACE,
        mode: MODE,
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 1,
        resetBudget: true,
        note: "FASE 7.2 P7",
      });
      await simulateRealWrite(executor, "FASE72-RECON-1", {
        maxWrites: 1,
        productId: "p1",
        seller: "S1",
        writePath: "STRUCTURAL",
      });
      const now = afterCooldown(executor);
      await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now,
        executionId: "exec-recon-setup",
      });

      /*
       * Simula a morte do processo ENTRE a decisão (CAS) e o efeito (rearm):
       * o estado já diz estágio 5, o rollout ainda está em 1.
       */
      const promoted = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now,
        executionId: "exec-recon-promo",
      });
      assert.equal(promoted.promoted, true);
      // Desfaz só o efeito, mantendo o estado: é a janela de falha.
      await admin.query(
        'UPDATE "CatalogCutoverRollout" SET "maxWrites" = 1, "usedWrites" = 1 WHERE "marketplaceId" = $1',
        [MARKETPLACE],
      );
      assert.equal((await readGlobalRollout(executor, MARKETPLACE))?.maxWrites, 1);

      // O ciclo seguinte conserta: o ESTADO manda.
      const fixed = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now,
        executionId: "exec-recon-fix",
      });
      assert.equal(fixed.budgetReconciled, true, "o ciclo reconcilia o teto");
      const afterFix = await readGlobalRollout(executor, MARKETPLACE);
      assert.equal(afterFix?.maxWrites, 5, "teto reconciliado para o estágio persistido");
      assert.equal(afterFix?.usedWrites, 0, "e o contador do estágio começa zerado");
      assert.equal(afterFix?.legacyFallbackEnabled, true, "fallback legado preservado");
      evidence.push("P7a estado e teto divergentes => o ciclo reconcilia pelo estado");
    }

    /* ==================================================================== */
    /* PARTE 8 — A ESCADA INTEIRA, SÓ COM EVIDÊNCIA REAL                    */
    /* ==================================================================== */
    {
      await resetState();
      const executor = instanceExecutor(23);
      await armGlobalRollout(executor, {
        marketplaceId: MARKETPLACE,
        mode: MODE,
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 1,
        resetBudget: true,
        note: "FASE 7.2 P8",
      });
      await simulateRealWrite(executor, "FASE72-LADDER-1", {
        maxWrites: 1,
        productId: "produto-l1",
        seller: "Vendedor L1",
        writePath: "STRUCTURAL",
      });

      const observed: string[] = [];
      let now = afterCooldown(executor);
      let state: AutopilotState = "WAITING_1";
      let stage = 1;

      /*
       * Relógio do controlador: a cada tick passam 2h. Com cooldown de 24h
       * são 12 ticks para cumpri-lo, mais 1 para inspecionar e 1 para promover:
       * ~14 ticks por degrau, 4 degraus. O teto de 120 ticks é folga; se a
       * máquina parar de avançar, a asserção final acusa em vez de "passar"
       * por acidente.
       */
      for (let tick = 0; tick < 120 && state !== "COMPLETED"; tick += 1) {
        // Tráfego real: a cada janela chegam escritas orgânicas.
        now = new Date(now.getTime() + 2 * 60 * 60 * 1000);
        const before = await readGlobalRollout(executor, MARKETPLACE);
        const remaining =
          before === null ? 0 : before.maxWrites - before.usedWrites;
        for (let i = 0; i < Math.min(remaining, 6); i += 1) {
          await simulateRealWrite(
            executor,
            `FASE72-LADDER-${String(stage)}-${String(i)}`,
            {
              maxWrites: stage,
              productId: `produto-${String(stage)}-${String(i)}`,
              seller: `Vendedor ${String(stage)}${String(i)}`,
              writePath: "OFFER_ONLY",
            },
          );
        }

        const cycle = await runAutopilotCycle({
          executor,
          marketplaceId: MARKETPLACE,
          enabled: true,
          publicationAudit: async () => GREEN_AUDIT,
          probes: noProbes(),
          now,
          executionId: `exec-ladder-${String(tick)}`,
        });
        if (
          cycle.state !== state ||
          cycle.stage !== stage ||
          cycle.promoted
        ) {
          observed.push(
            `${state}/${String(stage)} -> ${cycle.state}/${String(cycle.stage)} (${cycle.decision.kind})`,
          );
        }
        state = cycle.state;
        stage = cycle.stage;
      }

      assert.equal(state, "COMPLETED", observed.join(" | "));
      assert.equal(stage, 100);
      const finalRollout = await readGlobalRollout(executor, MARKETPLACE);
      assert.equal(finalRollout?.maxWrites, 100, "teto final é 100");
      assert.equal(finalRollout?.mode, MODE, "modo com fallback legado preservado");
      assert.equal(finalRollout?.legacyFallbackEnabled, true);
      assert.equal(finalRollout?.breakerState, "CLOSED");
      assert.ok(
        observed.some((o) => o.includes("PROMOTE")),
        observed.join(" | "),
      );
      // A escada tem 4 degraus: 4 promoções, nenhuma pulada.
      const promotions = observed.filter((o) => o.includes("PROMOTE"));
      assert.equal(promotions.length, 4, promotions.join(" | "));
      assert.ok(
        !observed.some((o) => o.startsWith("WAITING_1/1 -> WAITING_25")),
        "nunca pulou de 1 para 25",
      );
      evidence.push("P8a escada 1->5->25->100->COMPLETED com 4 promocoes exatas");
      evidence.push("P8b nenhuma promocao pulou degrau");

      // Métricas por estágio persistidas e sem divergência.
      const persisted = await admin.query<{ stage: number }>(
        'SELECT "stage" FROM "CatalogCutoverStageMetric" WHERE "marketplaceId" = $1 ORDER BY "stage"',
        [MARKETPLACE],
      );
      assert.deepEqual(
        persisted.rows.map((r) => r.stage),
        [1, 5, 25, 100],
        "métricas de todos os estágios persistidas",
      );
      evidence.push("P8c metricas por estagio persistidas para 1,5,25,100");
    }

    /* ==================================================================== */
    /* PARTE 9 — AUTOPILOT DESLIGADO NÃO MUDA NADA                         */
    /* ==================================================================== */
    {
      await resetState();
      const executor = instanceExecutor(24);
      await armGlobalRollout(executor, {
        marketplaceId: MARKETPLACE,
        mode: MODE,
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 1,
        resetBudget: true,
        note: "FASE 7.2 P9",
      });
      await simulateRealWrite(executor, "FASE72-OFF-1", {
        maxWrites: 1,
        productId: "p1",
        seller: "S1",
        writePath: "STRUCTURAL",
      });
      const now = afterCooldown(executor);
      const off = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: false,
        allowMutations: false,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now,
        executionId: "exec-off-1",
      });
      assert.equal(off.promoted, false);
      assert.equal(off.tripped, false);
      assert.equal(off.state, "WAITING_1");
      assert.equal(off.skippedReason, "autopilot-desabilitado");
      const rolloutOff = await readGlobalRollout(executor, MARKETPLACE);
      assert.equal(rolloutOff?.maxWrites, 1, "desligado não rearmou nada");
      assert.equal(rolloutOff?.usedWrites, 1, "não gastou nem restore o orçamento");
      assert.equal(rolloutOff?.breakerState, "CLOSED");
      assert.equal(await countRuns(MARKETPLACE), 1, "mas registra a avaliação");
      evidence.push("P9a autopilot desligado avalia, registra e NAO muta nada");

      // Dry-run com o autopilot LIGADO: avalia, mostra o que faria, não muta.
      const dry = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        allowMutations: false,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now,
        executionId: "exec-dry-1",
      });
      assert.equal(dry.promoted, false);
      assert.equal(dry.tripped, false);
      assert.equal(dry.skippedReason, "somente-leitura");
      const rolloutDry = await readGlobalRollout(executor, MARKETPLACE);
      assert.equal(rolloutDry?.maxWrites, 1, "dry-run não rearma o teto");
      assert.equal(rolloutDry?.usedWrites, 1, "dry-run não consome o orçamento");
      assert.equal(rolloutDry?.breakerState, "CLOSED");
      evidence.push("P9b dry-run avalia e mostra a decisao sem tocar em nada");

      // E o dry-run também não TRIPa: um relatório não pode ter efeito colateral.
      const dryTrip = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        allowMutations: false,
        publicationAudit: async () => ({ scanned: 40, violations: 3 }),
        probes: noProbes(),
        now,
        executionId: "exec-dry-2",
      });
      assert.equal(dryTrip.tripped, false, "dry-run não abre breaker");
      assert.equal(dryTrip.skippedReason, "somente-leitura");
      assert.equal(
        (await readGlobalRollout(executor, MARKETPLACE))?.breakerState,
        "CLOSED",
        "breaker intocado pelo dry-run",
      );
      evidence.push("P9c dry-run com violacao NAO abre o breaker");
    }

    /* ==================================================================== */
    /* PARTE 10 — OS DOIS INTERRUPTORES SÃO INDEPENDENTES                    */
    /* ==================================================================== */
    /*
     * A missão manda IMPLEMENTAR com AUTOPILOT_ENABLED=OFF e só depois ligar.
     * Se o switch do ambiente fosse gravado na coluna `enabled`, essa primeira
     * execução deixaria o autopilot morto para sempre depois do ON — e a
     * progressão pararia sem erro nenhum. Aqui está a prova de que o deploy
     * inicial não cria essa armadilha.
     */
    {
      await resetState();
      const executor = instanceExecutor(25);
      await armGlobalRollout(executor, {
        marketplaceId: MARKETPLACE,
        mode: MODE,
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 1,
        resetBudget: true,
        note: "FASE 7.2 P10",
      });
      await simulateRealWrite(executor, "FASE72-SWITCH-1", {
        maxWrites: 1,
        productId: "p1",
        seller: "S1",
        writePath: "STRUCTURAL",
      });
      const now = afterCooldown(executor);

      // Passo 1 do deploy: OFF. Cria a linha e avalia sem mutar nada.
      const offDeploy = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: false,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now,
        executionId: "exec-switch-off",
      });
      assert.equal(offDeploy.skippedReason, "autopilot-desabilitado");
      assert.equal(offDeploy.promoted, false);
      const created = await readAutopilot(executor, MARKETPLACE);
      assert.ok(created !== null, "a linha existe mesmo com o deploy em OFF");
      assert.equal(
        created?.enabled,
        true,
        "OFF do ambiente NÃO grava enabled=false na linha",
      );

      // Passo 2 do deploy: ON. Sem nenhuma ação de operador, passa a valer.
      const onDeploy = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now,
        executionId: "exec-switch-on-0",
      });
      assert.equal(onDeploy.state, "VALIDATING_1", "ON assume de onde parou");
      const promoted = await runAutopilotCycle({
        executor,
        marketplaceId: MARKETPLACE,
        enabled: true,
        publicationAudit: async () => GREEN_AUDIT,
        probes: noProbes(),
        now,
        executionId: "exec-switch-on-1",
      });
      assert.equal(promoted.promoted, true, "OFF -> ON sem ação de operador");
      assert.equal(promoted.state, "WAITING_5");
      evidence.push("P10a deploy OFF->ON nao trava o autopilot (armadilha do switch)");

      // E o inverso: `disable` do OPERADOR é durável e sobrevive ao ambiente.
      await applyOperatorAction(executor, {
        marketplaceId: MARKETPLACE,
        action: "disable",
        reason: "FASE 7.2: parada manual",
        now,
      });
      assert.equal((await readAutopilot(executor, MARKETPLACE))?.enabled, false);
      for (let i = 0; i < 3; i += 1) {
        const envOnButOperatorOff = await runAutopilotCycle({
          executor,
          marketplaceId: MARKETPLACE,
          enabled: true,
          publicationAudit: async () => GREEN_AUDIT,
          probes: noProbes(),
          now: new Date(now.getTime() + (i + 1) * MIN_OBSERVATION_MS),
          executionId: `exec-switch-operator-off-${String(i)}`,
        });
        assert.equal(
          envOnButOperatorOff.skippedReason,
          "autopilot-desabilitado",
          "ENV ligado não vence o interruptor do operador",
        );
        assert.equal(envOnButOperatorOff.promoted, false);
      }
      assert.equal(
        (await readGlobalRollout(executor, MARKETPLACE))?.maxWrites,
        5,
        "nada foi rearmado enquanto o operador mantém a parada",
      );
      evidence.push("P10b disable do operador e duravel e vence o ENV ligado");

      await applyOperatorAction(executor, {
        marketplaceId: MARKETPLACE,
        action: "enable",
        now,
      });
      assert.equal((await readAutopilot(executor, MARKETPLACE))?.enabled, true);
      evidence.push("P10c enable do operador restaura a coluna");
    }

    console.log("");
    console.log("=== CATALOG_V1 AUTOPILOT — PROVAS DE BANCO (FASE 7.2) ===");
    for (const item of evidence) {
      console.log(`  ok  ${item}`);
    }
    console.log(`AUTOPILOT_CONCURRENCY=PASS`);
    console.log(`AUTOPILOT_IDEMPOTENT=PASS`);
    console.log(`BUDGET_EXHAUSTION_SAFE=PASS`);
    console.log(`AUTO_PROMOTION_1_TO_5/5_TO_25/25_TO_100=READY`);
    console.log(`AUTO_BREAKER=PASS`);
    console.log(`ROLLBACK_NO_DEPLOY=PASS`);
    console.log(`PUBLICATION_GATE_PRESERVED=PASS`);
  } finally {
    await admin.end();
    await disconnectGlobalControlPools();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
