/**
 * FASE 9.14 / 9.18 — CANARIO DO WRITER PUBLICO (Shopee).
 *
 * CLI de operacao. DRY-RUN e o DEFAULT: sem `--apply`, ZERO escrita no banco.
 *
 * USO:
 *   npx tsx --env-file=.env.local src/scripts/fase9-shopee-public-canary.ts
 *   npx tsx --env-file=.env.local src/scripts/fase9-shopee-public-canary.ts --apply --limit=5
 *   npx tsx --env-file=.env.local src/scripts/fase9-shopee-public-canary.ts --queries=carregador,xiaomi
 *
 * FLAGS:
 *   --apply            grava de verdade (default: dry-run)
 *   --limit=N          teto de listings desta execucao (default 25)
 *   --queries=a,b,c    keywords de busca da Shopee (Phase 15: queries
 *                      dirigidas; a verdade NUNCA e passada ao matcher)
 *   --out=PATH         grava o relatorio JSON em PATH
 *   --snapshot         inclui o pre/post snapshot de contagens
 *
 * SEGURANCA:
 *   - aceita SOMENTE EXACT unico sem hard conflict;
 *   - Shopee NUNCA cria Product (attach-only);
 *   - `Product.active` nunca e escrito aqui: quem decide e o gate central;
 *   - `--apply` exige que a Shopee esteja na allowlist de escrita; caso
 *     contrario a execucao aborta antes de qualquer coleta.
 */

import prisma from "../lib/prisma";
import { runMarketplacePublicSync } from "../services/architecture/v1/publicSync/runner";
import { createPrismaPublicOfferCommitter } from "../services/architecture/v1/publicSync/offerWriter";
import {
  createBlockingKeyLookup,
  createKnownBindingLookup,
  createProductListingLoader,
  evaluateIdentityConfidence,
} from "../services/architecture/v1/publicSync/prismaDeps";
import { shopeePublicSyncConfig } from "../services/architecture/v1/publicSync/connectors/shopeePublicSync";
import { authorizePublicSync } from "../services/architecture/v1/publicSync/flags";
import { readShadowFlags } from "../services/architecture/v1/shadow/flags";
import { publicationWeightFor } from "../services/architecture/v1/publication/shadowWeight";

/* ------------------------------------------------------------------ */
/* ARGS                                                                */
/* ------------------------------------------------------------------ */

function argOf(name: string): string | null {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  const eq = hit.indexOf("=");
  return eq === -1 ? "" : hit.slice(eq + 1);
}
const has = (name: string) => process.argv.includes(`--${name}`);

const APPLY = has("apply");
const LIMIT = Number.parseInt(argOf("limit") ?? "25", 10);
const OUT = argOf("out");
const PAGE_SIZE = Number.parseInt(argOf("page-size") ?? "0", 10);
const MAX_PAGES = Number.parseInt(argOf("max-pages") ?? "0", 10);
const QUERIES = (argOf("queries") ?? "")
  .split(",")
  .map((q) => q.trim())
  .filter((q) => q.length > 0);

/* ------------------------------------------------------------------ */
/* SNAPSHOT (read-only)                                                */
/* ------------------------------------------------------------------ */

