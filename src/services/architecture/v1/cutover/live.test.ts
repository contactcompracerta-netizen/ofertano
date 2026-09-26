/**
 * CATALOG_ARCHITECTURE_V1 — FASE 7.1: GATE LIVE, BYPASS INTERNO E OWNERSHIP.
 *
 * Cobre o que o `saveProduct` faz em torno da transação canônica, sem
 * precisar de banco: aquisição, atrito de rotas, single-write ownership,
 * bypass interno e classement de paridade.
 *
 *invariantes provados aqui:
 *   A) saveProduct SEM bypass e NÃO autoritativo => comportamento de sempre:
 *      exatamente UMA transação, zero contabilidade, zero breaker.
 *   B) bypass interno => o SEGUNDO gate live NÃO é adquirido e nenhum slot do
 *      orçamento global é consumido; nenhuma trava de segurança é pulada.
 *   C) 1 evento autoritativo => exatamente 1 aquisição de permissão global.
 *   D) fallback só em falha PRÉ-COMMIT transitória.
 *   E) falha PÓS-COMMIT (fronteira marcada) => NUNCA há fallback.
 *   F) IDENTITY_REJECT / POLICY_NOT_READY / MULTISTORE_NOT_READY / INVALID_DATA
 *      => NUNCA há fallback.
 *   G) breaker global: paridade inesperada e ambiguidade de commit abrem o
 *      breaker; rejeição de guarda NÃO abre.
 *   H) o bypass é interno, opcional, default-off e inalcançável por request.
 *   I) agnosticismo de marketplace: nenhum nome de marketplace em código.
 *   K) ownership com contabilidade: 1 evento => exatamente 1 permissão global,
 *      em qualquer rota (sucesso, fallback pré-commit, pós-commit, guardas).
 *   L) invariantes de publicação preservadas em toda rota:
 *      PUBLIC_MULTISTORE_MIN_MARKETPLACES=2 e DRAFT/active=false com 1
 *      marketplace (AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=0).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  beginLiveCutoverWrite,
  completeLiveCutoverWrite,
  runLiveCutoverWrite,
  type LiveWriteContext,
} from "./live";
import type { CutoverSqlExecutor, GlobalRolloutRow } from "./globalControl";
import { emptyCutoverCounters, getCutoverMetrics, resetCutoverMetrics } from "./metrics";
import { observeLivePostWrite } from "./liveParity";
import { hasPublicMultiStore, PUBLIC_MULTISTORE_MIN_MARKETPLACES } from "@/services/publicVisibility/multiStoreVisibility";

const here = path.dirname(fileURLToPath(import.meta.url));
const saveProductSource = readFileSync(
  path.join(here, "../../../database/saveProduct.ts"),
  "utf8",
);
const commitsSource = readFileSync(path.join(here, "commits.ts"), "utf8");

/** Lista recursivamente arquivos com a extensão pedida (varredura estática). */
function collectFiles(dir: string, extension: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, extension));
    } else if (entry.name.endsWith(extension)) {
      out.push(full);
    }
  }
  return out;
}

/** Oferta mínima para `hasPublicMultiStore` (invariante de publicação). */
const oferta = (marketplace: string) => ({
  marketplace,
  active: true,
  available: true,
  status: "ACTIVE",
  matchStatus: "EXACT" as const,
  price: 100,
});

/* -------------------------------------------------------------------------- */
/* EXECUTOR FAKO                                                              */
/* -------------------------------------------------------------------------- */

type FakeRollout = Partial<GlobalRolloutRow> & {
  marketplaceId: string;
};

type QueryLog = { text: string; values: unknown[] };

/**
 * Executor em memória que reproduz a SEMÂNTICA do banco (orçamento atômico,
 * breaker compartilhado, unicidade de marcador) sem I/O. Serve para provar a
 * lógica de decisão; a prova de concorrência real é o teste com Postgres.
 */
