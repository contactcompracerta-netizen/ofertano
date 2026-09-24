/**
 * CATALOG_ARCHITECTURE_V1 — AUTHORITATIVE CANARY RUNNER (FASE 7).
 *
 * Executa o replay canário do CUTOVER (1 marketplace por execução,
 * concurrency=1, MAX_WRITES na progressão 1 -> 5 -> 25 -> 100) com o V1
 * como WRITER AUTORITATIVO no marketplace:
 *
 *   - PROCESS_LOCAL: orçamento de escrita = `maxWrites` (esgotado =>
 *     skip fail-closed das linhas seguintes);
 *   - single-write ownership (FASE D): V1 commitado => legacy NÃO escreve;
 *   - fallback controlado (FASE G): apenas falha pré-commit elegível;
 *   - publication gate (FASE O): autoCreated exige >=2 marketplaces
 *     públicos; 1 marketplace => produto permanece DRAFT/inativo;
 *   - breaker (FASE P) + métricas FASE Q por marketplaceId;
 *   - idempotência (FASE E): retry da MESMA row => NOOP (hashes atuais);
 *   - ImportRun/ImportBatch registram a execução.
 *
 * FAIL-CLOSED: flags OFF, marketplace fora da allowlist, modo não
 * autoritativo, orçamento zero ou cutover global => resultado blocked,
 * ZERO writes autoritativos.
 */

import type { ShadowPrismaClient } from "../shadow/repository";
import {
  createInMemoryImportRunRepository,
  createInMemoryRawListingRepository,
  createPrismaShadowRepositories,
  type ShadowRepositoryBundle,
} from "../shadow/repository";
import { buildShadowListingFromRawRow } from "../shadow/adapter";
import type { LegacyShadowRawRow } from "../shadow/adapter";
import { startImportRun } from "../ingestion/importRun";
import type { RunTotalsV1 } from "../ingestion/importRun";
import { isGlobalCutoverRequested, readAuthoritativeFlags } from "./flags";
import type { AuthoritativeFlags } from "./flags";
import { readCatalogWriterPolicy } from "./policy";
import type { CatalogWriterMode, CatalogWriterPolicy } from "./policy";
import { isV1AuthoritativeMode, resolveCatalogWriterMode } from "./policy";
import { getCutoverBreaker } from "./breaker";
import type { CutoverBreaker, CutoverBreakerReason } from "./breaker";
import { getCutoverMetrics } from "./metrics";
import type { CutoverMetrics, CutoverMetricsSnapshot } from "./metrics";
import {
  processAuthoritativeListing,
  type AuthoritativeListingInput,
  type AuthoritativeWriteResult,
} from "./writer";
import type { RealAuthoritativeCommits } from "./commits";
import { createRealAuthoritativeCommits } from "./commits";
import type { HashPairV1 } from "../hashing";

export const AUTHORITATIVE_REPLAY_SOURCE = "cat-authoritative-replay";

export type AuthoritativeCanaryResultV1 = {
  marketplaceId: string;
  mode: CatalogWriterMode;
  flags: AuthoritativeFlags;
  blocked: boolean;
  blockedReason: string | null;
  rows: AuthoritativeWriteResult[];
  processed: number;
  /** Writes V1 autoritativos commitados (single-write; legacy não escreveu). */
  realWrites: number;
  legacyFallbackCount: number;
  noWriteCount: number;
  modeNotAuthoritativeCount: number;
  listingInvalidCount: number;
  budgetSkippedCount: number;
  totals: RunTotalsV1;
  parity: {
    match: number;
    difference: number;
    totalComparable: number;
  };
  metrics: CutoverMetricsSnapshot;
  breaker:
    | { tripped: false; reason: null; trippedAt: null }
    | { tripped: true; reason: CutoverBreakerReason; trippedAt: string };
  readiness: { ready: boolean; reasonCodes: string[] };
  runId: string | null;
};

type AuthoritativeRunnerDeps = {
  flags?: AuthoritativeFlags;
  policy?: CatalogWriterPolicy;
  metrics?: CutoverMetrics;
  breaker?: CutoverBreaker;
  repos?: ShadowRepositoryBundle;
  /** Commits reais (Prisma) — injetáveis nos testes. */
  commits?: RealAuthoritativeCommits;
  /** Verificação de publicação pós-commit (paridade FASE O). */
  verifyPublication?: (
    productId: string,
  ) => Promise<{
    publicMarketplaceCount: number;
    autoCreated: boolean;
    active: boolean;
    publicationStatus: string | null;
    violation: boolean;
  }>;
  prisma?: ShadowPrismaClient;
};

