import {
  pontuarCoberturaLexicalPonderada,
  tokensDistintivosDaConsulta,
} from "@/services/identity";
import { traceMultiloja } from "@/services/multiloja/trace";

const MAX_FILTER_LOGS = 10;

export type MarketplaceFilterStatus = "KEPT" | "DROPPED";

export type MarketplaceFilterEvent = {
  title: string;
  externalId: string;
  stage: string;
  status: MarketplaceFilterStatus;
  reason: string;
  lexicalScore?: number;
};

function tituloContemTermoDistintivo(
  query: string,
  title: string,
): boolean {
  const distinctive = tokensDistintivosDaConsulta(query);

  if (distinctive.length === 0) {
    return false;
  }

  return pontuarCoberturaLexicalPonderada(query, title)
    .missingDistinctive.length < distinctive.length;
}

export function deveRastrearFiltroMarketplace(
  query: string,
  event: MarketplaceFilterEvent,
): boolean {
  if (event.status === "KEPT") {
    return true;
  }

  if (tituloContemTermoDistintivo(query, event.title)) {
    return true;
  }

  const lexical =
    event.lexicalScore ??
    pontuarCoberturaLexicalPonderada(query, event.title).score;

  return lexical >= 0.45;
}

export function rastrearFonteMercadoLivre(input: {
  source: string;
  query: string;
  status: string;
  httpStatus?: number | null;
  rawCount: number;
  usableCount: number;
  reason?: string;
}): void {
  traceMultiloja("ml-source", {
    source: input.source,
    query: input.query,
    status: input.status,
    httpStatus: input.httpStatus ?? "",
    rawCount: input.rawCount,
    usableCount: input.usableCount,
    reason: input.reason,
  });
}

export function rastrearResumoMercadoLivre(input: {
  query: string;
  sourcesTried: string[];
  blockedSources: string[];
  rawTotal: number;
  normalized: number;
  accepted: number;
}): void {
  traceMultiloja("ml-discovery-summary", {
    query: input.query,
    sourcesTried: input.sourcesTried,
    blockedSources: input.blockedSources,
    rawTotal: input.rawTotal,
    normalized: input.normalized,
    accepted: input.accepted,
  });
}

export function rastrearFiltrosMarketplace(input: {
  marketplace: string;
  query: string;
  events: MarketplaceFilterEvent[];
}): void {
  const ranked = [...input.events].sort((first, second) => {
    const firstScore =
      first.lexicalScore ??
      pontuarCoberturaLexicalPonderada(input.query, first.title).score;
    const secondScore =
      second.lexicalScore ??
      pontuarCoberturaLexicalPonderada(input.query, second.title).score;

    return secondScore - firstScore;
  });

  const selected: MarketplaceFilterEvent[] = [];
  const seen = new Set<string>();

  for (const event of ranked) {
    if (selected.length >= MAX_FILTER_LOGS) {
      break;
    }

    if (!deveRastrearFiltroMarketplace(input.query, event)) {
      continue;
    }

    const key = `${event.externalId}:${event.stage}:${event.status}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    selected.push(event);
  }

  for (const event of input.events) {
    if (selected.length >= MAX_FILTER_LOGS) {
      break;
    }

    if (event.status !== "KEPT") {
      continue;
    }

    const key = `${event.externalId}:${event.stage}:${event.status}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    selected.push(event);
  }

  for (const event of selected) {
    traceMultiloja("marketplace-filter", {
      marketplace: input.marketplace,
      title: event.title,
      externalId: event.externalId,
      stage: event.stage,
      status: event.status,
      reason: event.reason,
    });
  }
}
