/**
 * CATALOG_ARCHITECTURE_V1 — FASE 7.1/7.2: CONTROLE DO PLANO GLOBAL (operador).
 *
 * Ferramenta de operador para o gate live. É o ÚNICO caminho previsto para
 * armar, inspecionar, abrir e fechar o breaker global — e ela usa exatamente
 * as funções auditadas de `globalControl.ts`/`autopilot.ts`, nunca SQL próprio.
 *
 * O que ela NÃO faz:
 *   - não escreve no catálogo (nunca toca Product/Offer/PriceHistory);
 *   - não corta tráfego: armar é o ato explícito que AUTORIZA o V1 a ser o
 *     writer autoritativo daquele marketplaceId, com teto de escritas;
 *   - não dá deploy: o breaker fecha sem novo deploy porque o estado vive
 *     no banco e é lido em TODA aquisição de permissão;
 *   - não promove degrau: `arm --max-writes` é sempre um ato MANUAL. Quem
 *     promove sozinho é o autopilot, e só com evidência real.
 *
 * INVARIANTES (não configuráveis aqui):
 *   - a configuração é por `marketplaceId`; este script não tem nenhuma regra
 *     por nome de marketplace, só repassa o que o operador digita;
 *   - PUBLIC_MULTISTORE_MIN_MARKETPLACES=2 e DRAFT/active=false não são
 *     tocados: o gate decide ATRIBUIÇÃO e ROTA, nunca publicação;
 *   - `CATALOG_V1_GLOBAL_CUTOVER` continua NO: existe rollback, não cutover.
 *
 * Trava dura: sem `--yes`, nada é escrito. `status`, `autopilot-status` e
 * `history` são sempre read-only.
 *
 * Uso:
 *   npx tsx scripts/live-cutover-control.ts status
 *   npx tsx scripts/live-cutover-control.ts autopilot-status
 *   npx tsx scripts/live-cutover-control.ts history --marketplace-id mercado_livre
 *   npx tsx scripts/live-cutover-control.ts arm --marketplace-id mercado_livre \
 *     --mode V1_PRIMARY_WITH_LEGACY_FALLBACK --max-writes 1 --yes
 *   npx tsx scripts/live-cutover-control.ts trip  --marketplace-id mercado_livre \
 *     --reason V1_ERRORS_ABOVE_LIMIT --yes
 *   npx tsx scripts/live-cutover-control.ts close --marketplace-id mercado_livre --yes
 *   npx tsx scripts/live-cutover-control.ts pause   --marketplace-id mercado_livre --yes
 *   npx tsx scripts/live-cutover-control.ts resume  --marketplace-id mercado_livre --yes
 *   npx tsx scripts/live-cutover-control.ts autopilot-run --marketplace-id mercado_livre --yes
 */
import "dotenv/config";

import { Client } from "pg";

import {
  applyOperatorAction,
  AUTOPILOT_LADDER,
  AUTOPILOT_MAX_EVIDENCE_COMMITS,
  AUTOPILOT_MIN_DISTINCT_LISTINGS,
  readAutopilot,
  requiredDistinctListings,
  requiredEvidenceCommits,
  runAutopilotCycle,
  runAutopilotProbes,
  type AutopilotRow,
  type PublicationAudit,
  type StageMetrics,
} from "@/services/architecture/v1/cutover/autopilot";
import { reconcileCatalog } from "@/services/catalog/reconciliation";
import { createPrismaCatalogReconciliationRepository } from "@/services/catalog/reconciliationRepository";
import {
  armGlobalRollout,
  readGlobalRollout,
  resetGlobalBreaker,
  tripGlobalBreaker,
  type CutoverSqlExecutor,
  type GlobalRolloutRow,
} from "@/services/architecture/v1/cutover/globalControl";
import type { CatalogWriterMode } from "@/services/architecture/v1/cutover/policy";

type Args = Record<string, string | boolean>;

