/**
 * AI IDENTITY RESOLVER — SOMENTE SHADOW (§10 / §11 / §12 / §13).
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ ESTE MÓDULO NÃO PUBLICA NADA.                                      │
 * │ `GLOBAL_CUTOVER` permanece `NO`. Nenhum veredito daqui vira match    │
 * │ publicado, muda preço de oferta ou escreve em banco. Ele existe      │
 * │ para MEDIR o que uma segunda opinião acrescentaria — e para isso     │
 * │ roda estritamente em shadow.                                         │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * TRÊS REGRAS QUE NÃO SÃO OPCIONAIS
 *
 * 1. O DETERMINÍSTICO É O DONO DA DECISÃO. A IA só é consultada onde o
 *    motor já pediu ajuda (§10): veredito `REVIEW`, ausência de match
 *    exato com candidato forte, ou par rotulado `AMBIGUOUS`. Ela NUNCA é
 *    chamada para "melhorar" um `REJECT` que já tem conflito duro — afrouxar
 *    isso seria trocar fail-closed por fail-open por comMODIDADE.
 *
 * 2. CONTRATO ESTREITO, PARSE FAIL-CLOSED (§11). A resposta precisa ter
 *    `verdict` em {SAME, DIFFERENT, UNCERTAIN}, `confidence` em [0,1],
 *    `matchingEvidence[]`, `conflicts[]` e `normalizedIdentity`. Qualquer
 *    coisa fora do contrato — texto solto, campo faltando, confidence como
 *    string, verdict inventado — vira `UNCERTAIN`. Nunca vira `SAME`.
 *
 * 3. O VETO DO MOTOR NÃO É ANULÁVEL. Se existe conflito estrutural duro,
 *    a IA é nem consultada: o resultado é `SHADOW_ONLY_SKIPPED_HARD`.
 *    Sem isso, um modelo barulhento destróiz a garantia de preço.
 *
 * CACHE (§12): a chave é `sha256(seedFingerprint | candidateFingerprint |
 * policyVersion)`. Trocar a política invalida tudo — é o que impede um
 * veredito antigo sobreviver a uma mudança de regra.
 */

import { createHash } from "node:crypto";

import { IDENTITY_POLICY_V1 } from "./identityPolicy";
import type { IdentityDecisionV1 } from "./identityConfidence";

/* ------------------------------------------------------------------ TIPOS */

/** Veredito permitido. `SAME` é o único que muda alguma coisa — e só em shadow. */
export type AiVerdict = "SAME" | "DIFFERENT" | "UNCERTAIN";

export interface AiVereditoNormalizado {
  brand: string | null;
  model: string | null;
  gtin: string[];
  variant: Record<string, string>;
}

export interface AiVeredito {
  verdict: AiVerdict;
  confidence: number;
  matchingEvidence: string[];
  conflicts: string[];
  normalizedIdentity: AiVereditoNormalizado;
}

/** Resultado do resolver, com o motivo de tudo que ele fez. */
export interface AiShadowResult {
  /** O que a IA disse (ou `null` se não foi consultada). */
  aiVerdict: AiVerdict | null;
  aiConfidence: number | null;
  /** Verdadeiro quando `aiVerdict === "SAME"`. NUNCA publica. */
  wouldPromoteToSame: boolean;
  /** Por que a IA foi ou não foi consultada. */
  gate: AiShadowGate;
  /** Verdadeiro quando a resposta veio do cache. */
  fromCache: boolean;
  /** Contrato estrito violado na resposta bruta. Vazio = ok. */
  contractViolations: string[];
  cacheKey: string;
  policyVersion: string;
}

export type AiShadowGate =
  | "SHADOW_ONLY_SKIPPED_HARD_CONFLICT"
  | "SHADOW_ONLY_SKIPPED_NOT_ELIGIBLE"
  | "SHADOW_CONSULTED_REVIEW"
  | "SHADOW_CONSULTED_NO_EXACT_STRONG_CANDIDATE"
  | "SHADOW_CONSULTED_AMBIGUOUS";

/* --------------------------------------------------------------- PROVIDER */

/**
 * Contrato do provedor. Só existe `complete`; nada de structured output
 * garantido pelo SDK — a validação acontece depois, no parse, e é ela que
 * decide. Foi assim que o `xm-resolver-ai.ts` anterior conseguiu devolver
 * `null` silenciosamente quando a resposta vinha com uma chave a mais.
 */
export interface AiIdentityProvider {
  readonly nome: string;
  complete(prompt: string): Promise<string>;
}

/**
 * Provider de REPLAY: devolve respostas pré-gravadas, sem rede, sem chave.
 * É o que permite testar contrato, gate e cache de forma determinística.
 */
export class ReplayAiProvider implements AiIdentityProvider {
  readonly nome = "REPLAY";

  constructor(private readonly respostas: Record<string, string>) {}

