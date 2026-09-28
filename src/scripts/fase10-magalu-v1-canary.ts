/**
 * FASE 13/14/15/16/17/18 — CANARIO DO WRITER PUBLICO MAGALU (V1).
 *
 * CLI de operacao. DRY-RUN e o DEFAULT: sem `--apply`, ZERO escrita no banco.
 *
 * USO:
 *   npx tsx --env-file=.env.local src/scripts/fase10-magalu-v1-canary.ts
 *   npx tsx --env-file=.env.local src/scripts/fase10-magalu-v1-canary.ts --apply --limit=1
 *   npx tsx --env-file=.env.local src/scripts/fase10-magalu-v1-canary.ts --apply --limit=5
 *   npx tsx --env-file=.env.local src/scripts/fase10-magalu-v1-canary.ts --apply --limit=25
 *   npx tsx --env-file=.env.local src/scripts/fase10-magalu-v1-canary.ts --apply --limit=100
 *   npx tsx --env-file=.env.local src/scripts/fase10-magalu-v1-canary.ts --queries=mouse,fone,xiaomi
 *
 * FLAGS:
 *   --apply            grava de verdade (default: dry-run)
 *   --limit=N          teto de listings desta execucao (default 25)
 *   --page-size=N      tamanho da pagina de coleta (default 50)
 *   --max-pages=N      max paginas de coleta (default 5)
 *   --queries=a,b,c    keywords de busca dirigidas (FASE 15)
 *   --out=PATH         grava o relatorio JSON em PATH
 *   --snapshot         inclui o pre/post snapshot de contagens
 *
 * SEGURANCA:
 *   - aceita SOMENTE EXACT unico sem hard conflict;
 *   - Magalu NAO cria Product (attach-only);
 *   - `Product.active` nunca e escrito aqui: quem decide e o gate central;
 *   - `--apply` exige que a Magalu esteja na allowlist autoritativa de escrita publica.
 *
 * IMPORTANTE: Este canario NAO coloca Magalu na shadow de PUBLICACAO.
 * A shadow de processamento e controlada pelo --apply e pela allowlist
 * autoritativa de escrita (flags.ts), que e INDEPENDENTE da shadow de
 * publicacao (shadowWeight.ts).
 */

import prisma from "@/lib/prisma";
import { runMarketplacePublicSync } from "@/services/architecture/v1/publicSync/runner";
import { createPrismaPublicOfferCommitter } from "@/services/architecture/v1/publicSync/offerWriter";
import {
  createBlockingKeyLookup,
  createKnownBindingLookup,
  createProductListingLoader,
  evaluateIdentityConfidence,
} from "@/services/architecture/v1/publicSync/prismaDeps";
import { magaluPublicSyncConfig } from "@/services/architecture/v1/publicSync/connectors/magaluPublicSync";
import { authorizePublicSync } from "@/services/architecture/v1/publicSync/flags";
import { readShadowFlags } from "@/services/architecture/v1/shadow/flags";
import { publicationWeightFor } from "@/services/architecture/v1/publication/shadowWeight";

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
const DO_SNAPSHOT = has("snapshot");

/* ------------------------------------------------------------------ */
/* SNAPSHOT (read-only)                                                */
/* ------------------------------------------------------------------ */

async function snapshot() {
  const rows = await prisma.$queryRaw<
    Array<{
      products: number;
      offers: number;
      magalu_offers: number;
      auto_active_lt2: number;
      blocking_keys: number;
    }>
  >`
    SELECT
      (SELECT COUNT(*)::int FROM "Product") AS "products",
      (SELECT COUNT(*)::int FROM "MarketplaceOffer") AS "offers",
      (SELECT COUNT(*)::int FROM "MarketplaceOffer" WHERE marketplace = 'MAGAZINE_LUIZA') AS "magalu_offers",
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
    MAGALU_OFFERS: row.magalu_offers,
    BLOCKING_KEYS: row.blocking_keys,
    AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES: row.auto_active_lt2,
  };
}

/* ------------------------------------------------------------------ */

async function main() {
  const mode = APPLY ? "APPLY" : "DRY_RUN";

  // Verificar autorizacao de escrita publica (allowlist autoritativa)
  const authorization = authorizePublicSync("magazine_luiza");
  if (APPLY && !authorization.authorized) {
    console.log(
      JSON.stringify(
        {
          MODE: mode,
          ABORTED: `WRITER_NOT_AUTHORIZED: ${authorization.reason}`,
          HINT: "Magalu precisa estar na allowlist autoritativa de escrita publica.",
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
  const magaluWeight = publicationWeightFor("magazine_luiza", shadow);
  const globalCutover = process.env.CATALOG_V1_GLOBAL_CUTOVER === "true";

  console.log(
    JSON.stringify(
      {
        MODE: mode,
        MAGALU_PUBLICATION_WEIGHT: magaluWeight,
        GLOBAL_CUTOVER: globalCutover ? "YES" : "NO",
        SHADOW_ENABLED: shadow.enabled,
        SHADOW_MARKETPLACES: shadow.marketplaceIds,
      },
      null,
      2,
    ),
  );

  const before = DO_SNAPSHOT ? await snapshot() : null;

  const config = magaluPublicSyncConfig({
    ...(QUERIES.length > 0 ? { keywords: QUERIES } : {}),
    maxListings: LIMIT,
    brandLexicon: new Set<string>(),
    ...(PAGE_SIZE > 0 ? { pageSize: PAGE_SIZE } : {}),
    ...(MAX_PAGES > 0 ? { maxPages: MAX_PAGES } : {}),
  });

  const startedAt = new Date().toISOString();
  const report = await runMarketplacePublicSync(
    config,
    {
      keys: createBlockingKeyLookup(prisma),
      knownBindings: createKnownBindingLookup(prisma),
      products: createProductListingLoader(prisma),
      evaluate: evaluateIdentityConfidence,
      writer: createPrismaPublicOfferCommitter(prisma),
    },
    { dryRun: !APPLY, maxListings: LIMIT },
  );

  const finishedAt = new Date().toISOString();
  const after = DO_SNAPSHOT ? await snapshot() : null;

  const output = {
    MODE: mode,
    STARTED_AT: startedAt,
    FINISHED_AT: finishedAt,
    MAGALU_PUBLICATION_WEIGHT: magaluWeight,
    GLOBAL_CUTOVER: globalCutover ? "YES" : "NO",
    REPORT: report,
    SNAPSHOT_BEFORE: before,
    SNAPSHOT_AFTER: after,
    SNAPSHOT_DELTA: after && before
      ? {
          PRODUCTS: after.PRODUCTS - before.PRODUCTS,
          OFFERS: after.OFFERS - before.OFFERS,
          MAGALU_OFFERS: after.MAGALU_OFFERS - before.MAGALU_OFFERS,
          BLOCKING_KEYS: after.BLOCKING_KEYS - before.BLOCKING_KEYS,
          AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES:
            after.AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES -
            before.AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES,
        }
      : null,
  };

  console.log(JSON.stringify(output, null, 2));

  if (OUT) {
    const fs = await import("node:fs/promises");
    await fs.writeFile(OUT, JSON.stringify(output, null, 2));
    console.log(`\nRelatorio salvo em ${OUT}`);
  }
}

main().catch(async (e) => {
  console.error(JSON.stringify({ FATAL: String(e).slice(0, 400) }, null, 2));
  process.exitCode = 1;
});