function parse(argv: string[]): { sub: string; args: Args } {
  const [sub = "", ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return { sub, args };
}

/**
 * O plano de controle é um recurso de PRODUÇÃO. O alvo vem do ambiente e, se
 * `FASE71_EXPECTED_CONTROL_HOST` estiver definido, a ferramenta RECUSA qualquer
 * outro host — assim ela não pode ser apontada por engano para um banco de
 * desenvolvimento.
 */
function controlUrl(): string {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "";
  if (url === "") {
    throw new Error("CONTROL_URL_MISSING");
  }
  const host = new URL(url).hostname;
  const expected = process.env.FASE71_EXPECTED_CONTROL_HOST;
  if (expected !== undefined && expected !== "" && host !== expected) {
    throw new Error(`CONTROL_HOST_MISMATCH:${host}`);
  }
  return url;
}

type Executor = CutoverSqlExecutor & { close: () => Promise<void> };

/** Uma única conexão: todas as operações do operador são sequenciais. */
async function connect(url: string): Promise<Executor> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return {
    async query<R>(text: string, values: unknown[] = []) {
      const res = await client.query({ text, values });
      return { rows: res.rows as R[], rowCount: res.rowCount };
    },
    async close() {
      await client.end();
    },
  };
}

function show(row: GlobalRolloutRow | null): void {
  if (row === null) {
    console.log("  (nenhum) => este marketplace esta em LEGACY_ONLY");
    return;
  }
  console.log(
    JSON.stringify(
      {
        marketplaceId: row.marketplaceId,
        mode: row.mode,
        enabled: row.enabled,
        legacyFallbackEnabled: row.legacyFallbackEnabled,
        maxWrites: row.maxWrites,
        usedWrites: row.usedWrites,
        restante: Math.max(0, row.maxWrites - row.usedWrites),
        breakerState: row.breakerState,
        breakerReason: row.breakerReason,
        breakerTrippedAt: row.breakerTrippedAt,
        rolloutId: row.id,
      },
      null,
      2,
    ),
  );
}

async function printStatus(executor: Executor): Promise<void> {
  const rollouts = (
    await executor.query<{ "marketplaceId": string }>(
      'SELECT "marketplaceId" FROM "CatalogCutoverRollout" ORDER BY "marketplaceId"',
    )
  ).rows;

  console.log(`rollouts: ${rollouts.length}`);
  for (const { marketplaceId } of rollouts) {
    console.log(`--- ${marketplaceId} ---`);
    show(await readGlobalRollout(executor, marketplaceId));
    showAutopilot(await readAutopilot(executor, marketplaceId));
  }
  if (rollouts.length === 0) {
    console.log("  (nenhum) => todo marketplace esta em LEGACY_ONLY");
  }

  const totals = (
    await executor.query<{ kind: string; total: number }>(
      'SELECT "kind"::text AS "kind", count(*)::int AS "total" FROM "CatalogCutoverEvent" GROUP BY 1 ORDER BY 2 DESC, 1',
    )
  ).rows;
  console.log("eventos:", JSON.stringify(totals));
}

function showAutopilot(row: AutopilotRow | null): void {
  if (row === null) {
    console.log("  autopilot: (nenhum) => progressão automática desligada");
    return;
  }
  console.log(
    JSON.stringify(
      {
        autopilot: {
          state: row.state,
          stage: row.stage,
          enabled: row.enabled,
          version: row.version,
          cooldownUntil: row.cooldownUntil.toISOString(),
          minObservationMs: row.minObservationMs,
          stageStartedAt: row.stageStartedAt.toISOString(),
          lastRunAt: row.lastRunAt?.toISOString() ?? null,
          lastDecision: row.lastDecision,
          lastReason: row.lastReason,
          tripReason: row.tripReason,
          completedAt: row.completedAt?.toISOString() ?? null,
        },
      },
      null,
      2,
    ),
  );
}

