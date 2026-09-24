/**
 * CATALOG_ARCHITECTURE_V1 — SHADOW REPLAY RUNNER (FASE 5 — CANÁRIO).
 *
 * Reprocessa linhas REAIS de RawMarketplaceListing (lidas do banco) pelo
 * pipeline V1, dentro do orçamento canário (MAX_WRITES 1 -> 5 -> 25 -> 100,
 * UM marketplace por execução), escrevendo SOMENTE:
 *   - RawMarketplaceListing (hashes e/ou rawPayload conforme flags),
 *   - ImportRun/ImportBatch (contadores do próprio replay).
 *
 * NUNCA toca Product/MarketplaceOffer/publicação. Leitura do estado legado de
 * publicação é somente leitura (paridade profunda, mesmo conjunto de ofertas,
 * gate legado vs gate V1).
 *
 * Readiness: CATALOG_V1_CUTOVER_READY=YES exige escrita real exercitada,
 * PUBLICATION_UNEXPLAINED_MISMATCH=0 e V1_MORE_PERMISSIVE_AND_LEGACY=0.
 * Mesmo com YES, o cutover NÃO é autorizado por esta missão.
 */

import {
  aggregateParityVerdicts,
  classifyShadowParity,
  evaluateShadowReadiness,
  type LegacyPublicationOutcome,
  type ParityAggregate,
  type ShadowParityVerdict,
} from "./parityEngine";
import { processShadowListing, type ShadowRunResultV1 } from "./shadowProcessor";
import {
  isUsablePublicOffer,
  countDistinctPublicMarketplaces,
  type PublicOfferLike,
} from "../../../publicVisibility/multiStoreVisibility";
import { evaluatePublicationEligibility } from "../publication/publicationEligibility";
import { startImportRun } from "../ingestion/importRun";
import type { RunTotalsV1 } from "../ingestion/importRun";
import { readShadowFlags, type ShadowFlags } from "./flags";
import { getShadowMetrics, type ShadowMetrics } from "./metrics";
import {
  createInMemoryImportRunRepository,
  createInMemoryRawListingRepository,
  createPrismaShadowRepositories,
  readLegacyPublicationFromPrisma,
  type ShadowPrismaClient,
  type ShadowRepositoryBundle,
} from "./repository";
import type { LegacyShadowRawRow } from "./adapter";

export const SHADOW_REPLAY_SOURCE = "cat-shadow-replay";

export type ShadowReplayOptions = {
  /** UM marketplace por execução (canário). */
  marketplaceId: string;
  /** Teto de linhas processadas/escritas nesta execução (1 -> 5 -> 25 -> 100). */
  maxWrites: number;
  /** Override das flags (testes); default = ambiente. */
  flags?: ShadowFlags;
  /** Linhas de entrada injetável (testes); default = leitura real da tabela. */
  sourceRows?: LegacyShadowRawRow[];
};

export type ShadowReplayDeps = {
  /** Repos Prisma reais. Default: cria a partir de `prisma` (se fornecido). */
  prisma?: ShadowPrismaClient;
  repos?: ShadowRepositoryBundle;
  metrics?: ShadowMetrics;
  /** Leitura read-only do estado legado (testes injetam stub). */
  readLegacyPublication?: (
    canonicalProductId: string,
  ) => Promise<LegacyPublicationOutcome | null>;
};

export type ShadowReplayParityRecord = {
  canonicalProductId: string;
  legacy: LegacyPublicationOutcome;
  v1Eligible: boolean;
  v1ReasonCodes: string[];
  verdict: ShadowParityVerdict;
};

export type ShadowReplayResultV1 = {
  marketplaceId: string;
  flags: ShadowFlags;
  dryRun: boolean;
  blocked: boolean;
  blockedReason: string | null;
  rows: ShadowRunResultV1[];
  processed: number;
  realWrites: number;
  totals: RunTotalsV1;
  parityVerdicts: ShadowReplayParityRecord[];
  parity: ParityAggregate;
  readiness: { ready: boolean; reasonCodes: string[] };
  runId: string | null;
};

function emptyTotals(): RunTotalsV1 {
  return { received: 0, changed: 0, unchanged: 0, rejected: 0, failed: 0 };
}

/**
 * Executa um replay canário shadow para UM marketplace.
 * Fail-closed: qualquer pré-condição ausente => resultado blocked, zero
 * escritas.
 */