function createFakeExecutor(options: {
  rollouts?: FakeRollout[];
  failOn?: RegExp;
} = {}): CutoverSqlExecutor & {
  log: QueryLog[];
  state: {
    rollouts: Map<string, GlobalRolloutRow>;
    events: Array<Record<string, unknown>>;
    permitRequests: number;
  };
} {
  const state = {
    rollouts: new Map<string, GlobalRolloutRow>(),
    events: [] as Array<Record<string, unknown>>,
    permitRequests: 0,
  };

  for (const r of options.rollouts ?? []) {
    state.rollouts.set(r.marketplaceId, {
      id: r.id ?? `rollout-${r.marketplaceId}`,
      marketplaceId: r.marketplaceId,
      mode: r.mode ?? "V1_PRIMARY_WITH_LEGACY_FALLBACK",
      enabled: r.enabled ?? true,
      legacyFallbackEnabled: r.legacyFallbackEnabled ?? true,
      maxWrites: r.maxWrites ?? 10,
      usedWrites: r.usedWrites ?? 0,
      breakerState: r.breakerState ?? "CLOSED",
      breakerReason: r.breakerReason ?? null,
      startedAt: r.startedAt ?? null,
      expiresAt: r.expiresAt ?? null,
    });
  }

  const log: QueryLog[] = [];

  const executor = {
    log,
    state,
    async query(text: string, values: unknown[] = []) {
      log.push({ text, values });

      if (options.failOn?.test(text)) {
        throw new Error("P1001 conexão indisponível");
      }

      const rolloutOf = (idOrMarketplace: unknown): GlobalRolloutRow | null => {
        const key = String(idOrMarketplace);
        return state.rollouts.get(key) ?? null;
      };

      /*
       * Aquisição atômica: checagem + incremento + evento, num passo só.
       * O discriminador é o incremento do contador — o SQL do trip também é
       * um UPDATE na mesma tabela e não pode ser confundido com uma aquisição.
       */
      if (text.includes('SET "usedWrites" = r."usedWrites" + 1')) {
        const [marketplaceId, executionId, externalListingId] = values as string[];
        state.permitRequests += 1;
        const r = state.rollouts.get(marketplaceId);
        const now = Date.now();
        const eligible =
          r !== undefined &&
          r.enabled &&
          r.breakerState === "CLOSED" &&
          (r.mode === "V1_PRIMARY" ||
            r.mode === "V1_PRIMARY_WITH_LEGACY_FALLBACK") &&
          (!r.startedAt || r.startedAt.getTime() <= now) &&
          (!r.expiresAt || r.expiresAt.getTime() > now) &&
          r.usedWrites < r.maxWrites;

        if (!eligible || !r) {
          return { rowCount: 0, rows: [] };
        }

        const updated: GlobalRolloutRow = { ...r, usedWrites: r.usedWrites + 1 };
        state.rollouts.set(marketplaceId, updated);
        pushEvent({
          rolloutId: updated.id,
          marketplaceId,
          kind: "PERMIT_GRANTED",
          executionId,
          externalListingId,
          usedWrites: updated.usedWrites,
          maxWrites: updated.maxWrites,
        });
        return { rowCount: 1, rows: [{ ...updated, eventsWritten: "1" }] };
      }

      /* Leitura do rollout. */
      if (text.includes('FROM "CatalogCutoverRollout" WHERE "marketplaceId"')) {
        const r = rolloutOf(values[0]);
        return { rowCount: r ? 1 : 0, rows: r ? [r] : [] };
      }

      /* Trip do breaker. */
      if (text.includes('SET "breakerState" = \'OPEN\'')) {
        const r = state.rollouts.get(
          [...state.rollouts.values()].find((x) => x.id === values[0])
            ?.marketplaceId ?? "",
        );
        if (!r || r.breakerState === "OPEN") {
          return { rowCount: 0, rows: [] };
        }
        const updated: GlobalRolloutRow = {
          ...r,
          breakerState: "OPEN",
          breakerReason: String(values[2]),
        };
        state.rollouts.set(r.marketplaceId, updated);
        pushEvent({
          rolloutId: r.id,
          marketplaceId: r.marketplaceId,
          kind: "TRIP",
          reason: values[2],
          executionId: values[1],
        });
        return { rowCount: 1, rows: [{ id: r.id, marketplaceId: r.marketplaceId }] };
      }

      /* Contagem de falhas V1 recentes. */
      if (text.includes('COUNT(*)::int AS "total"') && text.includes('V1_FAILED')) {
        const total = state.events.filter(
          (e) => e.kind === "V1_FAILED" && e.rolloutId === values[0],
        ).length;
        return { rowCount: 1, rows: [{ total }] };
      }

      /*
       * Inserção genérica de evento. O SQL real é um template literal que
       * começa com quebra de linha, então o casamento é por `includes`.
       */
      if (text.includes('INSERT INTO "CatalogCutoverEvent"')) {
        pushEvent({
          rolloutId: values[0],
          marketplaceId: values[1],
          kind: values[2],
          reason: values[3],
          executionId: values[6],
          externalListingId: values[7],
        });
        return { rowCount: 1, rows: [] };
      }

      return { rowCount: 0, rows: [] };
    },
  } as CutoverSqlExecutor & { log: QueryLog[]; state: typeof state };

  function pushEvent(event: Record<string, unknown>): void {
    const key = `${String(event.executionId)}::${String(event.kind)}`;
    if (
      state.events.some(
        (e) => `${String(e.executionId)}::${String(e.kind)}` === key,
      )
    ) {
      return; // ON CONFLICT (executionId, kind) DO NOTHING
    }
    state.events.push(event);
  }

  return executor;
}

function bypassedContext(marketplaceId: string): LiveWriteContext {
  /*
   * Reproduz exatamente o que `saveProduct` monta para
   * `__internalSkipLiveCutoverGate`: contexto NÃO autoritativo e já liquidado.
   */
  return {
    marketplaceId,
    externalListingId: "ML-1",
    executionId: "",
    authoritative: false,
    mode: "LEGACY_ONLY",
    denyReason: "ROLLOUT_ABSENT",
    rolloutId: null,
    legacyFallbackEnabled: false,
    usedWrites: null,
    maxWrites: null,
    settled: true,
    fallbackAttempted: false,
  };
}