/** FASE 7.2: estado da escada + o que ainda falta para o próximo degrau. */
async function printAutopilotStatus(executor: Executor): Promise<void> {
  const rollouts = (
    await executor.query<{ "marketplaceId": string }>(
      'SELECT "marketplaceId" FROM "CatalogCutoverRollout" ORDER BY "marketplaceId"',
    )
  ).rows;

  console.log(
    JSON.stringify(
      {
        escada: AUTOPILOT_LADDER,
        tetoMaxWrites: AUTOPILOT_LADDER[AUTOPILOT_LADDER.length - 1],
        pisoListingsDistintas: AUTOPILOT_MIN_DISTINCT_LISTINGS,
        maxEvidenciaCommits: AUTOPILOT_MAX_EVIDENCE_COMMITS,
        catalogV1GlobalCutover: "NO",
      },
      null,
      2,
    ),
  );

  for (const { marketplaceId } of rollouts) {
    const row = await readAutopilot(executor, marketplaceId);
    const rollout = await readGlobalRollout(executor, marketplaceId);
    console.log(`--- ${marketplaceId} ---`);
    showAutopilot(row);
    if (row === null) {
      continue;
    }
    const metrics = (
      await executor.query<Record<string, unknown>>(
        `SELECT * FROM "CatalogCutoverStageMetric" WHERE "marketplaceId" = $1 ORDER BY "stage"`,
        [marketplaceId],
      )
    ).rows;
    console.log(
      "  evidenciaPorEstagio:",
      JSON.stringify(
        metrics.map((m) => {
          const out: Record<string, unknown> = { stage: m.stage };
          for (const key of [
            "startedAt",
            "completedAt",
            "maxWrites",
            "usedWrites",
            "v1Attempts",
            "v1Committed",
            "v1Noop",
            "fallbackUsed",
            "budgetSkipped",
            "doubleWrites",
            "duplicates",
            "parityMatches",
            "parityDifferences",
            "publicationViolations",
            "policyBlocked",
            "systemErrors",
            "breakerTrips",
            "pathStructural",
            "pathOfferOnly",
            "pathUnknown",
            "uniqueExternalListings",
            "uniqueProducts",
            "uniqueSellers",
            "fastOfferReviewPending",
          ]) {
            out[key] = m[key] instanceof Date ? m[key].toISOString() : m[key];
          }
          return out;
        }),
        null,
        2,
      ),
    );
    console.log(
      "  proximoDegrau:",
      JSON.stringify({
        requiredDistinctListings: requiredDistinctListings(row.stage),
        requiredEvidenceCommits: requiredEvidenceCommits(row.stage),
        tetoDoRollout: rollout?.maxWrites ?? null,
      }),
    );
  }
}

/** FASE 7.2: histórico append-only das decisões do controlador. */
async function printHistory(executor: Executor, marketplaceId: string): Promise<void> {
  const runs = (
    await executor.query<Record<string, unknown>>(
      `SELECT "createdAt", "stateBefore"::text, "stateAfter"::text, "decision"::text,
              "stageBefore", "stageAfter", "maxWrites", "usedWrites",
              "versionBefore", "versionAfter", "promoted", "reason", "blockers",
              "executionId", "metrics"
         FROM "CatalogCutoverAutopilotRun"
        WHERE "marketplaceId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 50`,
      [marketplaceId],
    )
  ).rows;

  console.log(`historico: ${runs.length} execucao(oes) mais recente(s)`);
  for (const run of runs) {
    const createdAt = run.createdAt instanceof Date ? run.createdAt : null;
    console.log(
      `  ${createdAt === null ? "?" : createdAt.toISOString()} ` +
        `${String(run.stateBefore)} -> ${String(run.stateAfter)} ` +
        `[${String(run.decision)}] ` +
        `stage ${String(run.stageBefore)}->${String(run.stageAfter)} ` +
        `maxWrites=${String(run.maxWrites)} usedWrites=${String(run.usedWrites)} ` +
        `v=${String(run.versionBefore)}->${String(run.versionAfter)} ` +
        `promoted=${String(run.promoted)} :: ${String(run.reason ?? "")}`,
    );
    if (run.blockers !== null && run.blockers !== undefined) {
      console.log(`      blockers: ${JSON.stringify(run.blockers)}`);
    }
  }
}

