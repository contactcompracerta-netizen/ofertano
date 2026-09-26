/**
 * CATALOG_ARCHITECTURE_V1 — FASE 7.2: AUTOPILOT DE PROGRESSÃO DO CUTOVER LIVE.
 *
 * Progressão 1 -> 5 -> 25 -> 100 SEM OPERADOR PRESENTE, guiada por tráfego
 * REAL. Este módulo é o único lugar que decide "o próximo degrau é elegível?".
 *
 * ---------------------------------------------------------------------------
 * POR QUE O ESTADO NÃO É DE MEMÓRIA
 * ---------------------------------------------------------------------------
 * O objetivo é justamente não depender de alguém estar ao lado do PC. O
 * processo que observa o tráfego em Vercel é destruído a cada requisição e
 * pode existir em N instâncias ao mesmo tempo. Um `Map` ou uma variável de
 * módulo:
 *   - perde a contabilidade a cada execução;
 *   - promove em duplicidade quando duas instâncias correm juntas;
 *   - não sobrevive a um restart nem a um cold start.
 * O único estado que sobrevive a isso é o mesmo plano de controle já usado
 * pelo orçamento global e pelo breaker: o PostgreSQL. Aqui o estado vive em
 * `CatalogCutoverAutopilot` (1 linha por marketplaceId canônico).
 *
 * ---------------------------------------------------------------------------
 * POR QUE A TRANSIÇÃO É UM COMPARE-AND-SWAP
 * ---------------------------------------------------------------------------
 * Duas execuções simultâneas (duas funções serverless do mesmo cron) leem o
 * MESMO estado e podem decidir a MESMA promoção. A transição é um UPDATE
 * condicional `WHERE "version" = $lido AND "state" = $lido`: o perdedor da
 * corrida afeta ZERO linhas e aborta SEM promover.
 *
 * E o alvo da promoção nunca é um número digitado: é `proximoEstado`, função
 * pura do estado persistido. Mesmo que dois atores decidam promover, ambos
 * visam o mesmo degrau seguinte — é estruturalmente impossível pular 1 -> 25.
 *
 * ---------------------------------------------------------------------------
 * POR QUE A DECISÃO VEM ANTES DO EFEITO
 * ---------------------------------------------------------------------------
 * A ordem é: (1) CAS do estado, (2) reconfiguração do orçamento. Se o processo
 * morrer entre as duas, o próximo ciclo reconcilia (`reconciliarOrcamento`):
 * o estado manda, o orçamento é corrigido para o estágio persistido. A janela
 * entre as duas é fail-safe — o orçamento antigo é MENOR, ou seja, mais
 * conservador, e nunca maior do que o estado já autorizou.
 *
 * ---------------------------------------------------------------------------
 * O QUE ESTE MÓDULO NUNCA FAZ
 * ---------------------------------------------------------------------------
 *   - NÃO promove por tempo. Tempo é condição NECESSÁRIA (cooldown
 *     persistente), nunca suficiente: sem evidência real de processamento, o
 *     degrau não sai.
 *   - NÃO conta replay como amostra. `AUTOPILOT_MIN_DISTINCT_LISTINGS` exige
 *     listagens REAIS DISTINTAS por estágio; 100 execuções da mesma listing
 *     não promovem nada (FASE L).
 *   - NÃO promove V1_PRIMARY puro, NÃO remove o fallback legado, NÃO ativa
 *     segundo marketplace, NÃO faz cutover global
 *     (CATALOG_V1_GLOBAL_CUTOVER=NO) e NÃO vai acima de 100 (100 é TETO).
 *   - NÃO fecha o breaker sozinho. Depois de TRIPPED só o operador fecha.
 *   - NÃO toca publicação. PublicationEligibility,
 *     PUBLIC_MULTISTORE_MIN_MARKETPLACES=2 e DRAFT/active=false continuam
 *     decididos exclusivamente dentro da transação canônica do catálogo. O
 *     autopilot apenas OBSERVA AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES.
 *   - NÃO decide com unhealthy externo. Probes HTTP são registrado, nunca
 *     causam TRIP nem bloqueiam promoção: indisponibilidade externa isolada
 *     não pode gerar decisão destrutiva.
 */

import { randomUUID } from "node:crypto";

import {
  armGlobalRollout,
  readGlobalRollout,
  tripGlobalBreaker,
  type CutoverSqlExecutor,
} from "./globalControl";
import type { CutoverBreakerReason } from "./breaker";
import type { CatalogWriterMode } from "./policy";

/* -------------------------------------------------------------------------- */
/* ESCADA E ESTADOS                                                            */
/* -------------------------------------------------------------------------- */

/** A ESCADA é fixa e publicada. 100 é TETO: nunca existe promoção acima dele. */
export const AUTOPILOT_LADDER: readonly number[] = [1, 5, 25, 100];

/** Teto de promoção: o que FASE G proíbe explicitamente. */
export const AUTOPILOT_MAX_STAGE = 100;

export type AutopilotState =
  | "WAITING_1"
  | "VALIDATING_1"
  | "WAITING_5"
  | "VALIDATING_5"
  | "WAITING_25"
  | "VALIDATING_25"
  | "WAITING_100"
  | "VALIDATING_100"
  | "COMPLETED"
  | "PAUSED"
  | "TRIPPED";

export const AUTOPILOT_STATES: readonly AutopilotState[] = [
  "WAITING_1",
  "VALIDATING_1",
  "WAITING_5",
  "VALIDATING_5",
  "WAITING_25",
  "VALIDATING_25",
  "WAITING_100",
  "VALIDATING_100",
  "COMPLETED",
  "PAUSED",
  "TRIPPED",
];

export type AutopilotDecisionKind =
  | "INIT"
  | "NOOP"
  | "WAIT"
  | "PROMOTE"
  | "TRIP"
  | "PAUSE"
  | "RESUME";

/**
 * Piso de listagens REAIS DISTINTAS por estágio (FASE L).
 *
 * É este piso — e não a contagem de execuções — que impede "100 replays da
 * mesma listing" de virar prova do estágio 100. Os valores crescem devagar de
 * propósito: o tráfego real do Mercado Livre é de ~1 rajada por dia, e um piso
 * alto demais transformaria o TETO em meta artificial.
 */
export const AUTOPILOT_MIN_DISTINCT_LISTINGS: Readonly<Record<number, number>> =
  Object.freeze({ 1: 1, 5: 2, 25: 3, 100: 5 });

/**
 * Máximo de commits autoritativos exigidos como evidência de um estágio.
 *
 * FASE E pede "V1 authoritative writes reais no estágio >= 5". 5 é o número
 * que a missão nomeia, e é também o que o tráfego real sustenta. Acima disso
 * (25, 100) o requisito continua sendo 5: 25 e 100 são TETOS, não metas, e
 * exigir o teto inteiro levaria ~25 dias só para sair do estágio 25.
 */
export const AUTOPILOT_MAX_EVIDENCE_COMMITS = 5;

/** Cooldown mínimo entre estágios, em ms. 24h = ~1 rajada diária de tráfego. */
export const AUTOPILOT_MIN_OBSERVATION_MS = 86_400_000;

/**
 * Códigos de rejeição de guarda: o sistema recusando fazer o trabalho, não
 * falhando (FASE J). Não são erro crítico, não abrem breaker e não bloqueiam
 * promoção — mas ficam registrados como `policyBlocked` para não sumirem.
 *
 * A lista é comparada por PREFIXO porque o classificador anexa o contexto
 * (`INVALID_DATA:fast-offer-sem-oferta-existente:MLB...`).
 */
export const AUTOPILOT_POLICY_BLOCK_CODES: readonly string[] = [
  "POLICY_NOT_READY",
  "MULTISTORE_NOT_READY",
  "IDENTITY_REVIEW",
  "IDENTITY_REJECT",
  "INVALID_DATA",
];

/* -------------------------------------------------------------------------- */
/* MÁQUINA DE ESTADOS (funções puras — sem banco, sem relógio, sem rede)        */
/* -------------------------------------------------------------------------- */