async function snapshot() {
  /*
   * Aliases PRECISAM de aspas: Postgres dobra para minusculo um identificador
   * nao-quoted, e `shopeeOffers` voltaria como `shopeeoffer`. Sem aspa, o
   * snapshot silenciosamente devolvia `undefined` para duas das quatro
   * contagens — e um gate que mede `undefined` nao mede nada.
   */
  const rows = await prisma.$queryRaw<
    Array<{
      products: number;
      offers: number;
      shopee_offers: number;
      auto_active_lt2: number;
      blocking_keys: number;
    }>
  >`
    SELECT
      (SELECT COUNT(*)::int FROM "Product") AS "products",
      (SELECT COUNT(*)::int FROM "MarketplaceOffer") AS "offers",
      (SELECT COUNT(*)::int FROM "MarketplaceOffer" WHERE marketplace = 'SHOPEE') AS "shopee_offers",
      (SELECT COUNT(*)::int FROM "CandidateBlockingKey") AS "blocking_keys",
      (
        SELECT COUNT(*)::int FROM "Product" p
         WHERE p."autoCreated" = true AND p.active = true
           AND (
             SELECT COUNT(DISTINCT o.marketplace) FROM "MarketplaceOffer" o
              WHERE o."productId" = p.id AND o.active = true
                AND o."matchStatus" = 'EXACT' AND o.available = true
                AND o.price > 0 AND o.status <> 'UNAVAILABLE' AND o.status <> 'ERROR'
           ) < 2
      ) AS "auto_active_lt2"`;
  const row = rows[0];
  return {
    PRODUCTS: row.products,
    OFFERS: row.offers,
    SHOPEE_OFFERS: row.shopee_offers,
    BLOCKING_KEYS: row.blocking_keys,
    AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES: row.auto_active_lt2,
  };
}

/* ------------------------------------------------------------------ */