async function main(): Promise<void> {
  const { sub, args } = parse(process.argv.slice(2));
  const url = controlUrl();
  const executor = await connect(url);

  try {
    if (sub === "status") {
      await printStatus(executor);
      return;
    }

    if (sub === "autopilot-status") {
      await printAutopilotStatus(executor);
      return;
    }

    if (sub === "history") {
      const marketplaceId = String(args["marketplace-id"] ?? "");
      if (marketplaceId === "") {
        throw new Error("USAGE: history --marketplace-id <id>");
      }
      await printHistory(executor, marketplaceId);
      return;
    }

    if (args.yes !== true) {
      console.error("ABORTADO: escrita exige --yes. (Use `status` para leitura.)");
      process.exitCode = 1;
      return;
    }

    if (sub === "pause" || sub === "resume") {
      const marketplaceId = String(args["marketplace-id"] ?? "");
      if (marketplaceId === "") {
        throw new Error(
          `USAGE: ${sub} --marketplace-id <id> --yes`,
        );
      }
      const before = await readAutopilot(executor, marketplaceId);
      showAutopilot(before);
      showAutopilot(
        await applyOperatorAction(executor, {
          marketplaceId,
          action: sub,
          reason: typeof args.reason === "string" ? args.reason : null,
        }),
      );
      return;
    }

    /*
     * FASE 7.2 — ciclo manual do controlador. É o MESMO código do cron
     * (nenhum caminho paralelo): ele existe para o operador forçar uma
     * avaliação sob demanda. Sem evidência real, ele só registra WAIT.
     *
     * A auditoria de publicação é o MESMO reconciliador do projeto, em
     * `dryRun: true` — igual ao cron. Uma versão anterior deste script usava
     * um stub `{scanned: 0, violations: 0}`, e isso era um buraco real: um
     * `autopilot-run --yes` promoting com o gate de publicação nunca sequer
     * olhado. "Verde porque ninguém olhou" é a pior forma de verde.
     */
    if (sub === "autopilot-run") {
      const marketplaceId = String(args["marketplace-id"] ?? "");
      if (marketplaceId === "") {
        throw new Error("USAGE: autopilot-run --marketplace-id <id> --yes");
      }
      const dryRun = args["dry-run"] === true;
      const audit: () => Promise<PublicationAudit> = async () => {
        const result = await reconcileCatalog(
          createPrismaCatalogReconciliationRepository(),
          { dryRun: true },
        );
        return {
          scanned: result.scanned,
          violations: result.violations.length,
        };
      };
      /*
       * Sem base não há probe, e a lista fica vazia de propósito: probes são
       * observacionais, então a ausência não muda decisão nenhuma. `--probe-
       * base-url` existe para o operador apontar para a origem que quer ver.
       */
      const origin =
        typeof args["probe-base-url"] === "string"
          ? args["probe-base-url"]
          : (process.env.AUTOPILOT_PROBE_BASE_URL ?? null);
      const probes = await runAutopilotProbes(origin);
      const result = await runAutopilotCycle({
        executor,
        marketplaceId,
        enabled: !dryRun,
        allowMutations: !dryRun,
        publicationAudit: audit,
        probes: async () => probes,
      });
      console.log(
        JSON.stringify(
          {
            marketplaceId: result.marketplaceId,
            state: result.state,
            stage: result.stage,
            decision: result.decision.kind,
            reason: result.decision.reason,
            blockers: result.decision.blockers,
            promoted: result.promoted,
            tripped: result.tripped,
            lostRace: result.lostRace,
            budgetReconciled: result.budgetReconciled,
            rollout: result.rollout,
            skippedReason: result.skippedReason,
            autoActiveWithLt2PublicMarketplaces: result.autoActiveLt2,
            probes,
            metrics: result.metrics as StageMetrics,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (sub === "arm") {
      const marketplaceId = String(args["marketplace-id"] ?? "");
      const mode = String(args.mode ?? "") as CatalogWriterMode;
      const maxWrites = Number(args["max-writes"] ?? 0);
      if (
        marketplaceId === "" ||
        mode === "" ||
        !Number.isInteger(maxWrites) ||
        maxWrites < 1
      ) {
        throw new Error(
          "USAGE: arm --marketplace-id <id> --mode <modo> --max-writes <n> --yes",
        );
      }
      console.log("antes:");
      show(await readGlobalRollout(executor, marketplaceId));
      show(
        await armGlobalRollout(executor, {
          marketplaceId,
          mode,
          enabled: true,
          legacyFallbackEnabled: true,
          maxWrites,
          resetBudget: args["reset-budget"] === true,
          closeBreaker: args["close-breaker"] === true,
          note: typeof args.note === "string" ? args.note : null,
        }),
      );
      return;
    }

    if (sub === "trip" || sub === "close") {
      const marketplaceId = String(args["marketplace-id"] ?? "");
      const before = await readGlobalRollout(executor, marketplaceId);
      console.log("antes:");
      show(before);
      if (before === null) {
        throw new Error("ROLLOUT_ABSENT");
      }
      if (sub === "trip") {
        await tripGlobalBreaker(executor, {
          rolloutId: before.id,
          marketplaceId,
          reason:
            typeof args.reason === "string"
              ? (args.reason as Parameters<typeof tripGlobalBreaker>[1]["reason"])
              : "MANUAL_TRIP",
        });
      } else {
        await resetGlobalBreaker(executor, {
          rolloutId: before.id,
          marketplaceId,
          note: typeof args.reason === "string" ? args.reason : "MANUAL_RESET",
        });
      }
      console.log("depois:");
      show(await readGlobalRollout(executor, marketplaceId));
      return;
    }

    throw new Error(`UNKNOWN_SUBCOMMAND:${sub}`);
  } finally {
    await executor.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