  async complete(prompt: string): Promise<string> {
    const chave = sha256(prompt).slice(0, 16);
    const resposta = this.respostas[chave] ?? this.respostas["*"] ?? "{}";
    return resposta;
  }
}

/* ------------------------------------------------------- VALIDAÇÃO FALSA */

/**
 * Parseia e VALIDA o veredito. Fail-closed: qualquer violação do contrato
 * devolve `UNCERTAIN` com a lista de violações — nunca `SAME`.
 *
 * Motivo de ser uma funcao separada do provider: é o unico ponto onde uma
 * resposta de modelo entra no sistema, e portanto o unico ponto onde ela
 * pode ser Recusada.
 */
export function validarVereditoAi(bruto: string): {
  veredito: AiVeredito | null;
  violacoes: string[];
} {
  const violacoes: string[] = [];

  let dados: unknown;
  try {
    dados = JSON.parse(bruto);
  } catch {
    return { veredito: null, violacoes: ["RESPOSTA_NAO_E_JSON"] };
  }

  if (typeof dados !== "object" || dados === null || Array.isArray(dados)) {
    return { veredito: null, violacoes: ["RESPOSTA_NAO_E_OBJETO"] };
  }

  const obj = dados as Record<string, unknown>;

  const verdict = obj.verdict;
  if (verdict !== "SAME" && verdict !== "DIFFERENT" && verdict !== "UNCERTAIN") {
    violacoes.push("VERDICT_INVALIDO");
  }

  const rawConfidence = obj.confidence;
  if (typeof rawConfidence !== "number" || !Number.isFinite(rawConfidence)) {
    violacoes.push("CONFIDENCE_NAO_E_NUMERO");
  } else if (rawConfidence < 0 || rawConfidence > 1) {
    violacoes.push("CONFIDENCE_FORA_DE_0_1");
  }

  const listaDeTextos = (chave: string): string[] | null => {
    const valor = obj[chave];
    if (!Array.isArray(valor)) {
      violacoes.push(`${chave.toUpperCase()}_NAO_E_LISTA`);
      return null;
    }
    if (valor.some((item) => typeof item !== "string")) {
      violacoes.push(`${chave.toUpperCase()}_CONTEM_ITEM_NAO_TEXTO`);
      return null;
    }
    return valor as string[];
  };

  const matchingEvidence = listaDeTextos("matchingEvidence");
  const conflicts = listaDeTextos("conflicts");

  const identidade = obj.normalizedIdentity;
  if (typeof identidade !== "object" || identidade === null || Array.isArray(identidade)) {
    violacoes.push("NORMALIZEDIDENTITY_AUSENTE");
  } else {
    const id = identidade as Record<string, unknown>;
    if (typeof id.brand !== "string" && id.brand !== null) violacoes.push("IDENTITY_BRAND_INVALIDO");
    if (typeof id.model !== "string" && id.model !== null) violacoes.push("IDENTITY_MODEL_INVALIDO");
    if (!Array.isArray(id.gtin) || id.gtin.some((g) => typeof g !== "string")) {
      violacoes.push("IDENTITY_GTIN_INVALIDO");
    }
    if (
      typeof id.variant !== "object" ||
      id.variant === null ||
      Array.isArray(id.variant) ||
      Object.values(id.variant as Record<string, unknown>).some((v) => typeof v !== "string")
    ) {
      violacoes.push("IDENTITY_VARIANT_INVALIDO");
    }
  }

  // Falha em qualquer item -> UNCERTAIN. Uma unica violacao ja descarta.
  if (violacoes.length > 0) {
    return { veredito: null, violacoes };
  }

  const id = obj.normalizedIdentity as Record<string, unknown>;
  return {
    veredito: {
      verdict: verdict as AiVerdict,
      confidence: rawConfidence as number,
      matchingEvidence: matchingEvidence as string[],
      conflicts: conflicts as string[],
      normalizedIdentity: {
        brand: id.brand as string | null,
        model: id.model as string | null,
        gtin: id.gtin as string[],
        variant: id.variant as Record<string, string>,
      },
    },
    violacoes: [],
  };
}

/* ----------------------------------------------------------------- CACHE */

export interface AiCacheV1 {
  get(chave: string): string | undefined;
  set(chave: string, respostaBruta: string): void;
  tamanho(): number;
}

/** Cache em memoria. Enough para shadow; trocavel por Redis sem mudar a assinatura. */
export class AiMemoryCache implements AiCacheV1 {
  private readonly mapa = new Map<string, string>();

  get(chave: string): string | undefined {
    return this.mapa.get(chave);
  }

  set(chave: string, respostaBruta: string): void {
    this.mapa.set(chave, respostaBruta);
  }

  tamanho(): number {
    return this.mapa.size;
  }
}

/* ------------------------------------------------------------- FINGERPRINT */

export function sha256(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex");
}

/**
 * Impressao digital estavel de uma listing. Usa marketplace + externalId +
 * titulo + identidade, para que uma mudanca de titulo na fonte invalide o
 * cache em vez de servir um veredito velho.
 */
