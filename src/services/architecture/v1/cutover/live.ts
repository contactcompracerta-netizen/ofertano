/**
 * CATALOG_ARCHITECTURE_V1 — GATE LIVE AUTORITATIVO (FASE 7.1).
 *
 * Este é o ÚNICO ponto onde tráfego normal de escrita decide se o V1 é o
 * writer autoritativo daquele marketplaceId, e o orquestrador de
 * single-write ownership em torno da transação canônica.
 *
 * O que este módulo FAZ:
 *   - resolve o rollout global por `marketplaceId` (nunca por nome de
 *     marketplace em código);
 *   - adquire UMA permissão global de escrita, atomicamente, no banco;
 *   - decide a rota: `authoritative:true` => V1 primário; `false` =>
 *     LEGACY_ONLY, exatamente o comportamento de sempre;
 *   - garante single-write ownership: V1 commitou => o legado NÃO escreve;
 *     falha PRÉ-COMMIT transitória => o fallback pode assumir; falha
 *     PÓS-COMMIT (fronteira ambígua) => o legado NUNCA escreve;
 *   - observa a paridade pós-commit e fecha o breaker global quando
 *     necessário.
 *
 * O que este módulo NUNCA faz:
 *   - forçar publicação, ativar produto, ou contornar o gate multiloja: ele
 *     decide APENAS ATRIBUIÇÃO e ROTA. Toda a validação, os identity guards e
 *     a PublicationEligibility continuam rodando DENTRO da transação
 *     canônica que ele apenas envolve;
 *   - tratar "orçamento esgotado" como erro. Esgotar o orçamento é o
 *     comportamento esperado do canário: a listagem segue pelo legado.
 *   - permitir cutover global. Não existe linha "todos os marketplaces" aqui.
 */



import type { CutoverBreakerReason } from "./breaker";
import { SAFE_V1_ERROR_LIMIT } from "./breaker";
import { allowsLegacyFallbackForCode, classifyV1Failure } from "./classifier";
import type { V1FailureCode } from "./classifier";
import {
  acquireGlobalPermit,
  countRecentV1Failures,
  globalControlPool,
  recordGlobalEvent,
  tripGlobalBreaker,
  type CutoverSqlExecutor,
  type GlobalPermitDenyReason,
} from "./globalControl";
import type { LivePostWriteObservation } from "./liveParity";
import { getCutoverMetrics } from "./metrics";
import { allowsLegacyFallback, isV1AuthoritativeMode } from "./policy";
import type { CatalogWriterMode } from "./policy";

/* -------------------------------------------------------------------------- */
/* TIPOS                                                                      */
/* -------------------------------------------------------------------------- */

export type LiveWriteDenyReason = GlobalPermitDenyReason | "CONTROL_UNAVAILABLE";

/**
 * Contexto de UMA tentativa de escrita no funil real.
 *
 * `authoritative` é a decisão de ATRIBUIÇÃO. `settled` marca um contexto que
 * JÁ teve sua contabilidade resolvida (bypass interno de replay/canário) e por
 * isso não pode ser liquidado de novo.
 */
export type LiveWriteContext = {
  marketplaceId: string;
  externalListingId: string;
  /** "" quando não houve aquisição (sem permissão / bypass). */
  executionId: string;
  authoritative: boolean;
  mode: CatalogWriterMode;
  denyReason: LiveWriteDenyReason | null;
  rolloutId: string | null;
  legacyFallbackEnabled: boolean;
  usedWrites: number | null;
  maxWrites: number | null;
  settled: boolean;
  fallbackAttempted: boolean;
};

/** Fronteira de commit: `COMMITTED`, rollback confirmado ou COMMIT_UNKNOWN. */
export type LiveCommitPhase = "COMMITTED" | "ROLLED_BACK" | "COMMIT_UNKNOWN";

export type LiveWriteFailure = {
  failureCode: V1FailureCode;
  commitPhase: LiveCommitPhase;
  fallbackCommitted: boolean;
  fallbackFailureCode: V1FailureCode | null;
  fallbackCommitPhase: LiveCommitPhase | null;
};

export type LiveWriteResultKind =
  | "V1_COMMITTED"
  | "LEGACY_FALLBACK_COMMITTED";

export type LiveWriteOutcome<T> = {
  kind: LiveWriteResultKind | "LEGACY_ONLY";
  result: T;
  failure: LiveWriteFailure | null;
};

/* -------------------------------------------------------------------------- */
/* AQUISIÇÃO                                                                  */
/* -------------------------------------------------------------------------- */