/** `WAITING_n` / `VALIDATING_n` => n. Estados terminais => `null`. */
export function stageOfState(state: AutopilotState): number | null {
  const match = /^(?:WAITING|VALIDATING)_(\d+)$/.exec(state);
  return match === null ? null : Number(match[1]);
}

export function isTerminalState(state: AutopilotState): boolean {
  return state === "COMPLETED" || state === "PAUSED" || state === "TRIPPED";
}

/** Próximo degrau da escada, ou `null` no teto (100). */
export function nextStageOf(stage: number): number | null {
  const index = AUTOPILOT_LADDER.indexOf(stage);
  if (index < 0) {
    return null;
  }
  const next = AUTOPILOT_LADDER[index + 1];
  return next === undefined ? null : next;
}

export function waitingStateForStage(stage: number): AutopilotState {
  return `WAITING_${stage}` as AutopilotState;
}

export function validatingStateForStage(stage: number): AutopilotState {
  return `VALIDATING_${stage}` as AutopilotState;
}

/** Listagens REAIS DISTINTAS exigidas para SAIR do estágio `stage`. */
export function requiredDistinctListings(stage: number): number {
  return AUTOPILOT_MIN_DISTINCT_LISTINGS[stage] ?? AUTOPILOT_MAX_STAGE;
}

/** Commits autoritativos reais exigidos para SAIR do estágio `stage`. */
export function requiredEvidenceCommits(stage: number): number {
  return Math.min(stage, AUTOPILOT_MAX_EVIDENCE_COMMITS);
}

/* -------------------------------------------------------------------------- */
/* DECISÃO (função pura)                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Tudo que a decisão precisa saber, já normalizado. Vem do ledger, do rollout
 * e da auditoria de publicação — nunca de um número digitado.
 */
export type AutopilotGates = {
  /** Escritas já consumidas no estágio. */
  usedWrites: number;
  /** Teto vigente do rollout. */
  maxWrites: number;
  /** Commits V1 autoritativos no estágio. */
  v1Committed: number;
  /** Listagens REAIS DISTINTAS com commit V1 no estágio. */
  uniqueExternalListings: number;
  /** Double-write real. Qualquer um é violação, não métrica. */
  doubleWrites: number;
  /** Duplicata real (oferta ausente pós-commit ou TRIP dedicado). */
  duplicates: number;
  /** Corrupção de identidade (oferra commitada em outro Product). */
  identityCorruption: number;
  /** Divergência de paridade inesperada. */
  unexpectedParityDifferences: number;
  /** `usedWrites > maxWrites`: violação estrutural do teto. */
  globalBudgetViolations: number;
  /** Erro de sistema = evento em que NENHUM writer commitou (perda real). */
  systemCriticalErrors: number;
  /** Rejeições de guarda (FASE J): observadas, nunca críticas. */
  policyBlocked: number;
  /** AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES. */
  autoActiveLt2: number;
  breakerState: "CLOSED" | "OPEN";
};

export type AutopilotDecision = {
  kind: "NOOP" | "WAIT" | "PROMOTE" | "TRIP";
  stateAfter: AutopilotState;
  stageAfter: number;
  reason: string;
  blockers: string[];
  tripReason: CutoverBreakerReason | null;
};

/**
 * Decisão de UM ciclo. PURA: recebe o estado persistido e as evidências, e
 * devolve o que fazer. Toda a coordenação de concorrência acontece no DB.
 *
 * Ordem das regras (a primeira que casa vence):
 *   1. TRIPPED  => NOOP. Trip não se fecha sozinho (FASE I).
 *   2. PAUSED   => NOOP. Pause não promove (FASE P).
 *   3. COMPLETED=> NOOP. 100 é teto (FASE G).
 *   4. violação crítica > 0 => TRIP imediato, sem esperar cooldown (FASE I).
 *   5. breaker já OPEN => NOOP (já tripado; o operador fecha).
 *   6. cooldown não cumprido => WAIT. Tempo é necessário, nunca suficiente.
 *   7. WAITING_n com cooldown cumprido => VALIDATING_n (inspeção, sem
 *      mudar orçamento). É o passo que impede promover dentro da mesma rajada.
 *   8. VALIDATING_n com TODOS os gates verdes => PROMOTE para o próximo degrau.
 *   9. VALIDATING_n com gates em falta => WAIT, com a lista do que falta.
 */
