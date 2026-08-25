import type {
  DiscoveryCandidate,
  DiscoveryMarketplace,
  MarketplaceDiscoveryResult,
  MarketplaceSearchOutcome,
} from "./core/types";

export type AcquisitionStatus =
  | "SUCCESS"
  | "EMPTY"
  | "BLOCKED"
  | "TIMEOUT"
  | "UNUSABLE"
  | "ERROR";

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function classificarMensagemAquisicao(
  error: string | null | undefined,
  httpStatus?: number | null,
): AcquisitionStatus {
  const status = httpStatus ?? 0;

  if (status === 401 || status === 403 || status === 429) {
    return "BLOCKED";
  }

  const text = fold(error ?? "");

  if (
    /timeout|timed out|ultrapassou|abortado|aborted|orcamento de busca esgotado/.test(
      text,
    )
  ) {
    return "TIMEOUT";
  }

  if (
    /captcha|challenge|access[_\s-]?denied|403|401|forbidden|unauthorized|blocked|bloquead|bloqueou|robot|unusual traffic|too many requests|429|rate limit|digite os caracteres|opfcaptcha/.test(
      text,
    )
  ) {
    return "BLOCKED";
  }

  if (
    /nao[^\n]{0,40}configurad|unusable|sem estrutura|nao interpretavel|sem mecanismo de busca/.test(
      text,
    )
  ) {
    return "UNUSABLE";
  }

  return "ERROR";
}

export function searchOutcomeFromAcquisition(
  status: AcquisitionStatus,
  candidateCount: number,
): MarketplaceSearchOutcome {
  if (candidateCount > 0) {
    return "SEARCH_COMPLETED";
  }

  if (status === "SUCCESS" || status === "EMPTY") {
    return "EMPTY_VALID";
  }

  if (status === "BLOCKED") {
    return "BLOCKED";
  }

  if (status === "UNUSABLE") {
    return "UNUSABLE";
  }

  return "ERROR";
}

export function montarDiscoveryResult(input: {
  marketplace: DiscoveryMarketplace;
  query: string;
  candidates: DiscoveryCandidate[];
  scanned: number;
  status: AcquisitionStatus;
  error?: string | null;
  sourcesTried?: string[];
  blockedSources?: string[];
  unusableSources?: string[];
  degraded?: boolean;
}): MarketplaceDiscoveryResult {
  const candidateCount = input.candidates.length;
  const status =
    candidateCount > 0 &&
    (input.status === "EMPTY" || input.status === "SUCCESS")
      ? "SUCCESS"
      : input.status;
  const emptyOrSuccess = status === "SUCCESS" || status === "EMPTY";

  return {
    marketplace: input.marketplace,
    query: input.query,
    success: emptyOrSuccess || candidateCount > 0,
    candidates: input.candidates,
    scanned: input.scanned,
    error: emptyOrSuccess ? null : input.error ?? null,
    degraded: input.degraded,
    blockedSources: input.blockedSources,
    unusableSources: input.unusableSources,
    sourcesTried: input.sourcesTried,
    searchOutcome: searchOutcomeFromAcquisition(status, candidateCount),
  };
}