function nonAuthoritative(
  marketplaceId: string,
  externalListingId: string,
  reason: LiveWriteDenyReason,
  mode: CatalogWriterMode = "LEGACY_ONLY",
  rolloutId: string | null = null,
  usedWrites: number | null = null,
  maxWrites: number | null = null,
  legacyFallbackEnabled = true,
): LiveWriteContext {
  return {
    marketplaceId,
    externalListingId,
    executionId: "",
    authoritative: false,
    mode,
    denyReason: reason,
    rolloutId,
    legacyFallbackEnabled,
    usedWrites,
    maxWrites,
    settled: false,
    fallbackAttempted: false,
  };
}

/**
 * Ponto de decisão do funil real.
 *
 * DEPOIS da validação (sem externalId/preço/URL não há escrita a autorizar) e
 * ANTES da transação canônica. NUNCA bloqueia: no pior caso resolve
 * LEGACY_ONLY, que é o comportamento de sempre.
 */
export async function beginLiveCutoverWrite(input: {
  marketplaceId: string;
  externalListingId: string;
  env?: Record<string, string | undefined>;
  executor?: CutoverSqlExecutor | null;
}): Promise<LiveWriteContext> {
  const env = input.env ?? process.env;
  const metrics = getCutoverMetrics();
  const { marketplaceId, externalListingId } = input;

  const executor =
    input.executor === undefined
      ? globalControlPool(env.DATABASE_URL)
      : input.executor;

  // Sem plano de controle => fail-closed para o legado. Zero escrita V1.
  if (!executor) {
    metrics.incLiveLegacyOnly(marketplaceId);
    return nonAuthoritative(
      marketplaceId,
      externalListingId,
      "CONTROL_UNAVAILABLE",
    );
  }

  let outcome;
  try {
    outcome = await acquireGlobalPermit(executor, {
      marketplaceId,
      externalListingId,
    });
  } catch (error) {
    /*
     * Falha de infraestrutura no plano de controle NÃO pode virar escrita
     * autoritativa: fail-closed para o legado. E, como o breaker é o
     * mecanismo de rollback, uma indisponibilidade do próprio plano de
     * controle também impede o V1 — que é exatamente o comportamento seguro.
     */
    console.error(
      "[LIVE_CUTOVER] aquisicao de permissao global falhou; degradando para LEGACY_ONLY",
      error,
    );
    metrics.incLiveLegacyOnly(marketplaceId);
    return nonAuthoritative(
      marketplaceId,
      externalListingId,
      "CONTROL_UNAVAILABLE",
    );
  }

  if (!outcome.granted) {
    const rollout = outcome.rollout;
    metrics.setGlobalBudget(
      marketplaceId,
      outcome.usedWrites ?? rollout?.usedWrites ?? 0,
      outcome.maxWrites ?? rollout?.maxWrites ?? 0,
    );
    metrics.incLiveLegacyOnly(marketplaceId);

    // `BUDGET_EXCEEDED` é violação do teto global, não simples exaustão.
    if (outcome.reason === "BUDGET_EXCEEDED" && rollout) {
      await tripGlobalBreaker(executor, {
        rolloutId: rollout.id,
        marketplaceId,
        reason: "WRITE_BUDGET_EXCEEDED",
        metadata: {
          usedWrites: rollout.usedWrites,
          maxWrites: rollout.maxWrites,
        },
      });
      metrics.incLiveBreaker(marketplaceId);
    }

    return nonAuthoritative(
      marketplaceId,
      externalListingId,
      outcome.reason,
      rollout?.mode ?? "LEGACY_ONLY",
      rollout?.id ?? null,
      outcome.usedWrites,
      outcome.maxWrites,
      rollout?.legacyFallbackEnabled ?? true,
    );
  }

  const rollout = outcome.rollout;
  const mode = rollout.mode;
  const ctx: LiveWriteContext = {
    marketplaceId,
    externalListingId,
    executionId: outcome.executionId,
    authoritative: true,
    mode,
    denyReason: null,
    rolloutId: rollout.id,
    legacyFallbackEnabled: rollout.legacyFallbackEnabled,
    usedWrites: outcome.usedWrites,
    maxWrites: outcome.maxWrites,
    settled: false,
    fallbackAttempted: false,
  };

  metrics.setGlobalBudget(
    marketplaceId,
    outcome.usedWrites,
    outcome.maxWrites,
  );
  metrics.incLiveAuthoritativeAttempt(marketplaceId);

  return ctx;
}

/* -------------------------------------------------------------------------- */
/* LIQUIDAÇÃO                                                                 */
/* -------------------------------------------------------------------------- */