export function fingerprintListing(listing: {
  marketplaceId: string;
  externalListingId: string;
  catalog?: { title: string | null } | null;
  identity?: { brand?: string | null; model?: string | null; gtin?: string[] | null };
}): string {
  return sha256(
    [
      listing.marketplaceId,
      listing.externalListingId,
      listing.catalog?.title ?? "",
      listing.identity?.brand ?? "",
      listing.identity?.model ?? "",
      (listing.identity?.gtin ?? []).join(","),
    ].join("|"),
  );
}

export function aiCacheKey(seedPrint: string, candidatePrint: string, policyVersion: string): string {
  return sha256(`${seedPrint}|${candidatePrint}|${policyVersion}`);
}

/* ---------------------------------------------------------------- GATING */

export type AiEligibility =
  | { elegivel: true; gate: Exclude<AiShadowGate, "SHADOW_ONLY_SKIPPED_NOT_ELIGIBLE"> }
  | { elegivel: false; gate: AiShadowGate };

/**
 * Decide se a IA deve ser consultada. Este gate e a fronteira entre
 * "motor pediu ajuda" e "motor ja resolveu" — e ele NAO consulta a IA para
 * degradao: um REJECT com conflito estrutural e resposta definitiva.
 */
export function avaliarElegibilidadeAi(
  decisao: IdentityDecisionV1,
  opcoes: { rotuloAmbiguo?: boolean; candidatoForte?: boolean } = {},
): AiEligibility {
  // Regra 3: conflito estrutural duro e resposta definitiva do motor.
  if (decisao.hardConflicts.length > 0) {
    return { elegivel: false, gate: "SHADOW_ONLY_SKIPPED_HARD_CONFLICT" };
  }
  if (opcoes.rotuloAmbiguo) {
    return { elegivel: true, gate: "SHADOW_CONSULTED_AMBIGUOUS" };
  }
  if (decisao.confidence === "REVIEW") {
    return { elegivel: true, gate: "SHADOW_CONSULTED_REVIEW" };
  }
  if (decisao.confidence === "REJECT" && opcoes.candidatoForte) {
    return { elegivel: true, gate: "SHADOW_CONSULTED_NO_EXACT_STRONG_CANDIDATE" };
  }
  return { elegivel: false, gate: "SHADOW_ONLY_SKIPPED_NOT_ELIGIBLE" };
}

/* -------------------------------------------------------------- RESOLVER */

export interface AiShadowResolverDeps {
  provider: AiIdentityProvider;
  cache: AiCacheV1;
  policyVersion?: string;
}

export interface ConsultarAiShadowArgs {
  seed: Parameters<typeof fingerprintListing>[0];
  candidate: Parameters<typeof fingerprintListing>[0];
  decisaoDeterministica: IdentityDecisionV1;
  rotuloAmbiguo?: boolean;
  candidatoForte?: boolean;
  montarPrompt: (seedPrint: string, candidatePrint: string) => string;
}

/**
 * Executa uma consulta de shadow. Devolve sempre um resultado explicavel, mesmo
 * quando a IA nao e consultada — porque "nao consultada" tambem e uma metrica.
 */
export async function consultarAiShadow(
  args: ConsultarAiShadowArgs,
  deps: AiShadowResolverDeps,
): Promise<AiShadowResult> {
  const policyVersion = deps.policyVersion ?? IDENTITY_POLICY_V1;
  const seedPrint = fingerprintListing(args.seed);
  const candidatePrint = fingerprintListing(args.candidate);
  const chave = aiCacheKey(seedPrint, candidatePrint, policyVersion);

  const elegibilidade = avaliarElegibilidadeAi(args.decisaoDeterministica, {
    rotuloAmbiguo: args.rotuloAmbiguo,
    candidatoForte: args.candidatoForte,
  });

  const base: AiShadowResult = {
    aiVerdict: null,
    aiConfidence: null,
    wouldPromoteToSame: false,
    gate: elegibilidade.gate,
    fromCache: false,
    contractViolations: [],
    cacheKey: chave,
    policyVersion,
  };

  if (!elegibilidade.elegivel) return base;

  let bruto = deps.cache.get(chave);
  const fromCache = bruto !== undefined;
  if (bruto === undefined) {
    bruto = await deps.provider.complete(args.montarPrompt(seedPrint, candidatePrint));
    deps.cache.set(chave, bruto);
  }

  const { veredito, violacoes } = validarVereditoAi(bruto);

  if (!veredito) {
    // Falha de contrato: UNCERTAIN e nada de promoção.
    return { ...base, fromCache, contractViolations: violacoes };
  }

  return {
    ...base,
    fromCache,
    contractViolations: violacoes,
    aiVerdict: veredito.verdict,
    aiConfidence: veredito.confidence,
    // `wouldPromoteToSame` é SEMPRE shadow. Nada aqui publica.
    wouldPromoteToSame: veredito.verdict === "SAME",
  };
}