export type AuthoritativeCanaryOptions = {
  marketplaceId: string;
  /** Orçamento da execução (grades canário). Default: lido das flags. */
  maxWrites?: number;
  /** Livre para overrides em teste. Default: lido do env/policy. */
  mode?: CatalogWriterMode;
  /** Livre para injetar rows (testes). Default: banc urlagado/Prisma. */
  sourceRows?: LegacyShadowRawRow[];
  /** Resolve marketplaceId a partir do enum legado (teste/padrão). */
  resolveMarketplaceId?: (legacyEnum: string) => string | null;
};

export function emptyRunTotals(): RunTotalsV1 {
  return { received: 0, changed: 0, unchanged: 0, rejected: 0, failed: 0 };
}

function rowToAuthoritativeInput(row: LegacyShadowRawRow): AuthoritativeListingInput {
  return {
    marketplace: row.marketplace,
    externalId: row.externalId,
    sourceUrl: row.sourceUrl,
    title: row.title,
    brand: row.brand,
    category: row.category,
    image: row.image,
    price: row.price,
    oldPrice: row.oldPrice,
    stock: row.stock,
    available: row.available,
    attributes: row.attributes,
    canonicalProductId: row.canonicalProductId,
  };
}

/**
 * Executa o canário autoritativo do cutover para UM marketplace.
 * Fail-closed: qualquer pré-condição ausente => blocked, zero writes.
 */
