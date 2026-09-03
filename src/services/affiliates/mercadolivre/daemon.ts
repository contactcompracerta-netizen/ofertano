import { promises as fs } from "node:fs";
import type { GenerateOutcome } from "./generator";
import {
  runMercadoLivreWorker,
  type GeneratorFn,
  type WorkerItemResult,
} from "./worker";
import type {
  MercadoLivreApplyStore,
  MercadoLivrePendingStore,
} from "./pending";

/**
 * Daemon LOCAL e contínuo de afiliado Mercado Livre.
 *
 * Camada de orquestração que reutiliza integralmente o `runMercadoLivreWorker`
 * (concorrência = 1 e gravação apenas de resultado validado). Este arquivo só
 * define o ciclo de vida: polling, cooldown, limite por hora, estados
 * (PAUSED_CHROME / PAUSED_AUTH / BACKOFF), backoff e desligamento seguro.
 *
 * NÃO roda em Vercel/servidor. NÃO automatiza login, CAPTCHA ou 2FA.
 * NUNCA apaga a pendência automaticamente.
 */

export type DaemonState =
  | "IDLE"
  | "PROCESSING"
  | "COOLDOWN"
  | "PAUSED_CHROME"
  | "PAUSED_AUTH"
  | "BACKOFF"
  | "STOPPED";

/** Classifica o resultado de um item do worker para decisão de estado. */
export type ItemTone =
  | "success"
  | "skip"
  | "chrome_offline"
  | "auth_required"
  | "transient";

export type DaemonConfig = {
  dryRun: boolean;
  pollMs: number;
  cooldownMs: number;
  chromeRetryMs: number;
  authRetryMs: number;
  backoffMs: number;
  /** Limite de ofertas processadas por hora. 0 = sem limite. */
  maxPerHour: number;
  /** Qtd de pendências por ciclo (concorrência permanece 1). */
  limit: number;
  /** Executa um único ciclo e encerra sem dormir intervalos de retry/poll. */
  singleRun?: boolean;
  log?: (msg: string) => void;
};

export type DaemonDeps = {
  pendingStore: MercadoLivrePendingStore;
  applyStore: MercadoLivreApplyStore;
  generate: GeneratorFn;
  sleep: (ms: number) => Promise<void>;
  shouldContinue: () => boolean;
};

export type CycleSummary = {
  state: DaemonState;
  pendingCount: number;
  offeredThisCycle: number;
  updatedCount: number;
  skippedCount: number;
  transientCount: number;
  authCount: number;
  chromeOfflineCount: number;
  results: WorkerItemResult[];
};

export type DaemonRuntimeEvents = {
  onCycle?: (summary: CycleSummary) => void;
  onAuthRequired?: (opportunityId: string) => Promise<void> | void;
  onError?: (err: unknown) => void;
};

function defaultLog(_msg: string) {
  /* noop */
}

function toneOf(
  item: WorkerItemResult,
):
  | "success"
  | "skip"
  | "chrome_offline"
  | "auth_required"
  | "transient" {
  switch (item.result) {
    case "UPDATED":
    case "SUCCESS":
      return "success";
    case "SKIP_ALREADY_AFFILIATED":
      return "skip";
    case "CHROME_NOT_RUNNING":
      return "chrome_offline";
    case "AUTH_REQUIRED":
      return "auth_required";
    case "GENERATION_FAILED":
    case "VALIDATION_FAILED":
    default:
      return "transient";
  }
}

function decideState(summary: {
  pendingCount: number;
  offeredThisCycle: number;
  chromeOfflineCount: number;
  authCount: number;
  transientCount: number;
}): DaemonState {
  if (summary.chromeOfflineCount > 0) return "PAUSED_CHROME";
  if (summary.authCount > 0) return "PAUSED_AUTH";
  if (summary.transientCount > 0) return "BACKOFF";
  // Nenhuma pendência ou nada novo para processar → aguarda e volta.
  if (summary.pendingCount === 0) return "IDLE";
  return "COOLDOWN";
}

export type MercadoLivreAffiliateDaemon = {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly state: () => DaemonState;
};

/**
 * Cria o daemon. O loop roda até `shouldContinue()` retornar falso (desligamento
 * seguro). O ciclo atual é concluído antes de parar e nenhum novo é iniciado.
 */
