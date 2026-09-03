/**
 * Daemon LOCAL e contÃ­nuo de afiliado Mercado Livre.
 *
 * Reutiliza `runMercadoLivreWorker` (concorrÃªncia = 1) atravÃ©s do
 * `createMercadoLivreAffiliateDaemon`. Roda apenas localmente (NÃƒO em Vercel).
 * NÃ£o automatiza login, CAPTCHA, 2FA nem Chrome. O Chrome real precisa estar
 * aberto e autenticado via CDP (padrÃ£o http://127.0.0.1:9222).
 *
 * ProteÃ§Ã£o single-instance por lock de arquivo e desligamento seguro via
 * SIGINT/SIGTERM (conclui o ciclo atual, para de iniciar novos e desconecta).
 *
 * Uso:
 *   npx tsx scripts/ml-affiliate-daemon.mts --dry-run
 *   npx tsx scripts/ml-affiliate-daemon.mts --poll-ms=60000 --max-per-hour=10
 *   npx tsx scripts/ml-affiliate-daemon.mts --single-run --dry-run
 */

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (
  process.env.VERCEL ||
  process.env.NEXT_PUBLIC_VERCEL_ENV ||
  process.env.NOW_REGION
) {
  console.error("ML_AFFILIATE_DAEMON_ABORT=VERCEL (nÃ£o executa em Vercel)");
  process.exit(0);
}

const require = createRequire(import.meta.url);
const nextEnv = require("@next/env");