export async function runAuthoritativeCanary(
  deps: AuthoritativeRunnerDeps,
  options: AuthoritativeCanaryOptions,
): Promise<AuthoritativeCanaryResultV1> {
  const flags = deps.flags ?? readAuthoritativeFlags();
  const policy = deps.policy ?? readCatalogWriterPolicy();
  const metrics = deps.metrics ?? getCutoverMetrics();
  const breaker = deps.breaker ?? getCutoverBreaker();
  const marketplaceId = options.marketplaceId.trim().toLowerCase();
  const maxWrites = Math.max(0, options.maxWrites ?? flags.maxWrites);

  const mode =
    options.mode ?? resolveCatalogWriterMode(policy, marketplaceId);

  const result: AuthoritativeCanaryResultV1 = {
    marketplaceId,
    mode,
    flags,
    blocked: false,
    blockedReason: null,
    rows: [],
    processed: 0,
    realWrites: 0,
    legacyFallbackCount: 0,
    noWriteCount: 0,
    modeNotAuthoritativeCount: 0,
    listingInvalidCount: 0,
    budgetSkippedCount: 0,
    totals: emptyRunTotals(),
    parity: { match: 0, difference: 0, totalComparable: 0 },
    metrics: metrics.snapshot(),
    breaker: breaker.state() as AuthoritativeCanaryResultV1["breaker"],
    readiness: { ready: false, reasonCodes: ["NO_AUTHORITATIVE_PREFLIGHT"] },
    runId: null,
  };

  // Fail-closed #1: cutover GLOBAL é proibido.
  if (isGlobalCutoverRequested()) {
    result.blocked = true;
    result.blockedReason = "cutover-global-proibido";
    result.readiness = {
      ready: false,
      reasonCodes: ["GLOBAL_CUTOVER_FORBIDDEN"],
    };
    return result;
  }

  // Fail-closed #2: flags OFF.
  if (!flags.enabled) {
    result.blocked = true;
    result.blockedReason = "flags-autoritativas-desabilitadas";
    result.readiness = {
      ready: false,
      reasonCodes: ["AUTHORITATIVE_FLAGS_DISABLED"],
    };
    return result;
  }

  // Fail-closed #3: marketplace fora da allowlist (source-scoped).
  if (!flags.marketplaceIds.includes(marketplaceId)) {
    result.blocked = true;
    result.blockedReason = "marketplace-fora-do-allowlist";
    result.readiness = {
      ready: false,
      reasonCodes: ["MARKETPLACE_NOT_IN_ALLOWLIST"],
    };
    return result;
  }

  // Fail-closed #4: modo autoritativo exigido.
  if (!isV1AuthoritativeMode(mode)) {
    result.blocked = true;
    result.blockedReason = `mode-${mode}-nao-autoritativo`;
    result.readiness = {
      ready: false,
      reasonCodes: [`MODE_NOT_AUTHORITATIVE:${mode}`],
    };
    return result;
  }

  // Fail-closed #5: orçamento > 0 é pré-condição para escrever.
  if (maxWrites < 1) {
    result.blocked = true;
    result.blockedReason = "max-writes-zero";
    result.readiness = {
      ready: false,
      reasonCodes: ["MAX_WRITES_ZERO"],
    };
    return result;
  }

  const repos: ShadowRepositoryBundle =
    deps.repos ??
    (deps.prisma
      ? createPrismaShadowRepositories(deps.prisma, {
          persistRaw: false,
          persistHashes: true,
        })
      : {
          raw: createInMemoryRawListingRepository(),
          importRun: createInMemoryImportRunRepository(),
        });

  const commits: RealAuthoritativeCommits =
    deps.commits ??
    (deps.prisma
      ? createRealAuthoritativeCommits(deps.prisma as never)
      : {
          async commitV1Structural() {
            return { productId: null };
          },
          async commitV1FastOffer() {
            return { productId: null };
          },
          async legacyWrite() {
            return { productId: null };
          },
        });

  const rows =
    options.sourceRows ??
    (await repos.raw.listRawRows(marketplaceId, 200));

  let importedRun: Awaited<ReturnType<typeof startImportRun>> | null = null;
  try {
    importedRun = await startImportRun(repos.importRun, {
      source: AUTHORITATIVE_REPLAY_SOURCE,
      marketplaceId,
      mode: "REPROCESS",
    });
    result.runId = importedRun.run.id;
  } catch (error) {
    result.blocked = true;
    result.blockedReason = "import-run-start-failed";
    result.readiness = {
      ready: false,
      reasonCodes: [
        `IMPORT_RUN_START_FAILED:${error instanceof Error ? error.message : String(error)}`,
      ],
    };
    return result;
  }

  let consumedWrites = 0;
  const seenRowKeys = new Set<string>();

  try {
    for (const row of rows) {
      const rowKey = `${row.marketplace}:${row.externalId}`;
      if (seenRowKeys.has(rowKey)) {
        // Idempotência: MESMA chave não é processada duas vezes no run.
        result.totals.unchanged += 1;
        continue;
      }
      seenRowKeys.add(rowKey);

      const input = rowToAuthoritativeInput(row);
      const rowResult = await processAuthoritativeListing(
        {
          flags,
          policy,
          metrics,
          breaker,
          buildListing: (authoritative) => {
            // Converte o input autoritativo de volta para a forma que o
            // adapter shadow sabe construir (replay de rows reais).
            const legacyRow: LegacyShadowRawRow = {
              marketplace: authoritative.marketplace,
              externalId: authoritative.externalId,
              sellerId: null,
              sellerName: null,
              sourceUrl: authoritative.sourceUrl ?? null,
              affiliateLink: null,
              title: authoritative.title ?? null,
              brand: authoritative.brand ?? null,
              modelNumber: null,
              ean: null,
              gtin: null,
              mpn: null,
              category: authoritative.category ?? null,
              attributes:
                (authoritative.attributes as Record<string, string> | null) ??
                null,
              image: authoritative.image ?? null,
              price: authoritative.price ?? 0,
              oldPrice: authoritative.oldPrice ?? null,
              stock: authoritative.stock ?? null,
              available: authoritative.available ?? false,
              canonicalProductId: authoritative.canonicalProductId ?? null,
            };
            return buildShadowListingFromRawRow(legacyRow);
          },
          readRow: async (marketplace, externalId) =>
            repos.raw.findListing({
              marketplaceId: marketplace,
              externalListingId: externalId,
            }),
          persistHashes: async (marketplace, externalId, hashes: HashPairV1) =>
            repos.raw.updateHashes(
              {
                marketplaceId: marketplace,
                externalListingId: externalId,
              },
              hashes,
            ),
          commitV1Structural: (ctx) => commits.commitV1Structural(ctx),
          commitV1FastOffer: (ctx) => commits.commitV1FastOffer(ctx),
          legacyWrite: (ctx) => commits.legacyWrite(ctx),
          maxWrites,
          consumedWrites: () => consumedWrites,
          rawPayload: (authoritative) => ({
            source: "raw-marketplace-listing",
            row: authoritative,
          }),
        },
        input,
      );

      result.rows.push(rowResult);
      result.processed += 1;

      if (rowResult.outcome === "V1_COMMITTED") {
        result.realWrites += 1;
        consumedWrites += 1;
        result.totals.changed += 1;
      } else if (rowResult.outcome === "LEGACY_FALLBACK_COMMITTED") {
        result.legacyFallbackCount += 1;
        consumedWrites += 1;
        result.totals.changed += 1;
      } else if (rowResult.outcome === "NO_WRITE") {
        result.noWriteCount += 1;
        if (rowResult.path === "NOOP") {
          result.totals.unchanged += 1;
        } else {
          result.totals.rejected += 1;
        }
      } else if (rowResult.outcome === "BUDGET_SKIPPED") {
        result.budgetSkippedCount += 1;
        result.totals.rejected += 1;
      } else if (rowResult.outcome === "MODE_NOT_AUTHORITATIVE") {
        result.modeNotAuthoritativeCount += 1;
        result.totals.rejected += 1;
      } else if (rowResult.outcome === "LISTING_INVALID") {
        result.listingInvalidCount += 1;
        result.totals.rejected += 1;
      }

      result.totals.received += 1;
    }

    // FASE Q: paridade de publicação quando o V1 commitou um produto.
    for (const rowResult of result.rows) {
      if (
        rowResult.outcome === "V1_COMMITTED" &&
        rowResult.productId &&
        deps.verifyPublication
      ) {
        const publication = await deps.verifyPublication(rowResult.productId);
        result.parity.totalComparable += 1;
        if (publication.violation) {
          result.parity.difference += 1;
          metrics.incParityDifference(marketplaceId);
        } else {
          result.parity.match += 1;
          metrics.incParityMatch(marketplaceId);
        }
      }
    }

    if (importedRun) {
      const status =
        result.totals.failed > 0 && result.totals.received > 0
          ? "PARTIAL"
          : "COMPLETED";
      await repos.importRun.completeRun(importedRun.run.id, result.totals, {
        status,
      });
      if (importedRun.batch) {
        await repos.importRun.completeBatch(
          importedRun.run.id,
          importedRun.batch.index,
          {
            received: result.totals.received,
            changed: result.totals.changed,
            unchanged: result.totals.unchanged,
            rejected: result.totals.rejected,
            failed: result.totals.failed,
          },
        );
      }
    }
  } catch (error) {
    if (importedRun) {
      try {
        await repos.importRun.failRun(
          importedRun.run.id,
          error instanceof Error ? error.message : String(error),
        );
      } catch {
        /* não mascarar o erro original */
      }
    }
    throw error;
  }

  const metricsSnapshot = metrics.snapshot();
  result.metrics = metricsSnapshot;

  const counters = metricsSnapshot.byMarketplace[marketplaceId];
  const v1Failures = counters?.v1_authoritative_failure_total ?? 0;

  // Breaker automático (FASE P) — duplicatas/violações/paridade inesperada
  // acima de zero + erros V1 acima do limite seguro.
  const breakerReason = breaker.evaluate({
    v1Failures,
    duplicates: 0,
    publicationViolations: result.parity.difference,
    parityDifferencesUnexpected: result.parity.difference,
    writeBudgetExceeded: 0 /* nunca escrevemos além do orçamento */,
    identityCorruption: false,
  });
  result.breaker = breaker.state() as AuthoritativeCanaryResultV1["breaker"];

  if (breakerReason) {
    result.readiness = {
      ready: false,
      reasonCodes: [`BREAKER:${breakerReason}`],
    };
    return result;
  }

  const ready = result.realWrites > 0;
  const reasonCodes: string[] = [];
  if (!ready) {
    reasonCodes.push(
      result.processed === 0
        ? "NO_ROWS_AVAILABLE"
        : "NO_AUTHORITATIVE_WRITES",
    );
    if (result.legacyFallbackCount > 0) {
      reasonCodes.push("LEGACY_FALLBACK_USED");
    }
    if (result.budgetSkippedCount > 0) {
      reasonCodes.push("BUDGET_SKIPPED");
    }
  }
  result.readiness = { ready, reasonCodes };

  return result;
}

