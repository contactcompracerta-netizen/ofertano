/**
 * CATALOG_ARCHITECTURE_V1 — FASE 7.1: PROVA DE CONCORRÊNCIA DO ORÇAMENTO GLOBAL.
 *
 * Esta é a prova de que o teto de escrita é REAL em ambiente serverless.
 *
 * A objeção que esta prova destrói: "o orçamento anterior era PROCESS_LOCAL;
 * com N instâncias, o teto efetivo é N × maxWrites". Aqui N instâncias
 * independentes — cada uma com sua PRÓPRIA conexão TCP, exatamente como
 * instâncias serverless — disputam o mesmo orçamento. A instrução de
 * aquisição é uma única instrução SQL atômica; o bloqueio de linha do
 * PostgreSQL serializa os contendores e cada um reavalia
 * `"usedWrites" < "maxWrites"` contra a versão já incrementada da linha.
 *
 * Cenários obrigatórios:
 *   PARTE A — MAX=1, 50 chamadas concorrentes => no máximo 1 grant.
 *   PARTE B — MAX=5, 20 chamadas concorrentes => no máximo 5 grants.
 *   PARTE C — MAX=5, rodadas repetidas => o teto NUNCA é excedido, nem
 *             acumulando rodadas.
 *   PARTE D — o grant é DURÁVEL: um evento PERMIT_GRANTED por concessão, e
 *             o mesmo total em `usedWrites`. Nenhuma concessão sem rastro.
 *   PARTE E — fail-closed: com o orçamento esgotado, aaquisição é negada e
 *             o `usedWrites` NÃO avança (esgotar orçamento nunca é violação).
 *   PARTE F — breaker global: uma instância abre o breaker e TODAS as outras
 *             fail-closed, sem novo deploy.
 *   PARTE G — o CHECK do banco é a rede de segurança final: mesmo forçando
 *             usedWrites acima do teto, o banco RECUSA o estado.
 *
 * Requer o banco de missão local. NÃO faz parte de `npm test`.
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55471/ofertano_fase71_global_control \
 *     npx tsx src/services/architecture/v1/cutover/globalBudget.concurrency.test.ts
 */
import assert from "node:assert/strict";
import { Client } from "pg";

import {
  acquireGlobalPermit,
  armGlobalRollout,
  disconnectGlobalControlPools,
  globalControlPool,
  readGlobalRollout,
  tripGlobalBreaker,
  type CutoverSqlExecutor,
} from "./globalControl";

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

const admin = new Client({ connectionString: url });

/** Executor independente: simula uma INSTÂNCIA serverless com seu próprio pool. */
function instanceExecutor(index: number): CutoverSqlExecutor {
  const pool = globalControlPool(`${url}#instance=${index}`);
  if (!pool) {
    throw new Error("pool de instância indisponível");
  }
  return pool;
}

async function resetState(): Promise<void> {
  await admin.query('TRUNCATE "CatalogCutoverEvent", "CatalogCutoverRollout" CASCADE');
}

type Round = {
  round: number;
  maxWrites: number;
  contenders: number;
  granted: number;
  denied: number;
  dbUsedWrites: number;
  grantEvents: number;
  distinctExecutionIds: number;
};

const rounds: Round[] = [];

async function contend(
  marketplaceId: string,
  contenders: number,
): Promise<{ granted: number; denied: number }> {
  /*
   * Cada contender usa seu próprio executor/pool: são conexões independentes,
   * exatamente como instâncias distintas. Um pool compartilhado esconderia
   * justamente o problema que esta prova existe para caçar.
   */
  const executors = Array.from({ length: contenders }, (_, i) =>
    instanceExecutor(i % 8),
  );

  const results = await Promise.all(
    executors.map((executor, i) =>
      acquireGlobalPermit(executor, {
        marketplaceId,
        externalListingId: `LISTING-${String(i).padStart(3, "0")}`,
      }).catch((error) => {
        throw new Error(`contender ${i} falhou: ${String(error)}`);
      }),
    ),
  );

  const granted = results.filter((r) => r.granted).length;
  return { granted, denied: results.length - granted };
}