export function createMercadoLivreAffiliateDaemon(
  deps: DaemonDeps,
  config: DaemonConfig,
  events: DaemonRuntimeEvents = {},
): MercadoLivreAffiliateDaemon {
  const log = config.log ?? defaultLog;
  let state: DaemonState = "IDLE";
  const processedTimestamps: number[] = [];

  const sleep = async (ms: number) => {
    // Checa continuidade durante a espera para desligamento responsivo.
    const step = 250;
    let waited = 0;
    while (waited < ms && deps.shouldContinue()) {
      await deps.sleep(Math.min(step, ms - waited));
      waited += step;
    }
  };

  // Em single-run os intervalos de retry/poll não são dormidos: executa o
  // ciclo e encerra imediatamente. No daemon contínuo o comportamento é normal.
  const wait = async (ms: number) => {
    if (!config.singleRun) await sleep(ms);
  };

  const describedState = (s: DaemonState) => {
    state = s;
    log(`DAEMON_STATE=${s}`);
  };

  const remainingForHour = (): number => {
    if (config.maxPerHour <= 0) return Infinity;
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    while (processedTimestamps.length > 0 && processedTimestamps[0] < hourAgo) {
      processedTimestamps.shift();
    }
    return Math.max(0, config.maxPerHour - processedTimestamps.length);
  };

  const updateTimestampsForResults = (results: WorkerItemResult[]) => {
    // Só uma geração/validação efetivamente concluída e aplicada consome o
    // limite por hora. Em dry-run nada é validado/gravado, então não conta.
    if (config.dryRun) return;
    for (const item of results) {
      // Exclui skip, chrome offline e auth (fallback ao SUCCESS real/UPDATED).
      if (toneOf(item) === "success") {
        processedTimestamps.push(Date.now());
      }
    }
  };

  async function runCycle(): Promise<void> {
    describedState("PROCESSING");

    let count = await deps.pendingStore.countPending();

    const remaining = remainingForHour();
    if (remaining <= 0) {
      log(`ML_AFFILIATE_PER_HOUR_LIMIT_REACHED=waiting`);
      describedState("COOLDOWN");
      await wait(config.pollMs);
      return;
    }

    const cycleLimit = Math.max(1, Math.min(config.limit, remaining));
    log(`PENDING_COUNT=${count} CYCLE_LIMIT=${cycleLimit}`);

    const result = await runMercadoLivreWorker(
      { pendingStore: deps.pendingStore, applyStore: deps.applyStore, generate: deps.generate },
      {
        limit: cycleLimit,
        cooldownMs: 0, // cooldown gerido pelo daemon (sem dupla pausa)
        dryRun: config.dryRun,
        log,
      },
    );

    updateTimestampsForResults(result.results);
    if (typeof deps.pendingStore.countPending === "function") {
      count = await deps.pendingStore.countPending();
    }

    const summary: CycleSummary = {
      state: "PROCESSING",
      pendingCount: count,
      offeredThisCycle: result.startedCount,
      updatedCount: result.updatedCount,
      skippedCount: result.skippedCount,
      transientCount: result.results.filter(
        (r) => toneOf(r) === "transient",
      ).length,
      authCount: result.results.filter(
        (r) => toneOf(r) === "auth_required",
      ).length,
      chromeOfflineCount: result.results.filter(
        (r) => toneOf(r) === "chrome_offline",
      ).length,
      results: result.results,
    };

    const next = decideState(summary);
    // O summary reporta o estado resolvido do ciclo (o próximo estado).
    summary.state = next;
    describedState(next);
    log(
      `RESULT=started:${summary.offeredThisCycle} updated:${summary.updatedCount} skipped:${summary.skippedCount} transient:${summary.transientCount} auth:${summary.authCount} chromeOffline:${summary.chromeOfflineCount} dryRun:${config.dryRun}`,
    );

    switch (next) {
      case "PAUSED_CHROME":
        log("ML_AFFILIATE_PAUSED_CHROME=aguardando Chrome real reconectar");
        await wait(config.chromeRetryMs);
        break;
      case "PAUSED_AUTH":
        log("ML_AFFILIATE_AUTH_REQUIRED=autentique o Chrome de afiliados manualmente");
        const oppId = summary.results.find(
          (r) => toneOf(r) === "auth_required",
        )?.offerId;
        if (oppId) {
          log(`PROCESSING_OFFER=${oppId}`);
          await notifyAuth(oppId);
        }
        await wait(config.authRetryMs);
        break;
      case "BACKOFF":
        log(`ML_AFFILIATE_BACKOFF=espera ${config.backoffMs}ms`);
        await wait(config.backoffMs);
        break;
      default:
        // IDLE / COOLDOWN
        const idle = next === "IDLE";
        const waitFor = idle ? config.pollMs : config.cooldownMs;
        if (idle) log(`ML_AFFILIATE_IDLE=poll em ${waitFor}ms`);
        else log(`ML_AFFILIATE_COOLDOWN=espera ${waitFor}ms`);
        await wait(waitFor);
        break;
    }

    events.onCycle?.(summary);
  }

  async function notifyAuth(opportunityId: string) {
    if (events.onAuthRequired) {
      try {
        await events.onAuthRequired(opportunityId);
      } catch (err) {
        log(`ML_AFFILIATE_ADMIN_NOTIFY_FAILED`);
        events.onError?.(err);
      }
    }
  }

  return {
    state: () => state,
    async start() {
      log("ML_AFFILIATE_DAEMON_START");
      describedState("IDLE");
      while (deps.shouldContinue()) {
        try {
          await runCycle();
        } catch (err) {
          log(`ML_AFFILIATE_DAEMON_CYCLE_ERROR=${(err as Error)?.message || String(err)}`);
          events.onError?.(err);
          describedState("BACKOFF");
          await wait(config.backoffMs);
        }
        if (!deps.shouldContinue()) break;
      }
      describedState("STOPPED");
      log("ML_AFFILIATE_DAEMON_STOPPED");
      await deps.sleep(0);
    },
    async stop() {
      // `shouldContinue` já retorna falso pelo runner externo; este método só
      // garante interface simétrica. O desligamento gracioso é imposto pelo
      // runner (termo do ciclo atual e encerramento de Prisma/CDP).
    },
  };
}