export async function runShadowReplay(
  deps: ShadowReplayDeps,
  options: ShadowReplayOptions,
): Promise<ShadowReplayResultV1> {
  const flags = options.flags ?? readShadowFlags();
  const metrics = deps.metrics ?? getShadowMetrics();
  const marketplaceId = options.marketplaceId.trim().toLowerCase();
  const maxWrites = Math.max(0, options.maxWrites);

  const wouldWrite =
    !flags.dryRun && (flags.persistRaw || flags.persistHashes);

  const result: ShadowReplayResultV1 = {
    marketplaceId,
    flags,
    dryRun: flags.dryRun,
    blocked: false,
    blockedReason: null,
    rows: [],
    processed: 0,
    realWrites: 0,
    totals: emptyTotals(),
    parityVerdicts: [],
    parity: aggregateParityVerdicts([]),
    readiness: { ready: false, reasonCodes: ["NO_REAL_SHADOW_WRITES"] },
    runId: null,
  };

  // Fail-closed: replay só é legítimo com flag ligada + marketplace na
  // allowlist + orçamento > 0.
  if (!flags.enabled) {
    result.blocked = true;
    result.blockedReason = "shadow-disabled";
    result.readiness.reasonCodes = ["SHADOW_DISABLED"];
    return result;
  }
  if (!flags.marketplaceIds.includes(marketplaceId)) {
    result.blocked = true;
    result.blockedReason = "marketplace-not-in-allowlist";
    result.readiness.reasonCodes = ["MARKETPLACE_NOT_IN_ALLOWLIST"];
    return result;
  }
  if (maxWrites < 1) {
    result.blocked = true;
    result.blockedReason = "max-writes-zero";
    result.readiness.reasonCodes = ["MAX_WRITES_ZERO"];
    return result;
  }

  const repos: ShadowRepositoryBundle =
    deps.repos ??
    (deps.prisma
      ? createPrismaShadowRepositories(deps.prisma, {
          persistRaw: flags.persistRaw,
          persistHashes: flags.persistHashes,
        })
      : {
          raw: createInMemoryRawListingRepository(),
          importRun: createInMemoryImportRunRepository(),
        });

  const rows =
    options.sourceRows ?? (await repos.raw.listRawRows(marketplaceId, maxWrites));

  let run: Awaited<ReturnType<typeof startImportRun>> | null = null;
  if (wouldWrite) {
    try {
      run = await startImportRun(repos.importRun, {
        source: SHADOW_REPLAY_SOURCE,
        marketplaceId,
        mode: "REPROCESS",
      });
      result.runId = run.run.id;
    } catch (error) {
      result.blocked = true;
      result.blockedReason = "import-run-start-failed";
      result.readiness.reasonCodes = [
        `IMPORT_RUN_START_FAILED:${error instanceof Error ? error.message : String(error)}`,
      ];
      return result;
    }
  }

  const canonicalProductIds = new Set<string>();
  const seenRowKeys = new Set<string>();

  try {
    for (const row of rows) {
      const rowKey = `${row.marketplace}:${row.externalId}`;
      if (seenRowKeys.has(rowKey)) {
        // Idempotência: a MESMA chave não é processada duas vezes no run.
        result.totals.unchanged += 1;
        continue;
      }
      seenRowKeys.add(rowKey);

      const rowResult = await processShadowListing(
        {
          flags,
          metrics,
          realRepos: wouldWrite ? repos : undefined,
          runParity: false,
        },
        {
          marketplace: row.marketplace,
          externalId: row.externalId,
          sourceUrl: row.sourceUrl ?? "",
          title: row.title ?? null,
          price: row.price ?? null,
          oldPrice: row.oldPrice ?? null,
          stock: row.stock ?? null,
          available: row.available ?? null,
          brand: row.brand ?? null,
          category: row.category ?? null,
          image: row.image ?? null,
          attributes: row.attributes ?? null,
          canonicalProductId: row.canonicalProductId ?? null,
          legacyOutcome: { autoCreated: true, active: false },
          partialView: false,
          rawPayloadOverride: { source: "raw-marketplace-listing", row },
        },
      );

      result.rows.push(rowResult);
      result.processed += 1;

      if (rowResult.error) {
        result.totals.failed += 1;
        continue;
      }
      if (rowResult.skippedReason !== null) {
        result.totals.rejected += 1;
        continue;
      }
      if (wouldWrite && (rowResult.wroteRaw || rowResult.wroteHashes)) {
        result.realWrites += 1;
      }
      result.totals.received += 1;
      if (rowResult.path === "NOOP") {
        result.totals.unchanged += 1;
      } else {
        result.totals.changed += 1;
      }

      if (row.canonicalProductId) {
        canonicalProductIds.add(row.canonicalProductId);
      }
    }

    // Paridade PROFUNDA: gate legado vs gate V1 sobre o MESMO conjunto de
    // ofertas reais (leitura read-only). partialView=false (visão completa).
    const prismaClient = deps.prisma;
    const reader =
      deps.readLegacyPublication ??
      (prismaClient
        ? (id: string) => readLegacyPublicationFromPrisma(prismaClient, id)
        : () => Promise.resolve(null));

    for (const productId of canonicalProductIds) {
      const legacy = await reader(productId);
      if (!legacy) {
        continue;
      }
      const offers = legacy.offers ?? [];
      const v1 = evaluatePublicationEligibility({
        autoCreated: legacy.autoCreated,
        offers: offers as PublicOfferLike[],
      });
      const verdict = classifyShadowParity({
        legacy: {
          autoCreated: legacy.autoCreated,
          active: legacy.active,
          publicationStatus: legacy.publicationStatus,
          distinctPublicMarketplaces: countDistinctPublicMarketplaces(
            offers as PublicOfferLike[],
          ),
          validOfferCount: offers.filter(isUsablePublicOffer).length,
          offers,
        },
        v1Eligible: v1.eligible,
        v1ReasonCodes: v1.reasonCodes,
        partialView: false,
      });
      result.parityVerdicts.push({
        canonicalProductId: productId,
        legacy: {
          ...legacy,
          distinctPublicMarketplaces: countDistinctPublicMarketplaces(
            offers as PublicOfferLike[],
          ),
          validOfferCount: offers.filter(isUsablePublicOffer).length,
        },
        v1Eligible: v1.eligible,
        v1ReasonCodes: v1.reasonCodes,
        verdict,
      });

      if (verdict.code === "PARITY_MATCH") {
        metrics.incParityMatch();
      } else if (verdict.v1MorePermissiveThanLegacy) {
        metrics.incParityV1MorePermissive();
      } else if (verdict.unexpectedMismatch) {
        metrics.incParityUnexpectedMismatch();
      } else if (verdict.code === "SKIP_PARTIAL_VIEW") {
        metrics.incParitySkipPartialView();
      }
    }

    if (run) {
      const status =
        result.totals.failed > 0 && result.totals.received > 0
          ? "PARTIAL"
          : "COMPLETED";
      await repos.importRun.completeRun(run.run.id, result.totals, {
        status,
      });
      if (run.batch) {
        await repos.importRun.completeBatch(run.run.id, run.batch.index, {
          received: result.totals.received,
          changed: result.totals.changed,
          unchanged: result.totals.unchanged,
          rejected: result.totals.rejected,
          failed: result.totals.failed,
        });
      }
    }
  } catch (error) {
    if (run) {
      try {
        await repos.importRun.failRun(
          run.run.id,
          error instanceof Error ? error.message : String(error),
        );
      } catch {
        /* falha ao registrar falha não pode mascarar o erro original */
      }
    }
    throw error;
  }

  result.parity = aggregateParityVerdicts(
    result.parityVerdicts.map((record) => record.verdict),
  );

  const metricsSnapshot = metrics.snapshot();
  result.readiness = evaluateShadowReadiness({
    realWrites: metricsSnapshot.writeSuccess,
    unexpectedMismatch: result.parity.unexpectedMismatch,
    v1MorePermissiveThanLegacy: result.parity.v1MorePermissiveThanLegacy,
    writeFailed: metricsSnapshot.writeFailed,
  });

  return result;
}

