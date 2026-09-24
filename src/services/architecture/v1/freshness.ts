/**
 * CATALOG_ARCHITECTURE_V1 — FRESHNESS CONTRACT (FASE L).
 *
 * Estados conceituais oficiais de frescor de uma listing/oferta:
 *   FRESH   => dados atuais, candidatos a melhor oferta.
 *   AGING   => envelhecendo, mas ainda válidos dentro do limite de transição.
 *   STALE   => não atualizados há tempo; NÃO disputam melhor oferta.
 *   EXPIRED => além do TTL; tratados como indisponíveis.
 *
 * STALE/EXPIRED nunca disputam best offer como se fossem dados atuais.
 *
 * Os timestamps são derivados quando possível (sem exigir novas colunas):
 *   receivedAt      = quando o dado foi recebido pelo Ofertano
 *   sourceUpdatedAt = última atualização reportada pela fonte
 *   observedAt      = quando foi observado/coletado
 *   processedAt     = quando foi processado (hash/hands-off do pipeline)
 *   lastSeenAt      = última vez que a listing foi vista numa coleta
 *   expiresAt       = prazo de validade derivado (lastSeenAt + ttl)
 */

export type FreshnessStateV1 = "FRESH" | "AGING" | "STALE" | "EXPIRED";

export interface FreshnessTimestampsV1 {
  receivedAt?: string | null;
  sourceUpdatedAt?: string | null;
  observedAt?: string | null;
  processedAt?: string | null;
  lastSeenAt?: string | null;
  expiresAt?: string | null;
}

export interface FreshnessContractV1 {
  /** Limite (ms) a partir do qual FRESH vira AGING. Default 12h. */
  agingAfterMs?: number;
  /** Limite (ms) a partir do qual AGING vira STALE. Default 48h. */
  staleAfterMs?: number;
  /** TTL total (ms) a partir do qual STALE vira EXPIRED. Default 7d. */
  ttlMs?: number;
}

export const DEFAULT_FRESHNESS_CONTRACT: Required<FreshnessContractV1> = {
  agingAfterMs: 12 * 60 * 60 * 1000, // 12h
  staleAfterMs: 48 * 60 * 60 * 1000, // 48h
  ttlMs: 7 * 24 * 60 * 60 * 1000, // 7d
};

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/**
 * Deriva o frescor a partir dos timestamps disponíveis.
 * Ordem de preferência da "idade de referência":
 *   sourceUpdatedAt > observedAt > processedAt > receivedAt > lastSeenAt
 * (a mais recente evidência de que o dado ainda reflete a fonte).
 */
export function classifyFreshness(
  timestamps: FreshnessTimestampsV1,
  contract: FreshnessContractV1 = DEFAULT_FRESHNESS_CONTRACT,
  nowIso = new Date().toISOString(),
): FreshnessStateV1 {
  const now = toMs(nowIso) ?? Date.now();
  const markers = [
    timestamps.sourceUpdatedAt,
    timestamps.observedAt,
    timestamps.processedAt,
    timestamps.receivedAt,
    timestamps.lastSeenAt,
  ];
  const referenceMs = markers
    .map(toMs)
    .filter((t): t is number => t !== null)
    .sort((a, b) => b - a)[0];

  if (referenceMs === undefined || referenceMs === null) {
    // Sem nenhuma evidência de tempo: fail-closed = EXPIRED (não disputa oferta).
    return "EXPIRED";
  }

  const age = now - referenceMs;
  if (age < 0) return "FRESH"; // relógio da fonte no futuro: trata como atual.
  if (age > contract.ttlMs) return "EXPIRED";
  if (age > contract.staleAfterMs) return "STALE";
  if (age > contract.agingAfterMs) return "AGING";
  return "FRESH";
}

/** Derivada de expiresAt para uma listing: lastSeenAt + ttl. */
export function deriveExpiresAt(
  lastSeenIso: string,
  ttlMs = DEFAULT_FRESHNESS_CONTRACT.ttlMs,
): string {
  const t = Date.parse(lastSeenIso);
  return Number.isNaN(t) ? lastSeenIso : new Date(t + ttlMs).toISOString();
}

/**
 * Regra oficial: STALE/EXPIRED não disputam best offer.
 * Retorna true quando o frescor ainda permite competir por melhor oferta.
 */
export function canCompeteForBestOffer(state: FreshnessStateV1): boolean {
  return state === "FRESH" || state === "AGING";
}

/** Quão íntegro está o dado para uso em ofertas públicas. */
export function freshnessRank(state: FreshnessStateV1): number {
  switch (state) {
    case "FRESH":
      return 4;
    case "AGING":
      return 3;
    case "STALE":
      return 2;
    case "EXPIRED":
      return 0;
  }
}