export function classifyItemTone(item: WorkerItemResult): ItemTone {
  return toneOf(item);
}

/**
 * Lock de instância única baseado em arquivo (criação atômica 'wx').
 *
 * - Criação atômica: só um processo consegue criar o arquivo com sucesso.
 * - O arquivo guarda `pid:createdAt` para identificar dono e idade.
 * - Um lock cujo PID não existe mais é considerado STALE e é recuperado
 *   com segurança (removido e re-adquirido uma vez).
 * - Um lock cujo PID está realmente ativo NUNCA é removido.
 * - O shutdown normal remove o lock (release).
 */
export type InstanceLock = {
  acquired: boolean;
  release(): Promise<void>;
};

type LockOwnerInfo = {
  pid: number;
  createdAt: number;
};

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = processo existe mas sem permissão de sinalizar → assume vivo.
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

async function readLockOwner(lockPath: string): Promise<LockOwnerInfo | null> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const match = raw.trim().match(/^(\d+):(\d+)$/);
    if (!match) return null;
    const pid = Number(match[1]);
    const createdAt = Number(match[2]) || Date.now();
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { pid, createdAt };
  } catch {
    return null;
  }
}

async function tryCreateLock(
  lockPath: string,
): Promise<Awaited<ReturnType<typeof fs.open>> | null> {
  try {
    const handle = await fs.open(lockPath, "wx");
    await handle.writeFile(`${process.pid}:${Date.now()}\n`, "utf8");
    return handle;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "EEXIST") return null;
    throw err;
  }
}

function makeHeldLock(
  lockPath: string,
  handle: Awaited<ReturnType<typeof fs.open>>,
): InstanceLock {
  return {
    acquired: true,
    async release() {
      try {
        await handle.close();
      } catch {
        /* ignora */
      }
      try {
        await fs.unlink(lockPath);
      } catch {
        /* arquivo já removido */
      }
    },
  };
}

export async function acquireInstanceLock(lockPath: string): Promise<InstanceLock> {
  const held = await tryCreateLock(lockPath);
  if (held) return makeHeldLock(lockPath, held);

  // Arquivo já existe. Verifica o dono:
  const owner = await readLockOwner(lockPath);
  if (owner && isProcessAlive(owner.pid)) {
    // Lock de um processo realmente ativo → NÃO remove, bloqueia.
    return { acquired: false, release: async () => {} };
  }

  // Lock STALE (dono inexistente) → remove com segurança e tenta 1 vez.
  try {
    await fs.unlink(lockPath);
  } catch {
    /* corrida: outro processo removeu; segue e tenta de novo */
  }
  const recovered = await tryCreateLock(lockPath);
  if (recovered) return makeHeldLock(lockPath, recovered);
  return { acquired: false, release: async () => {} };
}