export function decideAutopilot(input: {
  state: AutopilotState;
  stage: number;
  gates: AutopilotGates;
  now: number;
  cooldownUntil: number;
  minObservationMs: number;
}): AutopilotDecision {
  const { state, stage, gates, now } = input;
  const noop = (reason: string): AutopilotDecision => ({
    kind: "NOOP",
    stateAfter: state,
    stageAfter: stage,
    reason,
    blockers: [],
    tripReason: null,
  });

  if (state === "TRIPPED") {
    return noop("tripped-sem-fechamento-automatico");
  }
  if (state === "PAUSED") {
    return noop("pausado-pelo-operador");
  }
  if (state === "COMPLETED") {
    return noop("estagio-100-e-teto-nao-ha-promocao-acima");
  }

  /* ---------------------------------------------------------------------- */
  /* FASE I — TRIP IMEDIATO                                                  */
  /* ---------------------------------------------------------------------- */
  /*
   * A ordem importa: o que tem motivo de breaker DEDICADO vem primeiro, para
   * que o TRIP receba o motivo mais específico possível. Um double-write usa
   * `DUPLICATE_UNEXPECTED` — o mesmo motivo do detector in-transação, porque
   * `CutoverBreakerReason` não tem código próprio para isso e inventar um
   * mentiria sobre um taxonomy já auditado na FASE 7.1.
   */
  const critical: Array<[string, number, CutoverBreakerReason]> = [
    ["doubleWrite", gates.doubleWrites, "DUPLICATE_UNEXPECTED"],
    ["identityCorruption", gates.identityCorruption, "IDENTITY_CORRUPTION"],
    [
      "unexpectedParityDifference",
      gates.unexpectedParityDifferences,
      "PARITY_DIFF_UNEXPECTED",
    ],
    ["budgetExceeded", gates.globalBudgetViolations, "WRITE_BUDGET_EXCEEDED"],
    ["publicationViolation", gates.autoActiveLt2, "PUBLICATION_VIOLATION"],
    ["systemCriticalError", gates.systemCriticalErrors, "V1_ERRORS_ABOVE_LIMIT"],
    ["duplicate", gates.duplicates, "DUPLICATE_UNEXPECTED"],
  ];
  const violated = critical.filter(([, value]) => value > 0);
  if (violated.length > 0) {
    return {
      kind: "TRIP",
      stateAfter: "TRIPPED",
      stageAfter: stage,
      reason: violated
        .map(([name, value]) => `${name}=${value}`)
        .join(";"),
      blockers: violated.map(([name, value]) => `${name}=${value}`),
      tripReason: violated[0][2],
    };
  }

  if (gates.breakerState === "OPEN") {
    return noop("breaker-aberto-aguardando-operador");
  }

  /* ---------------------------------------------------------------------- */
  /* FASE H — COOLDOWN PERSISTENTE                                            */
  /* ---------------------------------------------------------------------- */
  if (now < input.cooldownUntil) {
    return {
      kind: "WAIT",
      stateAfter: state,
      stageAfter: stage,
      reason: `cooldown-ativo:${Math.max(
        0,
        input.cooldownUntil - now,
      )}ms`,
      blockers: ["cooldown"],
      tripReason: null,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* FASE H — COOLDOWN CUMPRIDO: inspecionar ANTES de promover              */
  /* ---------------------------------------------------------------------- */
  if (state === waitingStateForStage(stage)) {
    return {
      kind: "WAIT",
      stateAfter: validatingStateForStage(stage),
      stageAfter: stage,
      reason: "cooldown-cumprido-inspecionando-antes-de-promover",
      blockers: ["inspecao"],
      tripReason: null,
    };
  }

  if (state !== validatingStateForStage(stage)) {
    // Estado e estágio divergentes (ex.: row criada manualmente). Fail-safe:
    // não promove nada, exige o operador.
    return noop(`estado-incoerente-com-o-estagio:${state}/${stage}`);
  }

  /* ---------------------------------------------------------------------- */
  /* FASE D/E/F — EVIDÊNCIA REAL + GATES VERDES                              */
  /* ---------------------------------------------------------------------- */
  const requiredDistinct = requiredDistinctListings(stage);
  const requiredCommits = requiredEvidenceCommits(stage);
  const blockers: string[] = [];

  if (gates.usedWrites < 1) {
    blockers.push("usedWrites=0-sem-escrita-real");
  }
  if (gates.v1Committed < requiredCommits) {
    blockers.push(`v1Committed=${gates.v1Committed}<${requiredCommits}`);
  }
  if (gates.uniqueExternalListings < requiredDistinct) {
    blockers.push(
      `listingsDistintas=${gates.uniqueExternalListings}<${requiredDistinct}`,
    );
  }
  if (gates.usedWrites > gates.maxWrites) {
    blockers.push("usedWrites>maxWrites");
  }

  if (blockers.length > 0) {
    return {
      kind: "WAIT",
      stateAfter: state,
      stageAfter: stage,
      reason: "evidencia-real-insuficiente",
      blockers,
      tripReason: null,
    };
  }

  const next = nextStageOf(stage);
  if (next === null) {
    // FASE G: estágio 100 com tudo verde => COMPLETED. Sem promotion acima.
    return {
      kind: "PROMOTE",
      stateAfter: "COMPLETED",
      stageAfter: AUTOPILOT_MAX_STAGE,
      reason: "estagio-100-com-evidencia-real-gates-verdes",
      blockers: [],
      tripReason: null,
    };
  }

  return {
    kind: "PROMOTE",
    stateAfter: waitingStateForStage(next),
    stageAfter: next,
    reason: `promovido-${stage}-para-${next}-com-evidencia-real`,
    blockers: [],
    tripReason: null,
  };
}

/* -------------------------------------------------------------------------- */
/* LINHA DE ESTADO                                                              */
/* -------------------------------------------------------------------------- */

export type AutopilotRow = {
  id: string;
  marketplaceId: string;
  state: AutopilotState;
  stage: number;
  enabled: boolean;
  cooldownUntil: Date;
  minObservationMs: number;
  version: number;
  stageStartedAt: Date;
  lastRunAt: Date | null;
  lastDecision: AutopilotDecisionKind | null;
  lastReason: string | null;
  tripReason: string | null;
  trippedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/* -------------------------------------------------------------------------- */
/* PROBES — OBSERVACIONAIS, NUNCA GATE (FASE V)                                 */
/* -------------------------------------------------------------------------- */

/**
 * Rotas sondadas com o status ESPERADO de cada uma.
 *
 * `/sitemap` e `/busca` NÃO são rotas deste projeto (o sitemap é `/sitemap.xml`
 * e a busca é `/?q=` na home). Um probe ingênuo trataria esses 404 como "site
 * fora" e poderia virar decisão destrutiva por causa de uma rota que nunca
 * existiu — exatamente o que FASE V proíbe. Por isso o status esperado é
 * explícito por rota.
 *
 * Esta lista mora AQUI, e não na rota HTTP, para que o cron e o operador
 * manual sondem exatamente as mesmas coisas. Duas definições divergentes
 * seriam duas fontes de verdade sobre a saúde do site.
 */
export const AUTOPILOT_PROBES: ReadonlyArray<{
  path: string;
  expected: number;
}> = [
  { path: "/", expected: 200 },
  { path: "/sitemap.xml", expected: 200 },
  { path: "/robots.txt", expected: 200 },
  { path: "/ofertas", expected: 200 },
  { path: "/categorias", expected: 200 },
  { path: "/?q=autopilot", expected: 200 },
];

/**
 * Executa os probes. OBSERVACIONAIS por contrato: um 500 externo isolado é
 * registrado e nada mais — não abre breaker e não bloqueia promoção, porque as
 * evidências que promovem (double-write, paridade, orçamento, publicação) são
 * medidas dentro do sistema, não por HTTP público.
 *
 * `origin === null` devolve lista vazia em vez de fingir que o site está
 * saudável: sem base não há probe, e "sem probe" é o estado honesto.
 */
export async function runAutopilotProbes(
  origin: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<
  Array<{ path: string; expected: number; actual: number }>
> {
  if (origin === null || origin === "") {
    return [];
  }
  return Promise.all(
    AUTOPILOT_PROBES.map(async (probe) => {
      try {
        const response = await fetchImpl(`${origin}${probe.path}`, {
          redirect: "manual",
          cache: "no-store",
        });
        return {
          path: probe.path,
          expected: probe.expected,
          actual: response.status,
        };
      } catch {
        return { path: probe.path, expected: probe.expected, actual: 0 };
      }
    }),
  );
}

/*
 * Colunas sempre entre aspas: em `SELECT` um nome solto seria dobrado para
 * minúsculas (`marketplaceid`) e a consulta falharia. As MESMAS strings
 * servem para o `RETURNING` do UPDATE, que não tem alias de tabela.
 */
const AUTOPILOT_COLUMNS = [
  "id",
  "marketplaceId",
  "state",
  "stage",
  "enabled",
  "cooldownUntil",
  "minObservationMs",
  "version",
  "stageStartedAt",
  "lastRunAt",
  "lastDecision",
  "lastReason",
  "tripReason",
  "trippedAt",
  "completedAt",
  "createdAt",
  "updatedAt",
]
  .map((column) => `"${column}"`)
  .join(", ");

function toAutopilotRow(row: Record<string, unknown>): AutopilotRow {
  return {
    id: String(row.id),
    marketplaceId: String(row.marketplaceId),
    state: String(row.state) as AutopilotState,
    stage: Number(row.stage),
    enabled: Boolean(row.enabled),
    cooldownUntil: new Date(String(row.cooldownUntil)),
    minObservationMs: Number(row.minObservationMs),
    version: Number(row.version),
    stageStartedAt: new Date(String(row.stageStartedAt)),
    lastRunAt: row.lastRunAt === null ? null : new Date(String(row.lastRunAt)),
    lastDecision:
      row.lastDecision === null
        ? null
        : (String(row.lastDecision) as AutopilotDecisionKind),
    lastReason: row.lastReason === null ? null : String(row.lastReason),
    tripReason: row.tripReason === null ? null : String(row.tripReason),
    trippedAt: row.trippedAt === null ? null : new Date(String(row.trippedAt)),
    completedAt:
      row.completedAt === null ? null : new Date(String(row.completedAt)),
    createdAt: new Date(String(row.createdAt)),
    updatedAt: new Date(String(row.updatedAt)),
  };
}

export async function readAutopilot(
  executor: CutoverSqlExecutor,
  marketplaceId: string,
): Promise<AutopilotRow | null> {
  const res = await executor.query(
    `SELECT ${AUTOPILOT_COLUMNS} FROM "CatalogCutoverAutopilot" WHERE "marketplaceId" = $1`,
    [marketplaceId],
  );
  if ((res.rowCount ?? 0) === 0) {
    return null;
  }
  return toAutopilotRow(res.rows[0] as Record<string, unknown>);
}

/**
 * Cria a linha de estado a partir do rollout JÁ EXISTENTE, sem rearmar nada.
 *
 * `stageStartedAt` é o instante REAL em que o estágio foi configurado (o
 * evento ARM daquele teto, ou `updatedAt` do rollout) — nunca `now()`. Assim o
 * cooldown do estágio 1 conta desde a configuração que o tráfego já atravessou,
 * e não desde a chegada do controlador. Fail-closed: se não há rollout, não há
 * autopilot.
 *
 * DOIS INTERRUPTORES, E NENHUM SOBRESCREVE O OUTRO:
 *   - AUTOPILOT_ENABLED (variável de ambiente) é o interruptor de IMPLANTAÇÃO,
 *     avaliado a CADA execução e nunca persistido;
 *   - enabled (coluna) é o interruptor DURÁVEL do operador, e só o operador o
 *     muda (via applyOperatorAction).
 *
 * Por isso a linha nasce com enabled = true e o ciclo NUNCA passa o valor do
 * ambiente. Se passasse, a primeira execução com AUTOPILOT_ENABLED=OFF — que a
 * missão exige para o deploy inicial — gravaria enabled = false e o autopilot
 * ficaria morto para sempre depois do ON, sem ninguém perceber. O fail-safe
 * continua duplo: desligar o ENV impede qualquer mutação naquele ciclo, e
 * desligar a COLUNA impede mesmo com o ENV ligado.
 */
export async function ensureAutopilot(
  executor: CutoverSqlExecutor,
  input: {
    marketplaceId: string;
    /** Só o valor INICIAL da linha. Nunca o AUTOPILOT_ENABLED do ambiente. */
    enabled?: boolean;
    minObservationMs?: number;
    stage?: number;
  },
): Promise<AutopilotRow | null> {
  const rollout = await readGlobalRollout(executor, input.marketplaceId);
  if (rollout === null) {
    return null;
  }

  /*
   * O estágio do autopilot nasce do TETO REAL do rollout, e só quando esse teto
   * está na escada. Um rollout com teto fora da escada (ex.: 3, o canário
   * legado) começa no primeiro degrau: inventar um estágio intermediário seria
   * fabricar progresso.
   */
  const stage = AUTOPILOT_LADDER.includes(rollout.maxWrites)
    ? rollout.maxWrites
    : (AUTOPILOT_LADDER[0] ?? 1);

  const armedAt = await stageArmedAt(executor, input.marketplaceId, stage);
  const minObservationMs = input.minObservationMs ?? AUTOPILOT_MIN_OBSERVATION_MS;

  const res = await executor.query(
    `
    INSERT INTO "CatalogCutoverAutopilot"
      ("id", "marketplaceId", "state", "stage", "enabled", "cooldownUntil",
       "minObservationMs", "version", "stageStartedAt", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, $1, $2::"CatalogCutoverAutopilotState", $3, $4,
            $5::timestamptz, $6, 0, $7::timestamptz, NOW(), NOW())
    ON CONFLICT ("marketplaceId") DO UPDATE SET
      "updatedAt" = NOW()
    RETURNING ${AUTOPILOT_COLUMNS}
    `,
    [
      input.marketplaceId,
      waitingStateForStage(stage),
      stage,
      input.enabled ?? true,
      new Date(armedAt.getTime() + minObservationMs),
      minObservationMs,
      armedAt,
    ],
  );

  return toAutopilotRow(res.rows[0] as Record<string, unknown>);
}

/** Quando o estágio foi configurado: o primeiro ARM daquele teto. */
async function stageArmedAt(
  executor: CutoverSqlExecutor,
  marketplaceId: string,
  stage: number,
): Promise<Date> {
  const res = await executor.query<{ "armedAt": Date | null }>(
    `SELECT MIN("createdAt") AS "armedAt" FROM "CatalogCutoverEvent"
      WHERE "marketplaceId" = $1
        AND "kind" = 'ARM'::"CatalogCutoverEventKind"
        AND "maxWrites" = $2`,
    [marketplaceId, stage],
  );
  const armedAt = (res.rows[0] as { armedAt: Date | null }).armedAt;
  return armedAt ?? new Date();
}

/* -------------------------------------------------------------------------- */
/* MÉTRICAS POR ESTÁGIO (derivadas do ledger append-only)                       */
/* -------------------------------------------------------------------------- */

export type StageMetrics = {
  stage: number;
  startedAt: string | null;
  lastEventAt: string | null;
  usedWrites: number;
  v1Attempts: number;
  v1Committed: number;
  v1Noop: number;
  fallbackUsed: number;
  budgetSkipped: number;
  doubleWrites: number;
  duplicates: number;
  identityCorruption: number;
  parityMatches: number;
  parityDifferences: number;
  expectedParityDifferences: number;
  unexpectedParityDifferences: number;
  publicationViolations: number;
  policyBlocked: number;
  v1Failures: number;
  systemCriticalErrors: number;
  breakerTrips: number;
  globalBudgetViolations: number;
  pathStructural: number;
  pathOfferOnly: number;
  pathUnknown: number;
  uniqueExternalListings: number;
  uniqueProducts: number;
  uniqueSellers: number;
  budgetSkippedListings: number;
};

/*
 * Uma consulta só, e ela é o ÚNICO lugar que interpreta o ledger para o
 * autopilot. O escopo do estágio é `maxWrites = $2`: como cada promoção
 * rearma o teto com `resetBudget`, todo evento posterior carrega o teto do
 * estágio em que ocorreu. Isso torna o agregado por estágio exato sem
 * nenhuma coluna nova e sem backfill.
 *
 * `systemCriticalErrors` é o número de execuções que tiveram V1_FAILED e
 * NENHUM commit (nem V1 nem fallback): ou seja, itens que o sistema realmente
 * deixou cair. Uma falha V1 seguida de fallback commitado é o comportamento
 * SEGURO de V1_PRIMARY_WITH_LEGACY_FALLBACK e NÃO conta.
 */
const STAGE_METRICS_SQL = `
WITH stage AS (
  SELECT * FROM "CatalogCutoverEvent"
   WHERE "marketplaceId" = $1 AND "maxWrites" = $2
), life AS (
  SELECT * FROM "CatalogCutoverEvent" WHERE "marketplaceId" = $1
)
SELECT
  MIN(s."createdAt")::text                                                          AS "startedAt",
  MAX(s."createdAt")::text                                                          AS "lastEventAt",
  GREATEST(
    COALESCE(MAX(s."usedWrites") FILTER (WHERE s."kind" = 'PERMIT_GRANTED'), 0),
    0
  )::int                                                                           AS "usedWrites",
  COUNT(*) FILTER (WHERE s."kind" = 'PERMIT_GRANTED')::int                         AS "v1Attempts",
  COUNT(*) FILTER (WHERE s."kind" = 'V1_COMMITTED')::int                          AS "v1Committed",
  COUNT(*) FILTER (WHERE s."kind" = 'V1_COMMITTED'
                     AND s."metadata"->>'writePath' = 'NOOP')::int                AS "v1Noop",
  COUNT(*) FILTER (WHERE s."kind" = 'FALLBACK_ATTEMPTED')::int                    AS "fallbackUsed",
  COUNT(*) FILTER (WHERE s."kind" = 'PERMIT_DENIED')::int                         AS "budgetSkipped",
  COUNT(*) FILTER (WHERE s."kind" = 'DOUBLE_WRITE')::int                          AS "doubleWrites",
  COUNT(*) FILTER (WHERE s."kind" = 'TRIP')::int                                  AS "breakerTrips",
  COUNT(*) FILTER (WHERE s."kind" = 'TRIP'
                     AND s."reason" = 'DUPLICATE_UNEXPECTED')::int                AS "duplicateTrips",
  COUNT(*) FILTER (WHERE s."kind" = 'PARITY_DIFFERENCE'
                     AND s."reason" = 'oferta-inexistente-apos-commit')::int      AS "missingOfferParity",
  COUNT(*) FILTER (WHERE s."kind" = 'TRIP'
                     AND s."reason" = 'IDENTITY_CORRUPTION')::int                 AS "identityTrips",
  COUNT(*) FILTER (WHERE s."kind" = 'PARITY_DIFFERENCE'
                     AND s."reason" = 'productId')::int                           AS "identityParity",
  COUNT(*) FILTER (WHERE s."kind" = 'PARITY_MATCH')::int                          AS "parityMatches",
  COUNT(*) FILTER (WHERE s."kind" = 'PARITY_DIFFERENCE')::int                     AS "parityDifferences",
  COUNT(*) FILTER (WHERE s."kind" = 'PARITY_DIFFERENCE'
                     AND s."metadata"->>'expected' = 'true')::int                 AS "expectedParityDifferences",
  COUNT(*) FILTER (WHERE s."kind" = 'PARITY_DIFFERENCE'
                     AND s."metadata"->>'expected' = 'false')::int                AS "unexpectedParityDifferences",
  COUNT(*) FILTER (WHERE s."kind" = 'V1_FAILED')::int                             AS "v1Failures",
  COUNT(*) FILTER (WHERE s."kind" = 'V1_FAILED'
                     AND left(COALESCE(s."reason", ''), 40) = ANY($3::text[]))::int AS "policyBlocked",
  COUNT(*) FILTER (WHERE s."usedWrites" IS NOT NULL
                     AND s."maxWrites" IS NOT NULL
                     AND s."usedWrites" > s."maxWrites")::int                    AS "budgetOverrunStage",
  COUNT(*) FILTER (WHERE s."kind" = 'TRIP'
                     AND s."reason" = 'WRITE_BUDGET_EXCEEDED')::int               AS "budgetTripsStage",
  COUNT(*) FILTER (WHERE s."kind" = 'V1_COMMITTED'
                     AND s."metadata"->>'writePath' = 'STRUCTURAL')::int           AS "pathStructural",
  COUNT(*) FILTER (WHERE s."kind" = 'V1_COMMITTED'
                     AND s."metadata"->>'writePath' = 'OFFER_ONLY')::int          AS "pathOfferOnly",
  COUNT(*) FILTER (WHERE s."kind" = 'V1_COMMITTED'
                     AND s."metadata"->>'writePath' IS NULL)::int                 AS "pathUnknown",
  COUNT(DISTINCT s."externalListingId")
    FILTER (WHERE s."kind" = 'V1_COMMITTED')::int                                 AS "uniqueExternalListings",
  COUNT(DISTINCT NULLIF(s."metadata"->>'productId', ''))
    FILTER (WHERE s."kind" = 'V1_COMMITTED')::int                                 AS "uniqueProducts",
  COUNT(DISTINCT NULLIF(s."metadata"->>'seller', ''))
    FILTER (WHERE s."kind" = 'V1_COMMITTED')::int                                 AS "uniqueSellers",
  COUNT(DISTINCT s."externalListingId")
    FILTER (WHERE s."kind" = 'PERMIT_DENIED')::int                                AS "budgetSkippedListings",
  (
    SELECT COUNT(*)::int FROM (
      SELECT DISTINCT f."executionId" FROM stage f
       WHERE f."kind" = 'V1_FAILED'
         AND NOT EXISTS (
           SELECT 1 FROM stage c
            WHERE c."executionId" = f."executionId"
              AND c."kind" IN ('V1_COMMITTED', 'FALLBACK_COMMITTED')
         )
    ) orphan
  )                                                                                AS "systemCriticalErrors",
  (
    SELECT COUNT(*)::int FROM (
      SELECT DISTINCT f."executionId" FROM life f
       WHERE f."kind" = 'V1_FAILED'
         AND NOT EXISTS (
           SELECT 1 FROM life c
            WHERE c."executionId" = f."executionId"
              AND c."kind" IN ('V1_COMMITTED', 'FALLBACK_COMMITTED')
         )
    ) orphanLife
  )::int                                                                           AS "systemCriticalErrorsLifetime",
  (SELECT COUNT(*)::int FROM life
    WHERE "kind" = 'DOUBLE_WRITE')::int                                            AS "doubleWritesLifetime"
FROM stage s`;

export async function collectStageMetrics(
  executor: CutoverSqlExecutor,
  marketplaceId: string,
  stage: number,
): Promise<StageMetrics> {
  const res = await executor.query<Record<string, unknown>>(STAGE_METRICS_SQL, [
    marketplaceId,
    stage,
    [...AUTOPILOT_POLICY_BLOCK_CODES],
  ]);
  const row = (res.rows[0] ?? {}) as Record<string, unknown>;
  const n = (key: string): number => Number(row[key] ?? 0);

  return {
    stage,
    startedAt: (row.startedAt as string | null) ?? null,
    lastEventAt: (row.lastEventAt as string | null) ?? null,
    usedWrites: n("usedWrites"),
    v1Attempts: n("v1Attempts"),
    v1Committed: n("v1Committed"),
    v1Noop: n("v1Noop"),
    fallbackUsed: n("fallbackUsed"),
    budgetSkipped: n("budgetSkipped"),
    doubleWrites: n("doubleWrites") + n("doubleWritesLifetime"),
    duplicates: n("duplicateTrips") + n("missingOfferParity"),
    identityCorruption: n("identityTrips") + n("identityParity"),
    parityMatches: n("parityMatches"),
    parityDifferences: n("parityDifferences"),
    expectedParityDifferences: n("expectedParityDifferences"),
    unexpectedParityDifferences: n("unexpectedParityDifferences"),
    // Publicação é invariants de LIVE: uma violação jáLifetime-contada ainda
    // reprova o estágio, porque AUTO_ACTIVE_LT2 é sempre 0 por contrato.
    publicationViolations: 0,
    policyBlocked: n("policyBlocked"),
    v1Failures: n("v1Failures"),
    systemCriticalErrors:
      n("systemCriticalErrors") + n("systemCriticalErrorsLifetime"),
    breakerTrips: n("breakerTrips"),
    globalBudgetViolations: n("budgetOverrunStage") + n("budgetTripsStage"),
    pathStructural: n("pathStructural"),
    pathOfferOnly: n("pathOfferOnly"),
    pathUnknown: n("pathUnknown"),
    uniqueExternalListings: n("uniqueExternalListings"),
    uniqueProducts: n("uniqueProducts"),
    uniqueSellers: n("uniqueSellers"),
    budgetSkippedListings: n("budgetSkippedListings"),
  };
}

/** Grava o agregado do estágio (derivado => UPSERT, nunca divergente). */
export async function persistStageMetrics(
  executor: CutoverSqlExecutor,
  marketplaceId: string,
  metrics: StageMetrics,
  extra: { maxWrites: number; completedAt?: Date | null },
): Promise<void> {
  await executor.query(
    `
    INSERT INTO "CatalogCutoverStageMetric"
      ("id", "marketplaceId", "stage", "startedAt", "completedAt", "maxWrites",
       "usedWrites", "v1Attempts", "v1Committed", "v1Noop", "fallbackUsed",
       "budgetSkipped", "doubleWrites", "duplicates", "parityMatches",
       "parityDifferences", "publicationViolations", "policyBlocked",
       "systemErrors", "breakerTrips", "pathStructural", "pathOfferOnly",
       "pathUnknown", "uniqueExternalListings", "uniqueProducts", "uniqueSellers",
       "fastOfferReviewPending", "metadata", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, $1, $2, $3::timestamptz, $4::timestamptz, $5,
            $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
            $20, $21, $22, $23, $24, $25, $26, $27::jsonb, NOW(), NOW())
    ON CONFLICT ("marketplaceId", "stage") DO UPDATE SET
      "startedAt" = EXCLUDED."startedAt",
      "completedAt" = COALESCE(EXCLUDED."completedAt", "CatalogCutoverStageMetric"."completedAt"),
      "maxWrites" = EXCLUDED."maxWrites",
      "usedWrites" = EXCLUDED."usedWrites",
      "v1Attempts" = EXCLUDED."v1Attempts",
      "v1Committed" = EXCLUDED."v1Committed",
      "v1Noop" = EXCLUDED."v1Noop",
      "fallbackUsed" = EXCLUDED."fallbackUsed",
      "budgetSkipped" = EXCLUDED."budgetSkipped",
      "doubleWrites" = EXCLUDED."doubleWrites",
      "duplicates" = EXCLUDED."duplicates",
      "parityMatches" = EXCLUDED."parityMatches",
      "parityDifferences" = EXCLUDED."parityDifferences",
      "publicationViolations" = EXCLUDED."publicationViolations",
      "policyBlocked" = EXCLUDED."policyBlocked",
      "systemErrors" = EXCLUDED."systemErrors",
      "breakerTrips" = EXCLUDED."breakerTrips",
      "pathStructural" = EXCLUDED."pathStructural",
      "pathOfferOnly" = EXCLUDED."pathOfferOnly",
      "pathUnknown" = EXCLUDED."pathUnknown",
      "uniqueExternalListings" = EXCLUDED."uniqueExternalListings",
      "uniqueProducts" = EXCLUDED."uniqueProducts",
      "uniqueSellers" = EXCLUDED."uniqueSellers",
      "fastOfferReviewPending" = EXCLUDED."fastOfferReviewPending",
      "metadata" = EXCLUDED."metadata",
      "updatedAt" = NOW()
    `,
    [
      marketplaceId,
      metrics.stage,
      metrics.startedAt,
      extra.completedAt ?? null,
      extra.maxWrites,
      metrics.usedWrites,
      metrics.v1Attempts,
      metrics.v1Committed,
      metrics.v1Noop,
      metrics.fallbackUsed,
      metrics.budgetSkipped,
      metrics.doubleWrites,
      metrics.duplicates,
      metrics.parityMatches,
      metrics.parityDifferences,
      metrics.publicationViolations,
      metrics.policyBlocked,
      metrics.systemCriticalErrors,
      metrics.breakerTrips,
      metrics.pathStructural,
      metrics.pathOfferOnly,
      metrics.pathUnknown,
      metrics.uniqueExternalListings,
      metrics.uniqueProducts,
      metrics.uniqueSellers,
      // FASE M: um OFFER_ONLY com preço trocado precisa de revisão de
      // PriceHistory. Contado aqui para o operador, nunca como gate.
      metrics.pathOfferOnly,
      JSON.stringify({
        identityCorruption: metrics.identityCorruption,
        expectedParityDifferences: metrics.expectedParityDifferences,
        unexpectedParityDifferences: metrics.unexpectedParityDifferences,
        globalBudgetViolations: metrics.globalBudgetViolations,
        v1Failures: metrics.v1Failures,
        budgetSkippedListings: metrics.budgetSkippedListings,
        lastEventAt: metrics.lastEventAt,
      }),
    ],
  );
}

/* -------------------------------------------------------------------------- */
/* TRANSIÇÃO (compare-and-swap) E LOG DE DECISÕES                              */
/* -------------------------------------------------------------------------- */

export type AutopilotTransition = {
  marketplaceId: string;
  expectedVersion: number;
  expectedState: AutopilotState;
  /**
   * Estágio esperado, lido da MESMA linha que deu a versão. Não é derivado do
   * nome do estado: `PAUSED` e `TRIPPED` não carregam estágio no nome, e
   * deduzir `null` ali faria o CAS nunca casar (travando pausa/resume).
   */
  expectedStage: number;
  nextState: AutopilotState;
  nextStage: number;
  decision: AutopilotDecisionKind;
  reason: string;
  tripReason?: string | null;
  /** Avança o cooldown para o próximo estágio (FASE H). */
  cooldownFromMs?: number;
  /**
   * Recomeça o cooldown MESMO sem mudar o estágio. Usado por `pause`/`resume`:
   * retomar não pode promover na mesma rajada em que o operador voltou.
   */
  resetCooldown?: boolean;
  now?: Date;
};

/**
 * A transição de estado. `null` no retorno significa PERDA DA CORRIDA: outro
 * ator mudou a linha entre a leitura e este UPDATE, e esta execução não
 * promove nada.
 */
export async function tryTransition(
  executor: CutoverSqlExecutor,
  input: AutopilotTransition,
): Promise<AutopilotRow | null> {
  const now = input.now ?? new Date();
  const cooldownFromMs = input.cooldownFromMs ?? AUTOPILOT_MIN_OBSERVATION_MS;

  const res = await executor.query(
    `
    UPDATE "CatalogCutoverAutopilot"
       SET "state" = $5::"CatalogCutoverAutopilotState",
           "stage" = $6,
           "version" = "version" + 1,
           "lastRunAt" = $7::timestamptz,
           "lastDecision" = $8::"CatalogCutoverAutopilotDecision",
           "lastReason" = $9,
            /*
             * tripReason/trippedAt sao a ULTIMA ocorrencia, nao o estado
             * atual: sao o rastro forense que a missao exige persistir e por
             * isso NUNCA sao apagados, nem por um resume. Quem decide se o
             * autopilot esta tripado e a coluna state; a razao fica como
             * historico, e o log append-only guarda a linha do tempo completa.
             */
           "tripReason" = CASE WHEN $5 = 'TRIPPED' THEN $10 ELSE "tripReason" END,
           "trippedAt" = CASE WHEN $5 = 'TRIPPED' THEN $7::timestamptz ELSE "trippedAt" END,
           "completedAt" = CASE WHEN $5 = 'COMPLETED' THEN $7::timestamptz ELSE "completedAt" END,
           "stageStartedAt" = CASE WHEN $6 <> "stage" THEN $7::timestamptz ELSE "stageStartedAt" END,
           "cooldownUntil" = CASE WHEN $6 <> "stage" OR $12
                                  THEN $7::timestamptz + ($11::int * INTERVAL '1 millisecond')
                                  ELSE "cooldownUntil" END,
           "updatedAt" = $7::timestamptz
     WHERE "marketplaceId" = $1
       AND "version" = $2
       AND "state" = $3::"CatalogCutoverAutopilotState"
       AND "stage" = $4
    RETURNING ${AUTOPILOT_COLUMNS}
    `,
    [
      input.marketplaceId,
      input.expectedVersion,
      input.expectedState,
      // `stage` esperada: parte do CAS. Sem ela, um ator com leitura velha
      // poderia promover a partir de um estágio que já não é o dele.
      input.expectedStage,
      input.nextState,
      input.nextStage,
      now,
      input.decision,
      input.reason,
      input.tripReason ?? null,
      cooldownFromMs,
      input.resetCooldown ?? false,
    ],
  );

  if ((res.rowCount ?? 0) === 0) {
    return null;
  }
  return toAutopilotRow(res.rows[0] as Record<string, unknown>);
}

export type AutopilotRunInput = {
  marketplaceId: string;
  stateBefore: AutopilotState | null;
  stateAfter: AutopilotState | null;
  decision: AutopilotDecisionKind;
  stageBefore: number | null;
  stageAfter: number | null;
  maxWrites: number | null;
  usedWrites: number | null;
  versionBefore: number | null;
  versionAfter: number | null;
  promoted: boolean;
  executionId: string;
  reason: string | null;
  blockers: string[];
  evidence: unknown;
  metrics: unknown;
};

/**
 * Log append-only do ciclo. `executionId` é único: reexecutar o MESMO ciclo
 * (retry de cron, double-trigger do Vercel) não duplica linha — é a prova de
 * idempotência do controlador.
 */
export async function recordAutopilotRun(
  executor: CutoverSqlExecutor,
  run: AutopilotRunInput,
): Promise<boolean> {
  const res = await executor.query(
    `
    INSERT INTO "CatalogCutoverAutopilotRun"
      ("id", "marketplaceId", "stateBefore", "stateAfter", "decision",
       "stageBefore", "stageAfter", "maxWrites", "usedWrites", "versionBefore",
       "versionAfter", "promoted", "executionId", "reason", "blockers",
       "evidence", "metrics", "createdAt")
    VALUES (gen_random_uuid()::text, $1, $2::"CatalogCutoverAutopilotState",
            $3::"CatalogCutoverAutopilotState", $4::"CatalogCutoverAutopilotDecision",
            $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb,
            $16::jsonb, NOW())
    ON CONFLICT ("executionId") DO NOTHING
    `,
    [
      run.marketplaceId,
      run.stateBefore,
      run.stateAfter,
      run.decision,
      run.stageBefore,
      run.stageAfter,
      run.maxWrites,
      run.usedWrites,
      run.versionBefore,
      run.versionAfter,
      run.promoted,
      run.executionId,
      run.reason,
      JSON.stringify(run.blockers),
      JSON.stringify(run.evidence ?? null),
      JSON.stringify(run.metrics ?? null),
    ],
  );
  return (res.rowCount ?? 0) > 0;
}

/* -------------------------------------------------------------------------- */
/* ORQUESTRADOR DO CICLO                                                        */
/* -------------------------------------------------------------------------- */

/** Auditoria de publicação: SOMENTE LEITURA, dry-run. */
export type PublicationAudit = {
  scanned: number;
  violations: number;
};

/** Probes HTTP: registro apenas, nunca gate (FASE V). */
export type ProbeResult = {
  path: string;
  expected: number;
  actual: number;
};

export type AutopilotCycleOptions = {
  executor: CutoverSqlExecutor;
  marketplaceId: string;
  /** Habilita a progressão (equivale a AUTOPILOT_ENABLED=ON para este id). */
  enabled: boolean;
  publicationAudit: () => Promise<PublicationAudit>;
  probes?: () => Promise<ProbeResult[]>;
  minObservationMs?: number;
  executionId?: string;
  now?: Date;
  /**
   * `false` em leitura/inspeção: o ciclo avalia e registra, mas não promove,
   * não rearma e não tripou. É o que permite subir o autopilot desligado.
   */
  allowMutations?: boolean;
};

export type AutopilotCycleResult = {
  marketplaceId: string;
  state: AutopilotState;
  stage: number;
  decision: AutopilotDecision;
  recorded: boolean;
  promoted: boolean;
  tripped: boolean;
  lostRace: boolean;
  budgetReconciled: boolean;
  executionId: string;
  metrics: StageMetrics;
  rollout: {
    mode: string;
    enabled: boolean;
    legacyFallbackEnabled: boolean;
    maxWrites: number;
    usedWrites: number;
    breakerState: string;
  } | null;
  autoActiveLt2: number;
  probes: ProbeResult[];
  skippedReason: string | null;
};

/**
 * Um ciclo do controlador: serializa com advisory lock, lê o estado
 * PERSISTIDO, agrega a evidência do ledger, decide por função pura, promove
 * por CAS e só então reconfigura o orçamento.
 */
export async function runAutopilotCycle(
  options: AutopilotCycleOptions,
): Promise<AutopilotCycleResult> {
  const { executor, marketplaceId } = options;
  const now = options.now ?? new Date();
  const executionId = options.executionId ?? `autopilot:${randomUUID()}`;
  const allowMutations = options.allowMutations ?? true;

  const rollout = await readGlobalRollout(executor, marketplaceId);
  if (rollout === null) {
    throw new Error(`ROLLOUT_ABSENT:${marketplaceId}`);
  }

  const row =
    (await readAutopilot(executor, marketplaceId)) ??
    (await ensureAutopilot(executor, {
      marketplaceId,
      minObservationMs: options.minObservationMs,
      stage: AUTOPILOT_LADDER.includes(rollout.maxWrites)
        ? rollout.maxWrites
        : AUTOPILOT_LADDER[0],
    }));

  if (row === null) {
    throw new Error(`AUTOPILOT_INIT_FAILED:${marketplaceId}`);
  }

  const metrics = await collectStageMetrics(executor, marketplaceId, row.stage);
  const audit = await options.publicationAudit();
  const probes = (await options.probes?.()) ?? [];

  const gates: AutopilotGates = {
    usedWrites: Math.max(metrics.usedWrites, rollout.usedWrites),
    maxWrites: Math.max(metrics.usedWrites, rollout.maxWrites),
    v1Committed: metrics.v1Committed,
    uniqueExternalListings: metrics.uniqueExternalListings,
    doubleWrites: metrics.doubleWrites,
    duplicates: metrics.duplicates,
    identityCorruption: metrics.identityCorruption,
    unexpectedParityDifferences: metrics.unexpectedParityDifferences,
    globalBudgetViolations: metrics.globalBudgetViolations,
    systemCriticalErrors: metrics.systemCriticalErrors,
    policyBlocked: metrics.policyBlocked,
    autoActiveLt2: audit.violations,
    breakerState: rollout.breakerState,
  };

  const disabled: string | null =
    !row.enabled || !options.enabled
      ? "autopilot-desabilitado"
      : !allowMutations
        ? "somente-leitura"
        : null;

  /*
   * Com o autopilot desligado o ciclo AINDA avalia e registra (é assim que se
   * prova a elegibilidade antes de habilitar), mas a decisão é congelada em
   * WAIT: nada de promoção, nada de TRIP automático, nada de rearm.
   */
  const decision: AutopilotDecision =
    disabled === null
      ? decideAutopilot({
          state: row.state,
          stage: row.stage,
          gates,
          now: now.getTime(),
          cooldownUntil: row.cooldownUntil.getTime(),
          minObservationMs: row.minObservationMs,
        })
      : {
          kind: "WAIT",
          stateAfter: row.state,
          stageAfter: row.stage,
          reason: disabled,
          blockers: [disabled],
          tripReason: null,
        };

  /* ---------------------------------------------------------------------- */
  /* APLICAÇÃO: CAS primeiro, efeito depois                                 */
  /* ---------------------------------------------------------------------- */
  let current = row;
  let lostRace = false;
  let promoted = false;
  let tripped = false;

  /*
   * Qualquer MUDANÇA de estado é persistida por CAS — não só a promoção. O
   * passo `WAITING_n -> VALIDATING_n` é uma transição de estado que não toca
   * o orçamento, mas sem persistir ela a máquina voltaria a WAITING_n para
   * sempre e a progressão nunca sairia do primeiro degrau.
   */
  const changesState =
    decision.stateAfter !== row.state || decision.stageAfter !== row.stage;

  if (decision.kind === "TRIP" && decision.tripReason !== null) {
    /*
     * FASE I + rollback sem deploy: abrir o breaker GLOBAL é o que devolve
     * o marketplace a LEGACY_ONLY em TODAS as instâncias, sem novo deploy e
     * sem tocar no catálogo. É idempotente e nunca se fecha sozinho.
     */
    await tripGlobalBreaker(executor, {
      rolloutId: rollout.id,
      marketplaceId,
      reason: decision.tripReason,
      executionId,
      metadata: {
        autopilot: true,
        stage: row.stage,
        blockers: decision.blockers,
      },
    });
  }

  if (decision.kind === "PROMOTE" || decision.kind === "TRIP" || changesState) {
    const transitioned = await tryTransition(executor, {
      marketplaceId,
      expectedVersion: row.version,
      expectedState: row.state,
      expectedStage: row.stage,
      nextState: decision.stateAfter,
      nextStage: decision.stageAfter,
      decision: decision.kind as AutopilotDecisionKind,
      reason: decision.reason,
      tripReason: decision.tripReason,
      cooldownFromMs: row.minObservationMs,
      now,
    });

    if (transitioned === null) {
      lostRace = true;
    } else {
      current = transitioned;
      promoted = decision.kind === "PROMOTE";
      tripped = decision.kind === "TRIP";
    }
  }

  /*
   * Reconciliação do orçamento: o ESTADO manda. Se o teto do rollout não
   * corresponde ao estágio persistido (promoção interrompida no meio, ou
   * intervenção manual), o ciclo o corrige — inclusive ao voltar de PAUSED.
   */
  let budgetReconciled = false;
  const mode = rollout.mode as CatalogWriterMode;
  if (!lostRace && !tripped) {
    const stageMax = current.stage;
    const needsRearm =
      rollout.maxWrites !== stageMax ||
      (promoted && rollout.usedWrites > 0);

    /*
     * `breakerState = OPEN` NUNCA é rearmeado aqui. Com o breaker aberto o
     * marketplace já está em LEGACY_ONLY, que é o rollback correto; o teto é
     * reconciliado no próximo ciclo, depois que o OPERADOR fechar o breaker.
     */
    if (
      needsRearm &&
      allowMutations &&
      disabled === null &&
      rollout.breakerState === "CLOSED"
    ) {
      await armGlobalRollout(executor, {
        marketplaceId,
        mode,
        enabled: true,
        // FASE G: o fallback legado NUNCA é removido na progressão.
        legacyFallbackEnabled: true,
        maxWrites: stageMax,
        resetBudget: true,
        // Só o operador reabre breaker, e por comando explícito.
        closeBreaker: false,
        note: `FASE 7.2 autopilot: estágio ${stageMax}`,
      });
      budgetReconciled = true;
    }
  }

  const effectiveRollout = await readGlobalRollout(executor, marketplaceId);

  /*
   * `maxWrites` aqui é o teto QUE VALIA durante a janela medida, ou seja
   * `rollout.maxWrites` ANTES de qualquer rearm. Passar o
   * `effectiveRollout.maxWrites` (pós-rearm) gravaria na linha do estágio 1 o
   * teto 5, e a linha do estágio 25 o teto 100: cada estágio mentiria sobre o
   * próprio teto. A janela é medida por `maxWrites = <estágio>` na CTE, e é
   * esse o número que a linha tem de carregar.
   */
  await persistStageMetrics(executor, marketplaceId, metrics, {
    maxWrites: rollout.maxWrites,
    completedAt: promoted ? now : null,
  });

  const recorded = await recordAutopilotRun(executor, {
    marketplaceId,
    stateBefore: row.state,
    stateAfter: current.state,
    decision:
      lostRace
        ? "NOOP"
        : tripped
          ? "TRIP"
          : promoted
            ? "PROMOTE"
            : (decision.kind as AutopilotDecisionKind),
    stageBefore: row.stage,
    stageAfter: current.stage,
    maxWrites: rollout.maxWrites,
    usedWrites: rollout.usedWrites,
    versionBefore: row.version,
    versionAfter: current.version,
    promoted,
    executionId,
    reason: lostRace ? "corrida-perdida-sem-promocao" : decision.reason,
    blockers: decision.blockers,
    evidence: {
      gates,
      requiredDistinctListings: requiredDistinctListings(row.stage),
      requiredEvidenceCommits: requiredEvidenceCommits(row.stage),
      cooldownUntil: row.cooldownUntil.toISOString(),
      minObservationMs: row.minObservationMs,
      stageStartedAt: row.stageStartedAt.toISOString(),
      publicationAudit: audit,
      probes,
      disabled,
    },
    metrics,
  });

  return {
    marketplaceId,
    state: current.state,
    stage: current.stage,
    decision,
    recorded,
    promoted,
    tripped,
    lostRace,
    budgetReconciled,
    executionId,
    metrics,
    rollout: effectiveRollout
      ? {
          mode: effectiveRollout.mode,
          enabled: effectiveRollout.enabled,
          legacyFallbackEnabled: effectiveRollout.legacyFallbackEnabled,
          maxWrites: effectiveRollout.maxWrites,
          usedWrites: effectiveRollout.usedWrites,
          breakerState: effectiveRollout.breakerState,
        }
      : null,
    autoActiveLt2: audit.violations,
    probes,
    skippedReason: disabled,
  };
}

/* -------------------------------------------------------------------------- */
/* CONTROLE DO OPERADOR (FASE P)                                               */
/* -------------------------------------------------------------------------- */

/**
 * PAUSE / RESUME / enable — as únicas mutações que o operador precisa para
 * parar a progressão automática SEM deploy.
 *
 * `pause` congela a progressão mas preserva o estágio; `resume` volta ao
 * estado derivado do estágio e REINICIA o cooldown, de modo que retomar nunca
 * promove na mesma rajada em que o operador voltou.
 *
 * Nenhum dos dois mexe no orçamento, no breaker ou no catálogo: quem controla
 * o orçamento continua sendo `armGlobalRollout`, e quem controla o rollback
 * continua sendo o breaker global.
 */
export type AutopilotOperatorAction = "pause" | "resume" | "enable" | "disable";

export async function applyOperatorAction(
  executor: CutoverSqlExecutor,
  input: {
    marketplaceId: string;
    action: AutopilotOperatorAction;
    reason?: string | null;
    now?: Date;
  },
): Promise<AutopilotRow> {
  const now = input.now ?? new Date();
  const row = await readAutopilot(executor, input.marketplaceId);
  if (row === null) {
    throw new Error(`AUTOPILOT_ABSENT:${input.marketplaceId}`);
  }

  if (input.action === "enable" || input.action === "disable") {
    const res = await executor.query(
      `UPDATE "CatalogCutoverAutopilot"
          SET "enabled" = $2, "version" = "version" + 1, "updatedAt" = $3::timestamptz
        WHERE "marketplaceId" = $1
        RETURNING ${AUTOPILOT_COLUMNS}`,
      [input.marketplaceId, input.action === "enable", now],
    );
    return toAutopilotRow(res.rows[0] as Record<string, unknown>);
  }

  const nextState: AutopilotState =
    input.action === "pause" ? "PAUSED" : waitingStateForStage(row.stage);
  const decision: AutopilotDecisionKind =
    input.action === "pause" ? "PAUSE" : "RESUME";

  const transitioned = await tryTransition(executor, {
    marketplaceId: input.marketplaceId,
    expectedVersion: row.version,
    expectedState: row.state,
    expectedStage: row.stage,
    nextState,
    nextStage: row.stage,
    decision,
    reason: input.reason ?? `operador:${input.action}`,
    cooldownFromMs: row.minObservationMs,
    resetCooldown: true,
    now,
  });

  if (transitioned === null) {
    throw new Error(
      `OPERATOR_ACTION_LOST_RACE:${input.marketplaceId}:${input.action}`,
    );
  }
  return transitioned;
}

/* -------------------------------------------------------------------------- */
/* TRAVAS DE CONCORRÊNCIA                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Lock de execução por marketplaceId.
 *
 * O CAS de `tryTransition` já é suficiente para impedir promoção dupla (é a
 * garantia que importa). O advisory lock existe para não gastar uma janela de
 * observação com dois processos lendo o MESMO estado: o perdedor sai
 * imediatamente como no-op, sem nem avaliar. `pg_try_advisory_lock` é
 * try-lock de SESSÃO: quem não pega devolve false e o ciclo nem começa.
 */
export const AUTOPILOT_LOCK_NAMESPACE = "fase72-autopilot";

export function autopilotLockKey(marketplaceId: string): string {
  return `${AUTOPILOT_LOCK_NAMESPACE}:${marketplaceId}`;
}

export async function tryAutopilotLock(
  executor: CutoverSqlExecutor,
  marketplaceId: string,
): Promise<boolean> {
  const res = await executor.query<{ locked: boolean }>(
    "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
    [autopilotLockKey(marketplaceId)],
  );
  return Boolean((res.rows[0] as { locked: boolean }).locked);
}

export async function releaseAutopilotLock(
  executor: CutoverSqlExecutor,
  marketplaceId: string,
): Promise<void> {
  await executor.query("SELECT pg_advisory_unlock(hashtext($1))", [
    autopilotLockKey(marketplaceId),
  ]);
}

/** Envolve o ciclo no lock. Sem lock => resultado explícito `skipped`. */
export async function runAutopilotCycleLocked(
  options: AutopilotCycleOptions,
): Promise<AutopilotCycleResult | { skipped: true; reason: string }> {
  const locked = await tryAutopilotLock(options.executor, options.marketplaceId);
  if (!locked) {
    return {
      skipped: true,
      reason: "outra-execucao-do-controlador-em-andamento",
    };
  }
  try {
    return await runAutopilotCycle(options);
  } finally {
    await releaseAutopilotLock(options.executor, options.marketplaceId);
  }
}