/** Próximo estágio do canário progressivo (1 -> 5 -> 25 -> 100). */
export function nextAuthoritativeCanaryStage(
  currentMaxWrites: number,
  progression: readonly number[] = [1, 5, 25, 100],
): number | null {
  for (const stage of progression) {
    if (stage > currentMaxWrites) return stage;
  }
  return null;
}

/**
 * Gera o relatório markdown do canário autoritativo
 * (docs/architecture/CATALOG_V1_AUTHORITATIVE_CANARY_REPORT.md).
 */
export function buildAuthoritativeCanaryReport(input: {
  result: AuthoritativeCanaryResultV1;
  stage: number;
  nextStage: number | null;
  evidence?: Record<string, string>;
  baseSha?: string | null;
  finalSha?: string | null;
}): string {
  const { result, stage, nextStage, evidence = {} } = input;
  const ready = result.readiness.ready ? "YES" : "NO";
  const evidenceLines = Object.entries(evidence)
    .map(([key, value]) => `- \`${key}\`: ${value}`)
    .join("\n");
  const counters = result.metrics.byMarketplace[result.marketplaceId];
  const c = counters;
  const metricsTable = c
    ? `| v1_authoritative_attempt_total | ${c.v1_authoritative_attempt_total} |
| v1_authoritative_success_total | ${c.v1_authoritative_success_total} |
| v1_authoritative_failure_total | ${c.v1_authoritative_failure_total} |
| legacy_fallback_total | ${c.legacy_fallback_total} |
| legacy_fallback_success_total | ${c.legacy_fallback_success_total} |
| authoritative_parity_match_total | ${c.authoritative_parity_match_total} |
| authoritative_parity_difference_total | ${c.authoritative_parity_difference_total} |
| cutover_breaker_total | ${c.cutover_breaker_total} |
| cutover_write_budget_skipped_total | ${c.cutover_write_budget_skipped_total} |`
    : "_sem métricas registradas para este marketplace_";

  return `# CATALOG V1 — CANÁRIO AUTORITATIVO (CUTOVER PROGRESSIVO, FASE 7)

> Gerado pelo replay autoritativo (\`${AUTHORITATIVE_REPLAY_SOURCE}\`).
> O cutover é SOURCE-SCOPED (por marketplaceId) e PROGRESSIVO (MAX_WRITES 1 -> 5 -> 25 -> 100, concurrency=1).
> Cutover GLOBAL é PROIBIDO (\`CATALOG_V1_GLOBAL_CUTOVER=NO\`).

## Estado do run

\`\`\`
FASE_7_STATUS=${result.blocked ? "BLOCKED" : ready === "YES" ? "PASS" : "PARTIAL"}
AUTHORITATIVE_READY=${ready}
\`\`\`

- Bloqueado: ${result.blocked ? `\`${result.blockedReason}\`` : "não"}
- Reason codes: ${result.readiness.reasonCodes.length > 0 ? result.readiness.reasonCodes.map((code) => `\`${code}\``).join(", ") : "_nenhum_"}