/** Próximo passo do canário progressivo (1 -> 5 -> 25 -> 100). */
export function nextShadowCanaryStage(
  currentMaxWrites: number,
  progression: readonly number[] = [1, 5, 25, 100],
): number | null {
  for (const stage of progression) {
    if (stage > currentMaxWrites) return stage;
  }
  return null;
}

/**
 * Gera o relatório markdown de readiness (docs/architecture/CATALOG_V1_SHADOW_REPORT.md).
 * CATALOG_V1_CUTOVER_READY=YES|NO. Mesmo com YES, o cutover NÃO é executado
 * por esta missão.
 */
export function buildShadowReadinessReport(input: {
  result: ShadowReplayResultV1;
  stage: number;
  nextStage: number | null;
  evidence?: Record<string, string>;
}): string {
  const { result, stage, nextStage, evidence = {} } = input;
  const ready = result.readiness.ready ? "YES" : "NO";
  const evidenceLines = Object.entries(evidence)
    .map(([key, value]) => `- \`${key}\`: ${value}`)
    .join("\n");

  return `# CATALOG V1 — SHADOW REAL + DUAL-WRITE CONTROLADO + PROVA DE PARIDADE

> Gerado pelo replay canário (\`${SHADOW_REPLAY_SOURCE}\`).
> Esta missão NÃO executa cutover, NÃO desliga o legado e NÃO publica nada.

## Readiness

\`\`\`
CATALOG_V1_CUTOVER_READY=${ready}
\`\`\`

${ready === "YES" ? "**Atenção:** YES habilita apenas a DECISÃO de agendar o cutover em uma missão futura. O cutover NÃO foi e NÃO será executado aqui.**" : ""}

- Reason codes: ${result.readiness.reasonCodes.length > 0 ? result.readiness.reasonCodes.map((code) => `\`${code}\``).join(", ") : "_nenhum_"}

