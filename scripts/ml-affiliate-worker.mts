/**
 * Worker LOCAL de afiliado Mercado Livre.
 *
 * Busca pendências (ProductOpportunity WAITING_AFFILIATE + oferta ML sem link),
 * gera o link de afiliado no Chrome real via CDP, valida o MLB e grava somente
 * resultado validado. NÃO roda em Vercel — apenas localmente.
 *
 * Uso:
 *   npx tsx scripts/ml-affiliate-worker.mts --dry-run --limit=1
 *   npx tsx scripts/ml-affiliate-worker.mts --limit=1
 *   ML_AFFILIATE_DRY_RUN=1 npx tsx scripts/ml-affiliate-worker.mts --limit=1
 */

if (
  process.env.VERCEL ||
  process.env.NEXT_PUBLIC_VERCEL_ENV ||
  process.env.NOW_REGION
) {
  console.error("ML_AFFILIATE_WORKER_ABORT=VERCEL (não executa em Vercel)");
  process.exit(0);
}

const args = process.argv.slice(2);

function argFlag(name: string): boolean {
  return args.some((a) => a === name || a === `--${name}`);
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const dryRunFromEnv =
  process.env.ML_AFFILIATE_DRY_RUN === "1" ||
  process.env.ML_AFFILIATE_DRY_RUN === "true";
const dryRunFlag = argFlag("dry-run");
const dryRun = dryRunFromEnv || dryRunFlag;

const limit = Math.max(
  0,
  Math.min(Number(argValue("limit") ?? process.env.ML_AFFILIATE_LIMIT ?? "1"), 25),
);

const cooldownMs = Math.max(
  0,
  Number(argValue("cooldown-ms") ?? process.env.ML_AFFILIATE_COOLDOWN_MS ?? "3000"),
);

const log = (msg: string) => {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
};

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "ML_AFFILIATE_WORKER_ABORT=DATABASE_URL não definido (defina para listar pendências)",
    );
    process.exit(0);
  }

  const prisma = (await import("@/lib/prisma")).default;
  const { createPrismaMercadoLivreWorkerStores } = await import(
    "../src/services/affiliates/mercadolivre/index"
  );
  const { runMercadoLivreWorker } = await import(
    "../src/services/affiliates/mercadolivre/worker"
  );
  const { generateMercadoLivreAffiliateLink } = await import(
    "../src/services/affiliates/mercadolivre/generator"
  );

  const { pendingStore, applyStore } = createPrismaMercadoLivreWorkerStores(prisma);

  const result = await runMercadoLivreWorker(
    {
      pendingStore,
      applyStore,
      generate: async ({ sourceUrl, expectedItemId }) =>
        generateMercadoLivreAffiliateLink({
          sourceUrl,
          expectedItemId,
          log,
        }),
    },
    {
      limit,
      cooldownMs,
      dryRun,
      log,
    },
  );

  for (const item of result.results) {
    log(`RESULT=${item.offerId}:${item.result}`);
  }

  log(
    `SUMMARY=started:${result.startedCount} updated:${result.updatedCount} skipped:${result.skippedCount} failed:${result.failedCount} dryRun:${result.dryRun}`,
  );
}

main().catch((err) => {
  console.error("[worker] erro fatal:", err);
  process.exit(1);
});