async function main() {
  const mode = APPLY ? "APPLY" : "DRY_RUN";

  const authorization = authorizePublicSync("shopee");
  if (!authorization.authorized) {
    console.log(
      JSON.stringify(
        {
          MODE: mode,
          ABORTED: `WRITER_NOT_AUTHORIZED: ${authorization.reason}`,
          HINT: "Shopee precisa estar na allowlist autoritativa de escrita publica.",
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }

  // Estado de shadow/publicacao observado na execucao (evidencia, nao escrita).
  const shadow = readShadowFlags();
  const shopeeWeight = publicationWeightFor("shopee", shadow);
  const globalCutover = process.env.CATALOG_V1_GLOBAL_CUTOVER === "true";

  const before = await snapshot();

  const config = shopeePublicSyncConfig({
    ...(QUERIES.length > 0 ? { keywords: QUERIES } : {}),
    maxListings: LIMIT,
    brandLexicon: new Set<string>(),
    // pageSize/maxPages ficam no padrao medido da factory (50 x 5), que e a
    // unica combinacao comprovada a alcancar as 3 bindings certificadas. Fixar
    // aqui um valor menor desativaria o refresh sem avisar. Ver
    // H-refresh-config-search.txt.
    ...(PAGE_SIZE > 0 ? { pageSize: PAGE_SIZE } : {}),
    ...(MAX_PAGES > 0 ? { maxPages: MAX_PAGES } : {}),
  });

  const startedAt = new Date().toISOString();
  const report = await runMarketplacePublicSync(
    config,
    {
      keys: createBlockingKeyLookup(prisma),
      products: createProductListingLoader(prisma),
      evaluate: evaluateIdentityConfidence,
      knownBindings: createKnownBindingLookup(prisma),
      writer: createPrismaPublicOfferCommitter(prisma),
    },
    { dryRun: !APPLY, maxListings: LIMIT },
  );
  const finishedAt = new Date().toISOString();

  const after = await snapshot();

  const output = {
    MODE: mode,
    MARKETPLACE_ID: "shopee",
    WRITER_MODE: authorization.mode,
    ATTACH_ONLY: true,
    GLOBAL_CUTOVER: globalCutover ? "YES" : "NO",
    SHOPEE_PUBLICATION_WEIGHT: shopeeWeight,
    SHOPEE_IS_SHADOW: shadow.enabled && shadow.marketplaceIds.includes("shopee"),
    LIMIT,
    QUERIES_USED: QUERIES.length > 0 ? QUERIES : "DEFAULT_KEYWORDS",
    STARTED_AT: startedAt,
    FINISHED_AT: finishedAt,

    // contadores do runner
    LISTINGS_COLLECTED: report.LISTINGS_COLLECTED,
    LISTINGS_VALID: report.LISTINGS_VALID,
    LISTINGS_WITH_KEYS: report.LISTINGS_WITH_KEYS,
    LISTINGS_WITHOUT_KEYS: report.LISTINGS_WITHOUT_KEYS,
    CANDIDATES: report.CANDIDATES,
    EXACT_UNIQUE: report.EXACT_UNIQUE,
    REVIEW: report.REVIEW,
    REJECT: report.REJECT,
    HARD_CONFLICT: report.HARD_CONFLICT,
    AMBIGUOUS_EXACT: report.AMBIGUOUS_EXACT,
    NO_CANDIDATES: report.NO_CANDIDATES,
    NO_EXACT: report.NO_EXACT,

    // dois caminhos
    CERTIFIED_BINDINGS: report.CERTIFIED_BINDINGS,
    BINDING_REFRESH_MATCHED: report.BINDING_REFRESH_MATCHED,
    BINDING_REFRESH_WRITES: report.BINDING_REFRESH_WRITES,
    BINDING_REFRESH_NOOP: report.BINDING_REFRESH_NOOP,
    BINDING_NOT_SEEN: report.BINDING_NOT_SEEN,
    BINDING_REFRESH_SKIPPED_BUDGET: report.BINDING_REFRESH_SKIPPED_BUDGET,
    NEW_DISCOVERY_LISTINGS: report.NEW_DISCOVERY_LISTINGS,
    MISSING_AFFILIATE_LINK: report.MISSING_AFFILIATE_LINK,
    INVALID_LINK: report.INVALID_LINK,
    WOULD_WRITE: report.WOULD_WRITE,
    WRITES: report.WRITES,
    WRITES_CREATED: report.WRITES_CREATED,
    WRITES_UPDATED: report.WRITES_UPDATED,
    WRITES_NOOP: report.WRITES_NOOP,

    // invariantes que precisam ser 0
    PRODUCTS_CREATED: report.PRODUCTS_CREATED,
    REVIEW_PUBLISHED: report.REVIEW_PUBLISHED,
    REJECT_PUBLISHED: report.REJECT_PUBLISHED,
    HARD_CONFLICT_PUBLISHED: report.HARD_CONFLICT_PUBLISHED,
    AMBIGUOUS_PUBLISHED: report.AMBIGUOUS_PUBLISHED,

    COLLECT_CALLS: report.COLLECT_CALLS,
    COLLECT_PARTIAL: report.COLLECT_PARTIAL,
    ERROR: report.ERROR,

    SNAPSHOT_BEFORE: before,
    SNAPSHOT_AFTER: after,
    DELTA_PRODUCTS: after.PRODUCTS - before.PRODUCTS,
    DELTA_OFFERS: after.OFFERS - before.OFFERS,
    DELTA_SHOPEE_OFFERS: after.SHOPEE_OFFERS - before.SHOPEE_OFFERS,

    // detalhe por probe, sem payload e sem link completo
    BINDING_STATUS: report.BINDING_STATUS,

    PROBES: report.PROBES.map((p) => ({
      externalListingId: p.externalListingId,
      keys: p.blockingKeys.length,
      keyTypes: [...new Set(p.blockingKeys.map((k) => k.type))],
      candidates: p.candidateCount,
      evaluatedPairs: p.evaluatedPairs,
      exactProductIds: p.exactProductIds,
      reviewCount: p.reviewCount,
      rejectCount: p.rejectCount,
      hardConflictCount: p.hardConflictCount,
      outcome: p.outcome,
      winnerProductId: p.winnerProductId,
      reasonCodes: p.decision?.reasonCodes ?? [],
    })),
  };

  const json = JSON.stringify(output, null, 2);
  if (OUT) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(OUT, json, "utf8");
    console.log(`wrote ${OUT}`);
  } else {
    console.log(json);
  }

  if (after.AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES !== 0) {
    console.error(
      `GATE FAILURE: AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=${after.AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES}`,
    );
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(
      "CANARY_FAILED",
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