if (typeof nextEnv.loadEnvConfig !== "function") {
  throw new Error("@next/env.loadEnvConfig indisponível");
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

nextEnv.loadEnvConfig(ROOT, false, {
  info() {},
  error: console.error,
});

const args = process.argv.slice(2);

function argFlag(name: string): boolean {
  return args.some((a) => a === name || a === `--${name}`);
}

function argValue(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

const boolArg = (name: string, envName: string, fallback: boolean): boolean => {
  const env = process.env[envName];
  if (env === "1" || env === "true") return true;
  if (env === "0" || env === "false") return false;
  return argFlag(name) ? true : fallback;
};

const numArg = (name: string, envName: string, fallback: number): number => {
  const raw = argValue(name, process.env[envName] ?? String(fallback));
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const DEFAULT_POLL_MS = 60_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_MAX_PER_HOUR = 10;
const DEFAULT_CHROME_RETRY_MS = 30_000;
const DEFAULT_AUTH_RETRY_MS = 60_000;
const DEFAULT_BACKOFF_MS = 15_000;

const config = {
  dryRun: boolArg("dry-run", "ML_AFFILIATE_DRY_RUN", false),
  singleRun: boolArg("single-run", "ML_AFFILIATE_SINGLE_RUN", false),
  limit: numArg("limit", "ML_AFFILIATE_LIMIT", 3),
  pollMs: numArg("poll-ms", "ML_AFFILIATE_POLL_MS", DEFAULT_POLL_MS),
  cooldownMs: numArg("cooldown-ms", "ML_AFFILIATE_COOLDOWN_MS", DEFAULT_COOLDOWN_MS),
  maxPerHour: numArg("max-per-hour", "ML_AFFILIATE_MAX_PER_HOUR", DEFAULT_MAX_PER_HOUR),
  chromeRetryMs: numArg("chrome-retry-ms", "ML_AFFILIATE_CHROME_RETRY_MS", DEFAULT_CHROME_RETRY_MS),
  authRetryMs: numArg("auth-retry-ms", "ML_AFFILIATE_AUTH_RETRY_MS", DEFAULT_AUTH_RETRY_MS),
  backoffMs: numArg("backoff-ms", "ML_AFFILIATE_BACKOFF_MS", DEFAULT_BACKOFF_MS),
};

const log = (msg: string) => {
  process.stdout.write(`[${new Date().toISOString()}] ${msg}\n`);
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "ML_AFFILIATE_DAEMON_ABORT=DATABASE_URL nÃ£o definido (defina em .env/.env.local)",
    );
    process.exit(1);
  }

  const lockPath = path.join(
    ROOT,
    process.env.ML_AFFILIATE_LOCK_FILE ?? ".ml-affiliate-daemon.lock",
  );

  const { acquireInstanceLock, createMercadoLivreAffiliateDaemon } =
    await import("../src/services/affiliates/mercadolivre/daemon");
  const { createPrismaMercadoLivreWorkerStores } = await import(
    "../src/services/affiliates/mercadolivre/prisma"
  );
  const { generateMercadoLivreAffiliateLink } = await import(
    "../src/services/affiliates/mercadolivre/generator"
  );

  const lock = await acquireInstanceLock(lockPath);
  if (!lock.acquired) {
    console.error("ML_AFFILIATE_DAEMON_ABORT=outra instÃ¢ncia jÃ¡ estÃ¡ em execuÃ§Ã£o (lock presente)");
    process.exit(1);
  }
  log(`LOCK_ACQUIRED=${lockPath}`);

  let prisma: typeof import("@/lib/prisma").default | undefined;
  let shuttingDown = false;
  let daemon: ReturnType<typeof createMercadoLivreAffiliateDaemon> | undefined;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`SHUTDOWN_REQUESTED=${signal}`);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  try {
    prisma = (await import("@/lib/prisma")).default;
    const { pendingStore, applyStore } = createPrismaMercadoLivreWorkerStores(prisma);

    daemon = createMercadoLivreAffiliateDaemon(
      {
        pendingStore,
        applyStore,
        generate: async ({ sourceUrl, expectedItemId }) =>
          generateMercadoLivreAffiliateLink({ sourceUrl, expectedItemId, log }),
        sleep,
        shouldContinue: () => !shuttingDown,
      },
      {
        dryRun: config.dryRun,
        pollMs: config.pollMs,
        cooldownMs: config.cooldownMs,
        chromeRetryMs: config.chromeRetryMs,
        authRetryMs: config.authRetryMs,
        backoffMs: config.backoffMs,
        maxPerHour: config.maxPerHour,
        limit: config.limit,
        singleRun: config.singleRun,
        log,
      },
      {
        onCycle: (summary) => {
          log(
            `CYCLE_DONE=state:${summary.state} pending:${summary.pendingCount} offered:${summary.offeredThisCycle} updated:${summary.updatedCount} skipped:${summary.skippedCount} transient:${summary.transientCount} auth:${summary.authCount} chromeOffline:${summary.chromeOfflineCount}`,
          );
          for (const item of summary.results) {
            log(`RESULT=${item.offerId}:${item.result}`);
          }
          if (config.singleRun) {
            shuttingDown = true;
          }
        },
        onAuthRequired: (opportunityId) => {
          log(
            `AUTH_REQUIRED_ID=${opportunityId} => autentique o Chrome de afiliados manualmente e reinicie o daemon`,
          );
        },
        onError: (err) => {
          log(`CYCLE_ERROR=${(err as Error)?.message || String(err)}`);
        },
      },
    );

    log(
      `ML_AFFILIATE_DAEMON_CONFIG=dryRun:${config.dryRun} singleRun:${config.singleRun} limit:${config.limit} pollMs:${config.pollMs} cooldownMs:${config.cooldownMs} maxPerHour:${config.maxPerHour} chromeRetryMs:${config.chromeRetryMs} authRetryMs:${config.authRetryMs} backoffMs:${config.backoffMs}`,
    );

    await daemon.start();
  } finally {
    log("SHUTDOWN_COMPLETE");
    try {
      await prisma?.$disconnect();
    } catch {
      /* ignora */
    }
    await lock.release();
    log(`LOCK_RELEASED=${lockPath}`);
  }
}

main().catch((err) => {
  console.error("ML_AFFILIATE_DAEMON_FATAL:", err);
  process.exit(1);
});