## Configuração desta execução

| Campo | Valor |
| --- | --- |
| Marketplace | \`${result.marketplaceId}\` |
| Writer mode | \`${result.mode}\` |
| MAX_WRITES (estágio) | ${stage} |
| Próximo estágio | ${nextStage ?? "_último (100)_"} |
| Flags enabled | \`${result.flags.enabled}\` |
| Legacy fallback habilitado | \`${result.flags.legacyFallbackEnabled}\` |
| ImportRun | ${result.runId ?? "_não iniciado_"} |
| Base SHA | ${input.baseSha ?? "_n/d_"} |
| Final SHA | ${input.finalSha ?? "_n/d_"} |

## Volume

| Métrica | Valor |
| --- | --- |
| Rows processadas | ${result.processed} |
| V1 committed (writes autoritativos reais) | ${result.realWrites} |
| Legacy fallback committed | ${result.legacyFallbackCount} |
| NO_WRITE (idempotente/fluxo) | ${result.noWriteCount} |
| BUDGET_SKIPPED (orçamento esgotado, fail-closed) | ${result.budgetSkippedCount} |
| MODE_NOT_AUTHORITATIVE | ${result.modeNotAuthoritativeCount} |
| LISTING_INVALID | ${result.listingInvalidCount} |
| received / changed / unchanged | ${result.totals.received} / ${result.totals.changed} / ${result.totals.unchanged} |
| rejected / failed | ${result.totals.rejected} / ${result.totals.failed} |

## Paridade de publicação (FASE O — single-store oculto)

| Classe | Valor |
| --- | --- |
| Total comparado | ${result.parity.totalComparable} |
| PARITY_MATCH | ${result.parity.match} |
| PARITY_DIFFERENCE | ${result.parity.difference} |

Invariante: \`AUTO_ACTIVE_LT2=0\` (produto autoCreated com 1 marketplace NUNCA fica ativo/público). Violação trip o breaker.

## Métricas FASE Q (por marketplaceId)

${metricsTable}

## Breaker (FASE P)

- Tripped: ${result.breaker.tripped ? `**SIM — \`${result.breaker.reason}\`** (${result.breaker.trippedAt})` : "não"}
- Rollback config-only: flags do marketplace voltam a LEGACY_ONLY (nenhum dado alterado).

## Evidências

${evidenceLines || "_não registradas nesta execução_"}
`;
}