function breakerReasonForObservation(
  observation: LivePostWriteObservation,
): CutoverBreakerReason {
  switch (observation.reason) {
    case "oferta-inexistente-apos-commit":
      return "DUPLICATE_UNEXPECTED";
    case "productId":
      return "IDENTITY_CORRUPTION";
    default:
      return "PARITY_DIFF_UNEXPECTED";
  }
}

/**
 * Fecha a contabilidade de UMA execução autoritativa: evento de resultado,
 * leitura de paridade e, se preciso, abertura do breaker global.
 *
 * Só faz I/O para escrita autoritativa: no caminho legado o gate não pode
 * custar uma consulta ao banco.
 */
export async function completeLiveCutoverWrite(
  ctx: LiveWriteContext,
  input: {
    ok: boolean;
    executor: CutoverSqlExecutor | null;
    commitPhase: LiveCommitPhase;
    failureCode?: V1FailureCode;
    observation?: LivePostWriteObservation | null;
    fallbackCommitted?: boolean;
    fallbackFailureCode?: V1FailureCode | null;
    fallbackCommitPhase?: LiveCommitPhase | null;
  },
): Promise<void> {
  if (!ctx.authoritative || ctx.settled) {
    return;
  }
  ctx.settled = true;

  const metrics = getCutoverMetrics();
  const { marketplaceId, executionId, rolloutId } = ctx;
  const executor = input.executor;
  const base = {
    rolloutId: rolloutId ?? "",
    marketplaceId,
    executionId,
    usedWrites: ctx.usedWrites,
    maxWrites: ctx.maxWrites,
    externalListingId: ctx.externalListingId,
  };

  const record = async (
    kind: Parameters<typeof recordGlobalEvent>[1]["kind"],
    reason: string | null,
    metadata: Record<string, unknown> | null,
  ): Promise<boolean> => {
    if (!executor || rolloutId === null) {
      return false;
    }
    return recordGlobalEvent(executor, { ...base, kind, reason, metadata });
  };

  const trip = async (
    reason: CutoverBreakerReason,
    metadata: Record<string, unknown> | null,
  ): Promise<void> => {
    if (executor && rolloutId !== null) {
      const opened = await tripGlobalBreaker(executor, {
        rolloutId,
        marketplaceId,
        reason,
        executionId,
        metadata,
      });
      if (opened) {
        metrics.incLiveBreaker(marketplaceId);
      }
    }
  };

  /* ---------------------------------------------------------------------- */
  /* SUCESSO                                                                */
  /* ---------------------------------------------------------------------- */
  if (input.ok) {
    const observation = input.observation ?? null;

    if (!observation) {
      await record("V1_COMMITTED", "COMMITTED", { commitPhase: "COMMITTED" });
    } else if (observation.verdict === "MATCH") {
      metrics.incLiveParityMatch(marketplaceId);
      await record("PARITY_MATCH", observation.reason, {
        commitPhase: "COMMITTED",
        offerId: observation.offerId,
      });
    } else if (observation.verdict === "EXPECTED_DIFFERENCE") {
      metrics.incLiveParityExpectedDifference(marketplaceId);
      await record("PARITY_DIFFERENCE", observation.reason, {
        commitPhase: "COMMITTED",
        expected: true,
        differences: observation.differences,
      });
    } else if (observation.verdict === "UNEXPECTED_DIFFERENCE") {
      metrics.incLiveParityUnexpectedDifference(marketplaceId);
      await record("PARITY_DIFFERENCE", observation.reason, {
        commitPhase: "COMMITTED",
        expected: false,
        differences: observation.differences,
      });
      await trip(breakerReasonForObservation(observation), {
        reason: observation.reason,
        differences: observation.differences,
      });
    } else {
      // UNREADABLE: registrado, mas NÃO abre o breaker (não é prova).
      await record("PARITY_DIFFERENCE", observation.reason, {
        commitPhase: "COMMITTED",
        expected: null,
        unreadable: true,
      });
    }

    metrics.incLiveAuthoritativeSuccess(marketplaceId);
    return;
  }

  /* ---------------------------------------------------------------------- */
  /* FALHA                                                                  */
  /* ---------------------------------------------------------------------- */
  const failureCode = input.failureCode ?? "UNEXPECTED_V1_FAILURE";
  const commitPhase = input.commitPhase;
  metrics.incLiveAuthoritativeFailure(marketplaceId);

  await record("V1_FAILED", failureCode, {
    commitPhase,
    fallbackCommitted: input.fallbackCommitted === true,
  });

  /*
   * Fronteira ambígua: a transação pode ter commitado sem sabermos. NUNCA há
   * fallback aqui (o fallback é decidido antes), e o breaker fecha porque
   * nenhuma leitura de follow-up pode provar o estado.
   */
  if (commitPhase === "COMMIT_UNKNOWN") {
    await record("AMBIGUOUS_COMMIT", failureCode, { commitPhase });
    await trip("V1_ERRORS_ABOVE_LIMIT", { commitPhase, failureCode });
    return;
  }

  /*
   * Rejeições de guarda (IDENTITY_REJECT, POLICY_NOT_READY,
   * MULTISTORE_NOT_READY, INVALID_DATA) NÃO são violação de segurança: são o
   * sistema recusando fazer o trabalho. Registrar sem abrir o breaker é o
   * comportamento correto — abrir o breaker aqui derrubaria o marketplace por
   * um item de catálogo legitimately inválido.
   */
  if (!allowsLegacyFallbackForCode(failureCode)) {
    return;
  }

  /* Fallback assumiu (ou tentou). */
  if (input.fallbackCommitted === true) {
    const observation = input.observation ?? null;
    if (observation && observation.verdict === "UNEXPECTED_DIFFERENCE") {
      metrics.incLiveParityUnexpectedDifference(marketplaceId);
      await trip(breakerReasonForObservation(observation), {
        reason: observation.reason,
        differences: observation.differences,
      });
    } else if (observation && observation.verdict === "MATCH") {
      metrics.incLiveParityMatch(marketplaceId);
    } else if (observation) {
      metrics.incLiveParityExpectedDifference(marketplaceId);
    }
    return;
  }

  if (ctx.fallbackAttempted) {
    await record(
      "FALLBACK_FAILED",
      input.fallbackFailureCode ?? "UNEXPECTED_V1_FAILURE",
      { fallbackCommitPhase: input.fallbackCommitPhase ?? null },
    );
  }

  /*
   * Erro V1 crítico repetido. A contagem é GLOBAL (consulta ao banco), não de
   * processo: em N instâncias cada uma contaria só a sua parte e o limite
   * nunca seria alcançado.
   */
  if (executor && rolloutId !== null) {
    const failures = await countRecentV1Failures(executor, rolloutId);
    if (failures >= SAFE_V1_ERROR_LIMIT) {
      await trip("V1_ERRORS_ABOVE_LIMIT", { recentFailures: failures });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* ORQUESTRADOR DE SINGLE-WRITE OWNERSHIP                                     */
/* -------------------------------------------------------------------------- */

/** Marca a fronteira de commit DENTRO da transação, imediatamente antes do retorno. */
export type MarkCommitBoundary = () => void;

export type RunLiveCutoverWriteInput<T> = {
  ctx: LiveWriteContext;
  executor: CutoverSqlExecutor | null;
  /** Escrita V1 primária. Recebe o marcador de fronteira de commit. */
  v1Write: (mark: MarkCommitBoundary) => Promise<T>;
  /** Fallback legado. É a MESMA transação canônica, retentada idempotente. */
  legacyWrite: (mark: MarkCommitBoundary) => Promise<T>;
  onSuccess: (result: T) => Promise<void>;
  onFailure: (failure: LiveWriteFailure) => Promise<void>;
};

/**
 * Orquestrador único das duas rotas.
 *
 * `v1Write` e `legacyWrite` são a MESMA transação canônica — é essa
 * paridade por construção que torna o V1 estruturalmente equivalente ao
 * legado. O que muda é a ROTA (que marcador é gravado) e a CONTABILIDADE.
 *
 * Regras de ownership (nunca negociáveis):
 *   - Não autoritativo (ou contexto já liquidado): exatamente UMA transação,
 *     zero contabilidade, zero breaker. Idêntico ao comportamento anterior.
 *   - V1 commitou => o legado NUNCA escreve.
 *   - Falha PRÉ-COMMIT (rollback confirmado) + código elegível + modo
 *     permite fallback + fallback habilitado => o legado assume (1 write).
 *   - Falha PÓS-COMMIT (fronteira marcada) => ambiguidade => ZERO fallback.
 *   - IDENTITY_REJECT / POLICY_NOT_READY / MULTISTORE_NOT_READY / INVALID_DATA
 *     => ZERO fallback, mesmo em V1_PRIMARY_WITH_LEGACY_FALLBACK.
 */
export async function runLiveCutoverWrite<T>(
  input: RunLiveCutoverWriteInput<T>,
): Promise<LiveWriteOutcome<T>> {
  const { ctx, v1Write, legacyWrite, onSuccess, onFailure } = input;
  const metrics = getCutoverMetrics();

  /*
   * Rota não autoritativa (ou bypass interno já liquidado): UMA transação
   * canônica, sem aquisição, sem marcador, sem breaker. O marcador nunca é
   * chamado porque não há o que liquidar.
   */
  if (!ctx.authoritative || ctx.settled) {
    const result = await v1Write(() => {});
    return { kind: "LEGACY_ONLY", result, failure: null };
  }

  if (!isV1AuthoritativeMode(ctx.mode)) {
    // Rollover de configuração entre a aquisição e a escrita: degrada seguro.
    const result = await v1Write(() => {});
    return { kind: "LEGACY_ONLY", result, failure: null };
  }

  /* ---------------------------------------------------------------------- */
  /* V1 PRIMÁRIO                                                            */
  /* ---------------------------------------------------------------------- */
  let v1Marked = false;
  const markV1: MarkCommitBoundary = () => {
    v1Marked = true;
  };

  try {
    const result = await v1Write(markV1);
    await onSuccess(result);
    return { kind: "V1_COMMITTED", result, failure: null };
  } catch (v1Error) {
    const failureCode = classifyV1Failure(v1Error);

    /*
     * Fronteira marcada => o commit pode ter ocorrido. Escrever de novo
     * (mesmo que idempotente) seria um SEGUNDO write do mesmo evento: é
     * exatamente o double-write que a single-write ownership proíbe.
     */
    const commitPhase: LiveCommitPhase = v1Marked
      ? "COMMIT_UNKNOWN"
      : "ROLLED_BACK";

    const canFallback =
      commitPhase === "ROLLED_BACK" &&
      allowsLegacyFallbackForCode(failureCode) &&
      allowsLegacyFallback(ctx.mode) &&
      ctx.legacyFallbackEnabled;

    if (!canFallback) {
      await onFailure({
        failureCode,
        commitPhase,
        fallbackCommitted: false,
        fallbackFailureCode: null,
        fallbackCommitPhase: null,
      });
      throw v1Error;
    }

    /* ------------------------------------------------------------------ */
    /* FALLBACK LEGADO — a única retentativa, e só aqui.                 */
    /* ------------------------------------------------------------------ */
    ctx.fallbackAttempted = true;
    metrics.incLiveLegacyFallback(ctx.marketplaceId);
    await recordGlobalEventSafely(input.executor, {
      rolloutId: ctx.rolloutId,
      marketplaceId: ctx.marketplaceId,
      executionId: ctx.executionId,
      kind: "FALLBACK_ATTEMPTED",
      reason: failureCode,
      usedWrites: ctx.usedWrites,
      maxWrites: ctx.maxWrites,
      externalListingId: ctx.externalListingId,
    });

    let fallbackMarked = false;
    try {
      const result = await legacyWrite(() => {
        fallbackMarked = true;
      });
      metrics.incLiveLegacyFallbackSuccess(ctx.marketplaceId);
      await onFailure({
        failureCode,
        commitPhase: "ROLLED_BACK",
        fallbackCommitted: true,
        fallbackFailureCode: null,
        fallbackCommitPhase: "COMMITTED",
      });
      return {
        kind: "LEGACY_FALLBACK_COMMITTED",
        result,
        failure: {
          failureCode,
          commitPhase: "ROLLED_BACK",
          fallbackCommitted: true,
          fallbackFailureCode: null,
          fallbackCommitPhase: "COMMITTED",
        },
      };
    } catch (fallbackError) {
      const fallbackFailureCode = classifyV1Failure(fallbackError);
      const fallbackCommitPhase: LiveCommitPhase = fallbackMarked
        ? "COMMIT_UNKNOWN"
        : "ROLLED_BACK";
      metrics.incLiveLegacyFallbackFailure(ctx.marketplaceId);

      const failure: LiveWriteFailure = {
        failureCode,
        commitPhase: "ROLLED_BACK",
        fallbackCommitted: false,
        fallbackFailureCode,
        fallbackCommitPhase,
      };
      await onFailure(failure);
      // O erro do fallback é o mais informativo: é a última coisa que falhou.
      throw fallbackError;
    }
  }
}

/** Grava evento best-effort: falha de bookkeeping NUNCA derruba a escrita. */
async function recordGlobalEventSafely(
  executor: CutoverSqlExecutor | null,
  event: Omit<Parameters<typeof recordGlobalEvent>[1], "rolloutId"> & {
    rolloutId: string | null;
  },
): Promise<void> {
  const { rolloutId } = event;
  if (!executor || rolloutId === null) {
    return;
  }
  try {
    await recordGlobalEvent(executor, { ...event, rolloutId });
  } catch (error) {
    console.error(
      "[LIVE_CUTOVER] gravacao de evento de fallback falhou (escrita preservada)",
      error,
    );
  }
}