function armedContext(
  overrides: Partial<LiveWriteContext> = {},
): LiveWriteContext {
  return {
    marketplaceId: "mercado_livre",
    externalListingId: "ML-1",
    executionId: "exec-1",
    authoritative: true,
    mode: "V1_PRIMARY_WITH_LEGACY_FALLBACK",
    denyReason: null,
    rolloutId: "rollout-1",
    legacyFallbackEnabled: true,
    usedWrites: 1,
    maxWrites: 5,
    settled: false,
    fallbackAttempted: false,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const metrics = getCutoverMetrics();

  /* ====================================================================== */
  /* A) NÃO AUTORITATIVO => COMPORTAMENTO DE SEMPRE                         */
  /* ====================================================================== */
  {
    resetCutoverMetrics();
    const executor = createFakeExecutor({ rollouts: [] });
    const ctx = await beginLiveCutoverWrite({
      marketplaceId: "mercado_livre",
      externalListingId: "ML-1",
      env: { DATABASE_URL: "postgresql://x/y" },
      executor,
    });
    assert.equal(ctx.authoritative, false);
    assert.equal(ctx.denyReason, "ROLLOUT_ABSENT");
    assert.equal(ctx.mode, "LEGACY_ONLY");

    let txCalls = 0;
    const outcome = await runLiveCutoverWrite<string>({
      ctx,
      executor: null,
      v1Write: async () => {
        txCalls += 1;
        return "produto";
      },
      legacyWrite: async () => {
        txCalls += 1;
        return "produto-legacy";
      },
      onSuccess: async () => {},
      onFailure: async () => {},
    });

    assert.equal(txCalls, 1, "rota não autoritativa => exatamente 1 transação");
    assert.equal(outcome.kind, "LEGACY_ONLY");
    assert.equal(outcome.result, "produto");
    const s = metrics.snapshot().byMarketplace["mercado_livre"];
    assert.equal(s.v1_live_authoritative_attempt_total, 0, "não autoritativo não é tentativa V1");
    assert.equal(s.global_cutover_budget_used, 0);
  }

  /* ====================================================================== */
  /* C) 1 EVENTO AUTORITATIVO => EXATAMENTE 1 PERMISSÃO GLOBAL              */
  /* ====================================================================== */
  {
    resetCutoverMetrics();
    const executor = createFakeExecutor({
      rollouts: [{ marketplaceId: "mercado_livre", maxWrites: 5, usedWrites: 0 }],
    });
    const ctx = await beginLiveCutoverWrite({
      marketplaceId: "mercado_livre",
      externalListingId: "ML-1",
      env: { DATABASE_URL: "postgresql://x/y" },
      executor,
    });
    assert.equal(ctx.authoritative, true);
    assert.equal(ctx.usedWrites, 1, "a permissão consumiu o 1º slot");
    assert.equal(ctx.maxWrites, 5);
    assert.equal(ctx.rolloutId, "rollout-mercado_livre");

    let txCalls = 0;
    await runLiveCutoverWrite<string>({
      ctx,
      executor,
      v1Write: async () => {
        txCalls += 1;
        return "produto";
      },
      legacyWrite: async () => {
        txCalls += 1;
        return "produto-legacy";
      },
      onSuccess: async () => {},
      onFailure: async () => {},
    });

    assert.equal(txCalls, 1, "1 evento => 1 transação");
    assert.equal(
      executor.state.permitRequests,
      1,
      "1 evento autoritativo => exatamente 1 aquisição de permissão global",
    );
    const s = metrics.snapshot().byMarketplace["mercado_livre"];
    assert.equal(s.v1_live_authoritative_attempt_total, 1);
    assert.equal(s.global_cutover_budget_used, 1);
    assert.equal(s.global_cutover_budget_remaining, 4);
  }

  /* ====================================================================== */
  /* B) BYPASS INTERNO => SEGUNDO GATE LIVE NÃO É ADQUIRIDO                 */
  /* ====================================================================== */
  {
    resetCutoverMetrics();
    const executor = createFakeExecutor({
      rollouts: [{ marketplaceId: "mercado_livre", maxWrites: 5, usedWrites: 0 }],
    });

    /*
     * O bypass acontece ANTES de qualquer aquisição: o saveProduct monta o
     * contexto e não chama `beginLiveCutoverWrite`. Logo, `permitRequests`
     * precisa permanecer 0 e nenhum slot pode ser gasto.
     */
    const ctx = bypassedContext("mercado_livre");

    let txCalls = 0;
    const outcome = await runLiveCutoverWrite<string>({
      ctx,
      executor,
      v1Write: async () => {
        txCalls += 1;
        return "produto";
      },
      legacyWrite: async () => {
        txCalls += 1;
        return "produto-legacy";
      },
      onSuccess: async () => {},
      onFailure: async () => {},
    });

    assert.equal(txCalls, 1, "bypass => exatamente 1 transação, sem 2º gate");
    assert.equal(outcome.kind, "LEGACY_ONLY");
    assert.equal(
      executor.state.permitRequests,
      0,
      "o bypass não pode adquirir permissão global (nenhum slot gasto)",
    );
    assert.equal(
      executor.state.rollouts.get("mercado_livre")?.usedWrites,
      0,
      "o bypass não pode consumir o orçamento global",
    );
    assert.equal(
      executor.log.length,
      0,
      "o bypass não pode tocar o plano de controle (zero I/O)",
    );
    assert.equal(
      metrics.snapshot().byMarketplace["mercado_livre"]?.v1_live_authoritative_attempt_total ?? 0,
      0,
      "o bypass não pode ser contabilizado como tentativa autoritativa",
    );
  }

  /* ====================================================================== */
  /* B2) CONTEXTO JÁ LIQUIDADO NUNCA É LIQUIDADO DE NOVO                   */
  /* ====================================================================== */
  {
    /*
     * Um contexto `settled` já teve sua contabilidade resolvida (é o que o
     * bypass interno entrega). Reutilizá-lo NÃO pode: nem uma segunda
     * transação, nem um marcador, nem o breaker.
     */
    resetCutoverMetrics();
    const executor = createFakeExecutor({
      rollouts: [{ marketplaceId: "mercado_livre", maxWrites: 5, usedWrites: 0 }],
    });
    const ctx = armedContext({ settled: true, authoritative: true });

    let txCalls = 0;
    const outcome = await runLiveCutoverWrite<string>({
      ctx,
      executor,
      v1Write: async () => {
        txCalls += 1;
        return "produto";
      },
      legacyWrite: async () => {
        txCalls += 1;
        return "produto-legacy";
      },
      onSuccess: async () => {
        await completeLiveCutoverWrite(ctx, {
          ok: true,
          executor,
          commitPhase: "COMMITTED",
        });
      },
      onFailure: async () => {},
    });

    assert.equal(txCalls, 1, "contexto liquidado => exatamente 1 transação");
    assert.equal(outcome.kind, "LEGACY_ONLY", "contexto liquidado não é rota V1");
    assert.equal(
      executor.log.length,
      0,
      "contexto liquidado não toca o plano de controle (nenhum marcador)",
    );
    assert.equal(
      executor.state.rollouts.get("mercado_livre")?.usedWrites,
      0,
      "contexto liquidado não consome orçamento",
    );
  }

  /* ====================================================================== */
  /* D) FALHA PRÉ-COMMIT TRANSITÓRIA => FALLBACK ASSUME (1 write)           */
  /* ====================================================================== */
  {
    resetCutoverMetrics();
    const executor = createFakeExecutor({
      rollouts: [{ marketplaceId: "mercado_livre", maxWrites: 5 }],
    });
    const ctx = await beginLiveCutoverWrite({
      marketplaceId: "mercado_livre",
      externalListingId: "ML-1",
      env: { DATABASE_URL: "postgresql://x/y" },
      executor,
    });

    let txCalls = 0;
    const outcome = await runLiveCutoverWrite<string>({
      ctx,
      executor,
      v1Write: async () => {
        txCalls += 1;
        throw new Error("P1001 connection refused");
      },
      legacyWrite: async () => {
        txCalls += 1;
        return "produto-fallback";
      },
      onSuccess: async () => {},
      onFailure: async (f) => {
        assert.equal(f.commitPhase, "ROLLED_BACK");
        assert.equal(f.fallbackCommitted, true);
      },
    });

    assert.equal(txCalls, 2, "V1 tentou e o fallback assumiu");
    assert.equal(outcome.kind, "LEGACY_FALLBACK_COMMITTED");
    assert.equal(
      executor.state.rollouts.get("mercado_livre")?.breakerState,
      "CLOSED",
      "uma falha transitória isolada não abre o breaker",
    );
  }

  /* ====================================================================== */
  /* E) FALHA PÓS-COMMIT (FRONTEIRA MARCADA) => NUNCA HÁ FALLBACK          */
  /* ====================================================================== */
  {
    resetCutoverMetrics();
    const executor = createFakeExecutor({
      rollouts: [{ marketplaceId: "mercado_livre", maxWrites: 5 }],
    });
    const ctx = await beginLiveCutoverWrite({
      marketplaceId: "mercado_livre",
      externalListingId: "ML-1",
      env: { DATABASE_URL: "postgresql://x/y" },
      executor,
    });

    let legacyCalls = 0;
    let txCalls = 0;
    await assert.rejects(
      runLiveCutoverWrite<string>({
        ctx,
        executor,
        v1Write: async (mark) => {
          txCalls += 1;
          mark(); // fronteira de commit: pode ter commitado
          throw new Error("P1017 servidor fechou a conexão");
        },
        legacyWrite: async () => {
          legacyCalls += 1;
          return "produto-legacy";
        },
        onSuccess: async () => {},
        onFailure: async (f) => {
          assert.equal(f.commitPhase, "COMMIT_UNKNOWN");
          assert.equal(f.fallbackCommitted, false);
          // O saveProduct liquida o contexto aqui; o teste precisa espelhar.
          await completeLiveCutoverWrite(ctx, {
            ok: false,
            executor,
            commitPhase: f.commitPhase,
            failureCode: f.failureCode,
            fallbackCommitted: f.fallbackCommitted,
            fallbackFailureCode: f.fallbackFailureCode,
            fallbackCommitPhase: f.fallbackCommitPhase,
          });
        },
      }),
    );

    assert.equal(legacyCalls, 0, "falha pós-commit => o legado NUNCA escreve");
    assert.equal(txCalls, 1);

    const trip = executor.state.events.find((e) => e.kind === "TRIP");
    assert.ok(trip, "commit ambíguo deve abrir o breaker global");
    assert.ok(
      executor.state.events.some((e) => e.kind === "AMBIGUOUS_COMMIT"),
      "commit ambíguo deve ser registrado",
    );
  }

  /* ====================================================================== */
  /* F) CÓDIGOS SEM FALLBACK                                               */
  /* ====================================================================== */
  {
    const semFallback: Array<[string, string]> = [
      ["IDENTITY_REJECT:matchStatus REJECTED", "IDENTITY_REJECT"],
      ["POLICY_NOT_READY:politica-multiloja", "POLICY_NOT_READY"],
      ["MULTISTORE_NOT_READY:PUBLIC_MULTISTORE_MIN_MARKETPLACES", "MULTISTORE_NOT_READY"],
      ["INVALID_DATA:preço inválido", "INVALID_DATA"],
    ];

    for (const [erro] of semFallback) {
      resetCutoverMetrics();
      const executor = createFakeExecutor({
        rollouts: [{ marketplaceId: "mercado_livre", maxWrites: 5 }],
      });
      const ctx = await beginLiveCutoverWrite({
        marketplaceId: "mercado_livre",
        externalListingId: "ML-1",
        env: { DATABASE_URL: "postgresql://x/y" },
        executor,
      });

      let legacyCalls = 0;
      let seen: string | null = null;
      await assert.rejects(
        runLiveCutoverWrite<string>({
          ctx,
          executor,
          v1Write: async () => {
            throw new Error(erro);
          },
          legacyWrite: async () => {
            legacyCalls += 1;
            return "produto-legacy";
          },
          onSuccess: async () => {},
          onFailure: async (f) => {
            seen = f.failureCode;
          },
        }),
        `${erro} deve propagar a falha original`,
      );

      assert.equal(legacyCalls, 0, `${erro} => NUNCA há fallback`);
      assert.ok(seen !== null, `${erro} deve ser classificado`);
      assert.equal(
        executor.state.rollouts.get("mercado_livre")?.breakerState,
        "CLOSED",
        `${erro} é recusa legítima: não abre o breaker`,
      );
    }
  }

  /* ====================================================================== */
  /* G) BREAKER POR PARIDADE INESPERADA                                    */
  /* ====================================================================== */
  {
    resetCutoverMetrics();
    const executor = createFakeExecutor({
      rollouts: [{ marketplaceId: "mercado_livre", maxWrites: 5 }],
    });
    const ctx = await beginLiveCutoverWrite({
      marketplaceId: "mercado_livre",
      externalListingId: "ML-1",
      env: { DATABASE_URL: "postgresql://x/y" },
      executor,
    });

    await runLiveCutoverWrite<string>({
      ctx,
      executor,
      v1Write: async () => "produto",
      legacyWrite: async () => "produto-legacy",
      onSuccess: async (result) => {
        await completeLiveCutoverWrite(ctx, {
          ok: true,
          executor,
          commitPhase: "COMMITTED",
          observation: await observeLivePostWrite(
            {
              async read() {
                return {
                  productId: "outro-produto",
                  offerId: "o1",
                  price: 999,
                  oldPrice: null,
                  stock: null,
                  available: true,
                  active: false,
                  publicationStatus: "DRAFT",
                };
              },
            },
            {
              marketplace: "MERCADO_LIVRE",
              marketplaceId: "mercado_livre",
              externalListingId: "ML-1",
              expectedProductId: "produto",
              intendedPrice: 100,
              intendedOldPrice: null,
              intendedStock: null,
              intendedAvailable: true,
            },
          ),
        });
        void result;
      },
      onFailure: async () => {},
    });

    assert.equal(
      executor.state.rollouts.get("mercado_livre")?.breakerState,
      "OPEN",
      "paridade inesperada (identidade + preço) deve abrir o breaker global",
    );
    const s = metrics.snapshot().byMarketplace["mercado_livre"];
    assert.equal(s.live_parity_unexpected_difference_total, 1);
    assert.equal(s.global_cutover_breaker_total, 1);
  }

  /* ====================================================================== */
  /* PARIDADE: MATCH E DIFERENÇA ESPERADA NÃO ABREM BREAKER                 */
  /* ====================================================================== */
  {
    resetCutoverMetrics();
    const executor = createFakeExecutor({
      rollouts: [{ marketplaceId: "mercado_livre", maxWrites: 5 }],
    });
    const ctx = await beginLiveCutoverWrite({
      marketplaceId: "mercado_livre",
      externalListingId: "ML-1",
      env: { DATABASE_URL: "postgresql://x/y" },
      executor,
    });

    const observation = await observeLivePostWrite(
      {
        async read() {
          return {
            productId: "produto",
            offerId: "o1",
            price: 100,
            // oldPrice normalizado: divergência ESPERADA e segura.
            oldPrice: null,
            stock: 3,
            available: true,
            active: false,
            publicationStatus: "DRAFT",
          };
        },
      },
      {
        marketplace: "MERCADO_LIVRE",
        marketplaceId: "mercado_livre",
        externalListingId: "ML-1",
        expectedProductId: "produto",
        intendedPrice: 100,
        intendedOldPrice: 120,
        intendedStock: null,
        intendedAvailable: true,
      },
    );
    assert.equal(observation.verdict, "EXPECTED_DIFFERENCE");
    assert.ok(
      observation.differences.every((d) => d.severity === "EXPECTED"),
      "oldPrice/estoque divergentes são normalizações documentadas",
    );

    await completeLiveCutoverWrite(ctx, {
      ok: true,
      executor,
      commitPhase: "COMMITTED",
      observation,
    });

    assert.equal(
      executor.state.rollouts.get("mercado_livre")?.breakerState,
      "CLOSED",
      "diferença esperada NÃO pode abrir o breaker",
    );
    assert.equal(
      metrics.snapshot().byMarketplace["mercado_livre"]
        .live_parity_expected_difference_total,
      1,
    );
  }

  /* ====================================================================== */
  /* BREAKER JA ABERTO => FAIL-CLOSED (rollback sem novo deploy)           */
  /* ====================================================================== */
  {
    resetCutoverMetrics();
    const executor = createFakeExecutor({
      rollouts: [
        {
          marketplaceId: "mercado_livre",
          maxWrites: 100,
          breakerState: "OPEN",
          breakerReason: "PUBLICATION_VIOLATION",
        },
      ],
    });
    const ctx = await beginLiveCutoverWrite({
      marketplaceId: "mercado_livre",
      externalListingId: "ML-1",
      env: { DATABASE_URL: "postgresql://x/y" },
      executor,
    });
    assert.equal(ctx.authoritative, false, "breaker aberto => fail-closed");
    assert.equal(ctx.denyReason, "BREAKER_OPEN");
    assert.equal(
      executor.state.rollouts.get("mercado_livre")?.usedWrites,
      0,
      "breaker aberto não consome orçamento",
    );
  }

  /* ====================================================================== */
  /* ORÇAMENTO ESGOTADO => FAIL-CLOSED, BREAKER FECHADO                     */
  /* ====================================================================== */
  {
    resetCutoverMetrics();
    const executor = createFakeExecutor({
      rollouts: [
        {
          marketplaceId: "mercado_livre",
          maxWrites: 1,
          usedWrites: 1,
        },
      ],
    });
    const ctx = await beginLiveCutoverWrite({
      marketplaceId: "mercado_livre",
      externalListingId: "ML-1",
      env: { DATABASE_URL: "postgresql://x/y" },
      executor,
    });
    assert.equal(ctx.authoritative, false);
    assert.equal(ctx.denyReason, "BUDGET_EXHAUSTED");
    assert.equal(
      executor.state.rollouts.get("mercado_livre")?.breakerState,
      "CLOSED",
      "esgotar o orçamento é esperado e não abre o breaker",
    );
  }

  /* ====================================================================== */
  /* SEM PLANO DE CONTROLE => FAIL-CLOSED                                  */
  /* ====================================================================== */
  {
    resetCutoverMetrics();
    const ctx = await beginLiveCutoverWrite({
      marketplaceId: "mercado_livre",
      externalListingId: "ML-1",
      env: {},
      executor: null,
    });
    assert.equal(ctx.authoritative, false);
    assert.equal(ctx.denyReason, "CONTROL_UNAVAILABLE");
  }

  /* ====================================================================== */
  /* ERRO DE INFRAESTRUTURA NO PLANO DE CONTROLE => FAIL-CLOSED             */
  /* ====================================================================== */
  {
    resetCutoverMetrics();
    const executor = createFakeExecutor({
      rollouts: [{ marketplaceId: "mercado_livre", maxWrites: 5 }],
      failOn: /UPDATE "CatalogCutoverRollout" r/,
    });
    const ctx = await beginLiveCutoverWrite({
      marketplaceId: "mercado_livre",
      externalListingId: "ML-1",
      env: { DATABASE_URL: "postgresql://x/y" },
      executor,
    });
    assert.equal(ctx.authoritative, false, "plano de controle fora do ar => legado");
    assert.equal(ctx.denyReason, "CONTROL_UNAVAILABLE");
  }

  /* ====================================================================== */
  /* D/E) INVARIANTE DE PUBLICAÇÃO MULTILOJA (independe do writer)          */
  /* ====================================================================== */
  {
    assert.equal(PUBLIC_MULTISTORE_MIN_MARKETPLACES, 2);

    assert.equal(
      hasPublicMultiStore([oferta("MERCADO_LIVRE")]),
      false,
      "1 marketplace => DRAFT/inativo",
    );
    assert.equal(
      hasPublicMultiStore([
        oferta("MERCADO_LIVRE"),
        oferta("MERCADO_LIVRE"),
        oferta("MERCADO_LIVRE"),
        oferta("MERCADO_LIVRE"),
        oferta("MERCADO_LIVRE"),
      ]),
      false,
      "5 listings do MESMO marketplace continuam sendo 1 marketplace",
    );
    assert.equal(
      hasPublicMultiStore([oferta("MERCADO_LIVRE"), oferta("SHOPEE")]),
      true,
      "2 marketplaces distintos => público",
    );
  }

  /* ====================================================================== */
  /* H) O BYPASS É INTERNO, OPCIONAL, DEFAULT-OFF E INALCANÇÁVEL            */
  /* ====================================================================== */
  {
    // 1) declarado opcional (não obrigatório) na tipagem pública.
    assert.match(
      saveProductSource,
      /__internalSkipLiveCutoverGate\?:\s*boolean/,
      "a flag deve ser OPCIONAL na tipagem",
    );
    // 2) nunca tem valor default `true` em lugar nenhum.
    assert.doesNotMatch(
      saveProductSource,
      /__internalSkipLiveCutoverGate\s*[:=]\s*true(?!\s*[,}])/,
      "a flag não pode ter default true",
    );
    assert.doesNotMatch(
      saveProductSource,
      /__internalSkipLiveCutoverGate\s*\?\?\s*true/,
      "a flag não pode ser normalizada para true",
    );
    // 3) é usada uma única vez, só para escolher o caminho de contexto.
    //    No arquivo são 2 ocorrências: a tipagem e o uso. A documentação da
    //    flag é identificada pelo marcador, não pelo nome do símbolo.
    const usos = saveProductSource.match(/__internalSkipLiveCutoverGate/g) ?? [];
    assert.equal(
      usos.length,
      2,
      `esperado: tipagem + uso na seleção do contexto (encontrado ${usos.length})`,
    );
    assert.match(
      saveProductSource,
      /CATALOG_V1_GLOBAL_CUTOVER — bypass privado do gate live[\s\S]{0,900}__internalSkipLiveCutoverGate\?: boolean/,
      "a flag precisa de documentação junto da tipagem",
    );
    assert.match(
      saveProductSource,
      /options\.__internalSkipLiveCutoverGate\s*\n?\s*\?\s*bypassedLiveContext/,
      "o bypass só pode escolher o contexto de bypass",
    );
    // 4) no repositório, a flag só é ligada em DOIS lugares, e ambos são o
    //    dono interno da autorização do mesmo evento: o commit V1 primário e o
    //    fallback legado. Nenhum outro módulo a liga.
    const liga =
      commitsSource.match(/__internalSkipLiveCutoverGate:\s*true/g) ?? [];
    assert.equal(
      liga.length,
      2,
      `a flag é ligada em exatamente dois lugares (commitV1Structural + legacyWrite), encontrado ${liga.length}`,
    );
    assert.match(
      commitsSource,
      /async commitV1Structural[\s\S]*?__internalSkipLiveCutoverGate:\s*true/,
      "o bypass pertence a commitV1Structural",
    );
    assert.match(
      commitsSource,
      /async legacyWrite[\s\S]*?__internalSkipLiveCutoverGate:\s*true/,
      "o fallback legado também é dono da autorização: ele não reabre o gate",
    );
    // Nenhum outro arquivo de produção (fora testes) liga a flag: o único dono
    // da autorização interna é `commits.ts`.
    const ligam = collectFiles(path.join(here, ".."), ".ts").filter(
      (file) =>
        !/\.test\.ts$/.test(file) &&
        (readFileSync(file, "utf8").match(/__internalSkipLiveCutoverGate\s*:\s*true/g) ??
          []).length > 0,
    );
    assert.deepEqual(
      ligam.map((file) => path.relative(path.join(here, ".."), file)),
      ["cutover/commits.ts"],
      "commits.ts é o único módulo que pode ligar o bypass do gate live",
    );
    // 5) não há rota de request público able to ligá-la.
    assert.doesNotMatch(
      saveProductSource,
      /JSON\.parse[\s\S]{0,80}__internalSkip/,
      "a flag não pode vir de payload de request",
    );
    for (const file of collectFiles(path.join(here, "../../../../app"), ".ts")) {
      assert.equal(
        readFileSync(file, "utf8").includes("__internalSkipLiveCutoverGate"),
        false,
        `${file}: nenhuma rota pública pode conhecer o bypass`,
      );
    }
    // 6) o bypass constrói contexto NÃO autoritativo: não pode forçar
    //    publicação nem active=true.
    assert.match(
      saveProductSource,
      /function bypassedLiveContext[\s\S]*?authoritative:\s*false/,
      "o bypass nunca produz contexto autoritativo",
    );
    assert.match(
      saveProductSource,
      /function bypassedLiveContext[\s\S]*?settled:\s*true/,
      "o bypass entrega contexto já liquidado (nada a contabilizar)",
    );
    // 7) as travas de segurança NÃO são condicionais ao bypass: a flag só
    //    aparece na escolha do contexto, logo nada depois do gate pode
    //    depender dela; e cada trava continua valendo na transação canônica.
    assert.equal(
      (
        saveProductSource
          .slice(saveProductSource.indexOf("const controlExecutor"))
          .match(/__internalSkipLiveCutoverGate/g) ?? []
      ).length,
      0,
      "o bypass não pode reaparecer depois do gate (nenhuma trava pode depender dele)",
    );
    for (const trava of [
      "permitirAtivacaoProdutoAutoCriado",
      "historicoPrecisaNovaEntrada",
    ]) {
      assert.ok(
        saveProductSource.includes(trava),
        `${trava} deve continuar valendo no caminho com bypass`,
      );
    }
    assert.match(
      saveProductSource,
      /semMultiLojaPublica\s*\?\s*\n?\s*"DRAFT"/,
      "sem multiloja pública => DRAFT, independente do writer",
    );
    assert.match(
      saveProductSource,
      /const activeFinal\s*=\s*\n?\s*!semMultiLojaPublica/,
      "sem multiloja pública => active=false, independente do writer",
    );
  }

  /* ====================================================================== */
  /* I) AGNOSTICISMO DE MARKETPLACE                                        */
  /* ====================================================================== */
  {
    for (const file of ["live.ts", "globalControl.ts", "liveParity.ts", "commits.ts"]) {
      const source = readFileSync(path.join(here, file), "utf8");
      // Nenhuma regra central do tipo `if marketplace === "..."`.
      assert.doesNotMatch(
        source,
        /if\s*\(\s*marketplace(Id)?\s*===/,
        `${file} não pode comparar marketplace por igualdade`,
      );
      assert.doesNotMatch(
        source,
        /(marketplace(Id)?\s*===\s*"|===\s*"(MERCADO_LIVRE|SHOPEE|AMAZON|MAGALU|ALIEXPRESS))/i,
        `${file} não pode mentionsar nome de marketplace em código`,
      );
    }
    // A configuração do canário é por marketplaceId, e o gate funciona igual
    // para qualquer um deles.
    for (const marketplaceId of ["mercado_livre", "shopee", "magalu", "amazon"]) {
      resetCutoverMetrics();
      const executor = createFakeExecutor({
        rollouts: [{ marketplaceId, maxWrites: 2, usedWrites: 0 }],
      });
      const ctx = await beginLiveCutoverWrite({
        marketplaceId,
        externalListingId: "X-1",
        env: { DATABASE_URL: "postgresql://x/y" },
        executor,
      });
      assert.equal(
        ctx.authoritative,
        true,
        `${marketplaceId} deve ser tratado exatamente como qualquer outro`,
      );
      assert.equal(ctx.marketplaceId, marketplaceId);
    }
  }

  /* ====================================================================== */
  /* K) UMA PERMISSÃO GLOBAL POR EVENTO — NUNCA A SEGUNDA                   */
  /* ====================================================================== */
  {
    /*
     * O tetos global conta ESCRITAS, não chamadas. Se o caminho de fallback
     * voltasse a adquirir permissão, um único evento consumiria 2 slots e o
     * `usedWrites` deixaria de ser o número de escritas reais. Estes passos
     * contam requisições de aquisição (`permitRequests`) e o `usedWrites` no
     * estado do rollout para cada rota de ownership.
     */

    /* K1) V1 autoritativo com sucesso => exatamente 1 permissão, 0 fallback. */
    {
      resetCutoverMetrics();
      const executor = createFakeExecutor({
        rollouts: [{ marketplaceId: "mercado_livre", maxWrites: 5, usedWrites: 0 }],
      });
      const ctx = await beginLiveCutoverWrite({
        marketplaceId: "mercado_livre",
        externalListingId: "ML-K1",
        env: { DATABASE_URL: "postgresql://x/y" },
        executor,
      });

      let legacyCalls = 0;
      const outcome = await runLiveCutoverWrite<string>({
        ctx,
        executor,
        v1Write: async (mark) => {
          mark();
          return "produto";
        },
        legacyWrite: async () => {
          legacyCalls += 1;
          return "produto-legacy";
        },
        onSuccess: async () => {},
        onFailure: async () => {},
      });

      assert.equal(outcome.kind, "V1_COMMITTED");
      assert.equal(legacyCalls, 0, "V1 commitou => o legado NUNCA escreve");
      assert.equal(
        executor.state.permitRequests,
        1,
        "caminho V1 autoritativo => exatamente 1 permissão global",
      );
      assert.equal(
        executor.state.rollouts.get("mercado_livre")?.usedWrites,
        1,
        "1 escrita => usedWrites = 1",
      );
    }

    /* K2) maxWrites=1 + falha transitória PRÉ-COMMIT => o fallback assume e
     *     `usedWrites` PERMANECE 1 (nenhuma segunda permissão). */
    {
      resetCutoverMetrics();
      const executor = createFakeExecutor({
        rollouts: [{ marketplaceId: "mercado_livre", maxWrites: 1, usedWrites: 0 }],
      });
      const ctx = await beginLiveCutoverWrite({
        marketplaceId: "mercado_livre",
        externalListingId: "ML-K2",
        env: { DATABASE_URL: "postgresql://x/y" },
        executor,
      });
      assert.equal(ctx.authoritative, true, "com maxWrites=1 ainda há 1 slot");

      let legacyCalls = 0;
      const outcome = await runLiveCutoverWrite<string>({
        ctx,
        executor,
        v1Write: async () => {
          throw new Error("P1001 conexão recusada");
        },
        legacyWrite: async (mark) => {
          legacyCalls += 1;
          mark();
          return "produto-fallback";
        },
        onSuccess: async () => {},
        onFailure: async () => {},
      });

      assert.equal(outcome.kind, "LEGACY_FALLBACK_COMMITTED");
      assert.equal(legacyCalls, 1, "o fallback assume exatamente uma vez");
      assert.equal(
        executor.state.permitRequests,
        1,
        "o fallback NÃO adquire uma segunda permissão global",
      );
      assert.equal(
        executor.state.rollouts.get("mercado_livre")?.usedWrites,
        1,
        "maxWrites=1 + falha pré-commit + fallback => usedWrites permanece 1",
      );
    }

    /* K3) falha PÓS-COMMIT => zero fallback (logo, zero segunda escrita). */
    {
      resetCutoverMetrics();
      const executor = createFakeExecutor({
        rollouts: [{ marketplaceId: "mercado_livre", maxWrites: 5, usedWrites: 0 }],
      });
      const ctx = await beginLiveCutoverWrite({
        marketplaceId: "mercado_livre",
        externalListingId: "ML-K3",
        env: { DATABASE_URL: "postgresql://x/y" },
        executor,
      });

      let legacyCalls = 0;
      await assert.rejects(
        runLiveCutoverWrite<string>({
          ctx,
          executor,
          v1Write: async (mark) => {
            mark();
            throw new Error("P2014 transação falhou");
          },
          legacyWrite: async () => {
            legacyCalls += 1;
            return "produto-legacy";
          },
          onSuccess: async () => {},
          onFailure: async () => {},
        }),
      );

      assert.equal(legacyCalls, 0, "pós-commit => NUNCA há fallback (zero double-write)");
      assert.equal(executor.state.permitRequests, 1);
      assert.equal(executor.state.rollouts.get("mercado_livre")?.usedWrites, 1);
    }

    /* K4) códigos de guarda => zero fallback e zero segunda permissão. */
    {
      for (const erro of [
        "IDENTITY_REJECT:matchStatus REJECTED",
        "POLICY_NOT_READY:politica-multiloja",
        "MULTISTORE_NOT_READY:PUBLIC_MULTISTORE_MIN_MARKETPLACES",
        "INVALID_DATA:preço inválido",
      ]) {
        resetCutoverMetrics();
        const executor = createFakeExecutor({
          rollouts: [{ marketplaceId: "mercado_livre", maxWrites: 5, usedWrites: 0 }],
        });
        const ctx = await beginLiveCutoverWrite({
          marketplaceId: "mercado_livre",
          externalListingId: "ML-K4",
          env: { DATABASE_URL: "postgresql://x/y" },
          executor,
        });

        let legacyCalls = 0;
        await assert.rejects(
          runLiveCutoverWrite<string>({
            ctx,
            executor,
            v1Write: async () => {
              throw new Error(erro);
            },
            legacyWrite: async () => {
              legacyCalls += 1;
              return "produto-legacy";
            },
            onSuccess: async () => {},
            onFailure: async () => {},
          }),
        );

        assert.equal(legacyCalls, 0, `${erro} => NUNCA há fallback`);
        assert.equal(
          executor.state.permitRequests,
          1,
          `${erro} => nenhuma permissão adicional`,
        );
        assert.equal(executor.state.rollouts.get("mercado_livre")?.usedWrites, 1);
      }
    }

    /*
     * K5) O MESMO EVENTO, DOIS COMMITTS INTERNOS: o dono (V1 ou fallback) e o
     * teto. A contabilidade do evento está no ORQUESTRADOR, e nenhum dos dois
     * caminhos de `commits.ts` pode reabrir o gate. `permitRequests === 0` é
     * a prova estática disso; o e2e mede o mesmo comportamento no Postgres
     * real, com o orçamento no banco.
     */
    {
      const executor = createFakeExecutor({
        rollouts: [{ marketplaceId: "mercado_livre", maxWrites: 5, usedWrites: 0 }],
      });
      const ctx = bypassedContext("mercado_livre");
      await runLiveCutoverWrite<string>({
        ctx,
        executor,
        v1Write: async () => "produto",
        legacyWrite: async () => "produto-legacy",
        onSuccess: async () => {},
        onFailure: async () => {},
      });
      assert.equal(
        executor.state.permitRequests,
        0,
        "o commit interno (V1 ou fallback) nunca adquire permissão global",
      );
    }
  }

  /* ====================================================================== */
  /* L) INVARIANTES DE PUBLICAÇÃO PRESERVADAS EM TODA ROTA                  */
  /* ====================================================================== */
  {
    assert.equal(
      PUBLIC_MULTISTORE_MIN_MARKETPLACES,
      2,
      "PUBLIC_MULTISTORE_MIN_MARKETPLACES=2 preservado",
    );
    // 1 marketplace => não é multiloja pública, seja qual for o writer.
    assert.equal(hasPublicMultiStore([oferta("MERCADO_LIVRE")]), false);
    assert.equal(
      hasPublicMultiStore([oferta("MERCADO_LIVRE"), oferta("SHOPEE")]),
      true,
      "2 marketplaces distintos => público",
    );

    /*
     * AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=0 não é uma condicional do
     * writer: o DRAFT/inativo é decidido na transação canônica, e nenhuma
     * linha depois do gate pode depender do bypass. Se alguém colar a trava ao
     * bypass, estas três asserções quebram.
     */
    assert.match(
      saveProductSource,
      /semMultiLojaPublica\s*\?\s*\n?\s*"DRAFT"/,
      "sem multiloja pública => DRAFT (independente do writer e do bypass)",
    );
    assert.match(
      saveProductSource,
      /const activeFinal\s*=\s*\n?\s*!semMultiLojaPublica/,
      "sem multiloja pública => active=false (AUTO_ACTIVE_WITH_LT_2=0)",
    );
    assert.equal(
      (
        saveProductSource
          .slice(saveProductSource.indexOf("const controlExecutor"))
          .match(/__internalSkipLiveCutoverGate/g) ?? []
      ).length,
      0,
      "nenhuma trava de segurança pode depender do bypass",
    );
  }

  /* ====================================================================== */
  /* SNAPSHOT: contadores começam zerados                                   */
  /* ====================================================================== */
  {
    const vazios = emptyCutoverCounters();
    assert.equal(vazios.v1_live_authoritative_attempt_total, 0);
    assert.equal(vazios.global_cutover_budget_used, 0);
    assert.equal(vazios.global_cutover_breaker_total, 0);
    assert.equal(vazios.live_parity_unexpected_difference_total, 0);
  }

  console.log("cutover/live.test.ts PASS");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