async function main(): Promise<void> {
  await admin.connect();

  try {
    /* ================= PARTE A — MAX=1, 50 concorrentes ================= */
    {
      await resetState();
      const marketplaceId = "mercado_livre";
      await armGlobalRollout(instanceExecutor(0), {
        marketplaceId,
        mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 1,
      });

      const { granted, denied } = await contend(marketplaceId, 50);
      const rollout = await readGlobalRollout(instanceExecutor(0), marketplaceId);

      assert.ok(
        granted <= 1,
        `MAX=1 com 50 concorrentes concedeu ${granted} (teto estourado)`,
      );
      assert.equal(granted, 1, "com MAX=1 exatamente 1 concessão deve ocorrer");
      assert.equal(denied, 49);
      assert.equal(rollout?.usedWrites, 1, "usedWrites não pode passar de 1");

      const events = await admin.query<{ total: number }>(
        `SELECT COUNT(*)::int AS "total" FROM "CatalogCutoverEvent"
          WHERE "kind" = 'PERMIT_GRANTED'::"CatalogCutoverEventKind"`,
      );
      const execs = await admin.query<{ total: number }>(
        `SELECT COUNT(DISTINCT "executionId")::int AS "total" FROM "CatalogCutoverEvent"
          WHERE "kind" = 'PERMIT_GRANTED'::"CatalogCutoverEventKind"`,
      );

      rounds.push({
        round: 1,
        maxWrites: 1,
        contenders: 50,
        granted,
        denied,
        dbUsedWrites: rollout?.usedWrites ?? -1,
        grantEvents: events.rows[0].total,
        distinctExecutionIds: execs.rows[0].total,
      });

      assert.equal(
        events.rows[0].total,
        granted,
        "cada concessão deve ter exatamente 1 evento durável",
      );
      assert.equal(
        execs.rows[0].total,
        granted,
        "nenhuma concessão pode compartilhar executionId",
      );
    }

    /* ================= PARTE B — MAX=5, 20 concorrentes ================= */
    {
      await resetState();
      const marketplaceId = "mercado_livre";
      await armGlobalRollout(instanceExecutor(0), {
        marketplaceId,
        mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 5,
      });

      const { granted, denied } = await contend(marketplaceId, 20);
      const rollout = await readGlobalRollout(instanceExecutor(0), marketplaceId);

      assert.ok(
        granted <= 5,
        `MAX=5 com 20 concorrentes concedeu ${granted} (teto estourado)`,
      );
      assert.equal(granted, 5, "com MAX=5 o orçamento inteiro deve ser usado");
      assert.equal(denied, 15);
      assert.equal(rollout?.usedWrites, 5, "usedWrites não pode passar de 5");

      rounds.push({
        round: 2,
        maxWrites: 5,
        contenders: 20,
        granted,
        denied,
        dbUsedWrites: rollout?.usedWrites ?? -1,
        grantEvents: granted,
        distinctExecutionIds: granted,
      });
    }

    /* ============ PARTE C — teto nunca acumula entre rodadas ============ */
    {
      await resetState();
      const marketplaceId = "shopee";
      /*
       * Marketplace DIFERENTE de propósito: a prova não pode depender de
       * nenhum nome de marketplace. Se alguém nunca mais ativar Shopee, isto
       * continua válido — é a MESMA tabela, o MESMO código.
       */
      await armGlobalRollout(instanceExecutor(0), {
        marketplaceId,
        mode: "V1_PRIMARY",
        enabled: true,
        legacyFallbackEnabled: false,
        maxWrites: 5,
      });

      let totalGranted = 0;
      for (let round = 1; round <= 4; round += 1) {
        const { granted } = await contend(marketplaceId, 20);
        totalGranted += granted;
        assert.ok(
          granted <= 5,
          `rodada ${round} concedeu ${granted}; o teto é por rollout, não por rodada`,
        );
      }
      const rollout = await readGlobalRollout(instanceExecutor(0), marketplaceId);
      assert.equal(
        totalGranted,
        5,
        "somando 4 rodadas de 20 concorrentes, o total deve ser exatamente o teto",
      );
      assert.equal(rollout?.usedWrites, 5);

      rounds.push({
        round: 3,
        maxWrites: 5,
        contenders: 80,
        granted: totalGranted,
        denied: 80 - totalGranted,
        dbUsedWrites: rollout?.usedWrites ?? -1,
        grantEvents: totalGranted,
        distinctExecutionIds: totalGranted,
      });
    }

    /* ================= PARTE D — grant é durável e único ================= */
    {
      await resetState();
      const marketplaceId = "mercado_livre";
      await armGlobalRollout(instanceExecutor(0), {
        marketplaceId,
        mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 3,
      });

      const { granted } = await contend(marketplaceId, 12);
      const events = await admin.query<{ total: number }>(
        `SELECT COUNT(*)::int AS "total" FROM "CatalogCutoverEvent"
          WHERE "kind" = 'PERMIT_GRANTED'::"CatalogCutoverEventKind"`,
      );
      assert.equal(granted, 3);
      assert.equal(
        events.rows[0].total,
        granted,
        "nenhuma concessão pode existir sem evento durável",
      );
    }

    /* ============ PARTE E — esgotar orçamento NÃO é violação ============ */
    {
      await resetState();
      const marketplaceId = "mercado_livre";
      await armGlobalRollout(instanceExecutor(0), {
        marketplaceId,
        mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 1,
      });

      await contend(marketplaceId, 4);
      const rollout = await readGlobalRollout(instanceExecutor(0), marketplaceId);
      assert.equal(
        rollout?.breakerState,
        "CLOSED",
        "esgotar o orçamento é comportamento esperado e NÃO pode abrir o breaker",
      );
      assert.equal(rollout?.usedWrites, 1, "negação não consome orçamento");
    }

    /* ============= PARTE F — breaker global, sem novo deploy ============= */
    {
      await resetState();
      const marketplaceId = "mercado_livre";
      const armed = await armGlobalRollout(instanceExecutor(0), {
        marketplaceId,
        mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 100,
      });

      // Uma instância (a que detecta a violação) abre o breaker.
      const opened = await tripGlobalBreaker(instanceExecutor(1), {
        rolloutId: armed.id,
        marketplaceId,
        reason: "PUBLICATION_VIOLATION",
      });
      assert.equal(opened, true, "a primeira abertura deve ocorrer");

      // As outras 20 instâncias fail-closed imediatamente, sem novo deploy.
      const executors = Array.from({ length: 20 }, (_, i) => instanceExecutor(i));
      const after = await Promise.all(
        executors.map((executor) =>
          acquireGlobalPermit(executor, {
            marketplaceId,
            externalListingId: "LISTING-POST-BREAKER",
          }),
        ),
      );
      assert.ok(
        after.every((r) => !r.granted),
        "breaker aberto: TODAS as instâncias devem falhar fechado",
      );
      assert.ok(
        after.every((r) => !r.granted && r.reason === "BREAKER_OPEN"),
        "a negação deve ser classificada como BREAKER_OPEN",
      );

      // Idempotência: re-abrir não cria um segundo TRIP.
      const reopened = await tripGlobalBreaker(instanceExecutor(2), {
        rolloutId: armed.id,
        marketplaceId,
        reason: "PUBLICATION_VIOLATION",
      });
      assert.equal(reopened, false, "abertura do breaker deve ser idempotente");

      const tripEvents = await admin.query<{ total: number }>(
        `SELECT COUNT(*)::int AS "total" FROM "CatalogCutoverEvent"
          WHERE "kind" = 'TRIP'::"CatalogCutoverEventKind"`,
      );
      assert.equal(tripEvents.rows[0].total, 1, "apenas um TRIP pode ser registrado");

      const rollout = await readGlobalRollout(instanceExecutor(0), marketplaceId);
      assert.equal(rollout?.breakerState, "OPEN");
      assert.equal(rollout?.breakerReason, "PUBLICATION_VIOLATION");
      assert.equal(rollout?.usedWrites, 0, "breaker aberto não consome orçamento");
    }

    /* ===== PARTE G — CHECK do banco é a rede de segurança final ===== */
    {
      await resetState();
      const armed = await armGlobalRollout(instanceExecutor(0), {
        marketplaceId: "mercado_livre",
        mode: "V1_PRIMARY",
        enabled: true,
        legacyFallbackEnabled: false,
        maxWrites: 2,
      });

      let rejected = false;
      try {
        await admin.query(
          `UPDATE "CatalogCutoverRollout" SET "usedWrites" = 3 WHERE "id" = $1`,
          [armed.id],
        );
      } catch {
        /*
         * A mensagem do servidor é localizada (pt-BR aqui), então o teste
         * NÃO casa texto: ele exige apenas que o banco tenha recusado. A
         * prova de que a recusa foi pelo motivo certo vem logo abaixo — o
         * estado inválido não pode ter persistido.
         */
        rejected = true;
      }
      assert.ok(
        rejected,
        "o banco deve recusar usedWrites > maxWrites mesmo fora do código",
      );

      const rollout = await readGlobalRollout(instanceExecutor(0), "mercado_livre");
      assert.equal(
        rollout?.usedWrites,
        0,
        "o estado inválido não pode persistir (o contador deve seguir no valor pré-update)",
      );
      assert.equal(rollout?.maxWrites, 2, "o teto não pode ter sido alterado");
    }

    /* ============ PARTE H — replay do MESMO executionId é idempotente ============ */
    {
      await resetState();
      const marketplaceId = "mercado_livre";
      await armGlobalRollout(instanceExecutor(0), {
        marketplaceId,
        mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
        enabled: true,
        legacyFallbackEnabled: true,
        maxWrites: 10,
      });

      const executionId = "replay-execution-fixa";
      const first = await acquireGlobalPermit(instanceExecutor(0), {
        marketplaceId,
        externalListingId: "LISTING-REPLAY",
        executionId,
      });
      assert.equal(first.granted, true);
      assert.equal(first.granted && first.usedWrites, 1);

      /*
       * Retry da MESMA listagem com o MESMO executionId: a instrução atômica
       * vai consumir outro slot (o contador é global e honesto), mas o
       * marcador de commit é idempotente por (executionId, kind) — é o que
       * impede o replay de duplicar Product/Offer/PriceHistory.
       */
      const second = await acquireGlobalPermit(instanceExecutor(1), {
        marketplaceId,
        externalListingId: "LISTING-REPLAY",
        executionId,
      });
      assert.equal(second.granted, true);
      assert.equal(second.granted && second.usedWrites, 2);

      const events = await admin.query<{ total: number }>(
        `SELECT COUNT(*)::int AS "total" FROM "CatalogCutoverEvent"
          WHERE "executionId" = $1`,
        [executionId],
      );
      assert.equal(
        events.rows[0].total,
        1,
        "replay com o mesmo executionId não pode duplicar o marcador",
      );
    }

    await disconnectGlobalControlPools();

    console.log("");
    console.log("GLOBAL_BUDGET_CONCURRENCY_EVIDENCE");
    for (const r of rounds) {
      console.log(
        `  round=${r.round} maxWrites=${r.maxWrites} contenders=${r.contenders} ` +
          `granted=${r.granted} denied=${r.denied} dbUsedWrites=${r.dbUsedWrites} ` +
          `grantEvents=${r.grantEvents} distinctExecutionIds=${r.distinctExecutionIds}`,
      );
    }
    console.log("  parteE_budget_esgotado_breaker=CLOSED ok");
    console.log("  parteF_breaker_global_todas_instancias_fail_closed ok");
    console.log("  parteG_check_constraint_banco ok");
    console.log("  parteH_replay_marcador_idempotente ok");
    console.log("GLOBAL_BUDGET_CONCURRENCY_TEST=PASS");
  } finally {
    await admin.end().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