## Configuração desta execução

| Campo | Valor |
| --- | --- |
| Marketplace | \`${result.marketplaceId}\` |
| MAX_WRITES (estágio canário) | ${stage} |
| Próximo estágio | ${nextStage ?? "_último (100)_"} |
| DRY_RUN | ${result.dryRun} |
| PERSIST_RAW | ${result.flags.persistRaw} |
| PERSIST_HASHES | ${result.flags.persistHashes} |
| Bloqueado | ${result.blocked ? `\`${result.blockedReason}\`` : "não"} |

## Volume

| Métrica | Valor |
| --- | --- |
| Linhas processadas | ${result.processed} |
| Escritas reais (RAW/hashes) | ${result.realWrites} |
| ImportRun | ${result.runId ?? "_dry-run (sem run)_"} |
| received / changed / unchanged | ${result.totals.received} / ${result.totals.changed} / ${result.totals.unchanged} |
| rejected / failed | ${result.totals.rejected} / ${result.totals.failed} |

## Paridade (gate legado vs gate V1, MESMO conjunto de ofertas)

| Classe | Valor |
| --- | --- |
| Total comparado | ${result.parity.total} |
| PARITY_MATCH | ${result.parity.match} |
| V1_MORE_PERMISSIVE_THAN_LEGACY | ${result.parity.v1MorePermissiveThanLegacy} |
| PUBLICATION_UNEXPLAINED_MISMATCH | ${result.parity.unexpectedMismatch} |
| Explicados | ${result.parity.explained} |
| SKIP_PARTIAL_VIEW | ${result.parity.skippedPartialView} |

Invariantes exigidos:

- \`PUBLICATION_UNEXPLAINED_MISMATCH\` = ${result.parity.unexpectedMismatch} ${result.parity.unexpectedMismatch === 0 ? "(OK)" : "**(VIOLAÇÃO — bloqueia readiness)**"}
- \`V1_MORE_PERMISSIVE_THAN_LEGACY\` = ${result.parity.v1MorePermissiveThanLegacy} ${result.parity.v1MorePermissiveThanLegacy === 0 ? "(OK)" : "**(VIOLAÇÃO — bloqueia readiness)**"}

## Evidências

${evidenceLines || "_não registradas nesta execução_"}

## Limites desta missão (NÃO fazer)

- NENHUM cutover, mesmo com \`CATALOG_V1_CUTOVER_READY=YES\`.
- Nenhuma escrita fora de \`RawMarketplaceListing\`, \`ImportRun\`/\`ImportBatch\`.
- Nenhum DELETE/DROP, nenhum force push, nenhum backfill global de hashes.
- Canário: 1 marketplace por vez, MAX_WRITES na progressão 1 -> 5 -> 25 -> 100.
- \`PUBLIC_MULTISTORE_MIN_MARKETPLACES\` permanece 2; legado permanece autoritativo.
`;
}