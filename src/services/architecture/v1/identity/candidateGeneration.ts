/**
 * CATALOG_ARCHITECTURE_V1 — CANDIDATE GENERATION V1 (FASE 8.3).
 *
 * REGRA FUNDAMENTAL DESTA MISSÃO:
 *   Candidate Generation NÃO É Matching.
 *
 *   Este módulo responde: "estes N produtos TALVEZ sejam o mesmo produto".
 *   Quem responde "é EXACT / REVIEW / REJECT" continua sendo
 *   IDENTITY_POLICY_V1 (identityConfidence.ts).
 *
 *   Um candidato NUNCA publica, NUNCA une produtos e NUNCA decide.
 *   Este arquivo não importa nada de publicação e não escreve no banco.
 *
 * POR QUE ESTE MÓDULO EXISTE:
 *   A Shopee Affiliate API não expõe GTIN/MPN. O candidate generation
 *   anterior exigia brand+model ESTRUTURADOS, então 25 listings reais
 *   produziam ZERO pares — não por bug, por ausência de chave.
 *
 * CAMADAS (FASE C):
 *   1. Identificadores fortes  — GTIN/EAN/UPC/MPN/manufacturerModel.
 *   2. Brand + model signature — brand, category e modelo canônico.
 *   3. Evidência do título      — marca/modelo extraídos do TÍTULO, sempre
 *                                 marcadas TITLE_EXTRACTED.
 *
 * A CAMADA 3 PODE gerar CANDIDATO. Ela NUNCA, sozinha, gera EXACT: a política
 * de identidade não lê provenance de blocking key, e sim as evidências
 * estruturadas e os eixos. É por isso que afrouxar a geração de candidatos
 * NÃO afrouxa a decisão.
 *
 * ESCALA (FASE F): a extração de chave é uma função PURA
 * (`buildBlockingKeys`). Ela serve tanto o índice em memória quanto uma
 * tabela indexada. NUNCA há comparação "para cada listing, compare com
 * todo o catálogo": oCandidatesGenerator só faz lookup por chave exata.
 */

import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import { UNKNOWN } from "../types/normalizedListingV1";
import { capacityToGb } from "../matching/crossMarketMatching";
import { readAxis } from "./identityConfidence";

/* ================================================================== */
/* FASE E — BLOCKING KEYS VERSIONADAS                                  */
/* ================================================================== */

export const CANDIDATE_BLOCKING_KEY_V1 = "CANDIDATE_BLOCKING_KEY_V1" as const;
export type CandidateBlockingKeyVersion = typeof CANDIDATE_BLOCKING_KEY_V1;

export type BlockingKeyType =
  | "GTIN"
  | "EAN"
  | "UPC"
  | "MPN"
  | "MANUFACTURER_MODEL"
  | "BRAND_CATEGORY_MODEL"
  | "BRAND_MODEL_SIGNATURE"
  | "MODEL_CODE";

/** De onde veio o valor da chave. Auditoria, não heurística. */
export type KeyProvenance =
  | "STRUCTURED_FIELD"
  | "TITLE_EXTRACTED"
  | "CANONICAL_DERIVED";

/**
 * Força da chave. STRONG = identificador de fabricante.
 * MEDIUM = assinatura brand+category+model (pode gerar candidato, não EXACT).
 */
export type BlockingKeyStrength = "STRONG" | "MEDIUM";

export interface CandidateBlockingKeyV1 {
  version: CandidateBlockingKeyVersion;
  type: BlockingKeyType;
  /** Valor canônico, estável e indexável (minúsculo, sem separadores). */
  normalizedValue: string;
  strength: BlockingKeyStrength;
  provenance: KeyProvenance;
  /** Categoria canônica que participou da chave ("" quando não aplicável). */
  category: string;
}

/* ================================================================== */
/* FASE D — TOKENS GENÉRICOS NUNCA SÃO CHAVE SOZINHOS                  */
/* ================================================================== */

/**
 * Tokens proibidos como blocking key isolada (FASE D).
 *
 * "samsung + ultra" não diz nada. "samsung + galaxy + s25 + ultra" diz.
 * Estes tokens ainda podem APARECER dentro de uma assinatura multi-token —
 * o que é seguro, porque a chave carrega o contexto inteiro.
 */
export const GENERIC_TOKENS: ReadonlySet<string> = new Set([
  // qualifier genéricos
  "pro", "max", "plus", "ultra", "mini", "mega", "super", "hyper", "prime",
  "premium", "luxo", "gold", "silver", "platinum", "edition", "edicao",
  // condição / marketing
  "novo", "nova", "original", "importado", "importadora", "lancamento",
  "promocao", "oferta", "barato", "qualidade", "alta", "melhor", "top",
  // genéricos de e-commerce
  "smart", "inteligente", "digital", "wireless", "sem", "fio", "com",
  "para", "com", "tipo", "modelo", "tipo", "unidade", "kit", "pack",
  "conjunto", "preco", "valor", "envio", "frete", "entrega", "parcelado",
  "compat", "compativel", "universal", "multifuncao", "multiuso",
  // medidas/capacidades que SÃO eixo, não modelo
  "gb", "tb", "mb", "gb", "ram", "ssd", "hd",
]);

/** Palavras de categoria/ruído que nunca devem compor a assinatura de modelo. */
const TITLE_NOISE: ReadonlySet<string> = new Set([
  "fone", "de", "ouvido", "ouvido", "earphone", "headset", "auricular",
  "carregador", "carrega", "fonte", "adaptador", "cabo", "usb", "tipo",
  "turbo", "rapido", "rapida", "carga", "potencia", "watt", "w",
  "preto", "branco", "prata", "gold", "rosa", "azul", "vermelho", "verde",
  "original", "novo", "nova", "com", "sem", "fio", "para", "aparelhos",
  "aparelho", "celular", "android", "ios",
  /*
   * "iphone"/"galaxy"/"redmi" NÃO são ruído: em acessório, a marca-alvo é
   * justamente o modelo ("carregador iphone 20w", "película redmi band").
   * Removê-los deixava o título sem nada útil e a chave sumia.
   */
  "in", "a", "o", "e", "de", "da", "do", "das", "dos", "ao", "aos",
  "the", "and", "com", "mais", "ou", "na", "no", "em", "por", "p/", "c/",
]);

/* ================================================================== */
/* NORMALIZAÇÃO (FASE I)                                               */
/* ================================================================== */

/**
 * Canônico de modelo: minúsculas + apenas alfanuméricos.
 *
 * É o que faz "REDMIBUDS6PLAY" (campo estruturado) colidir com
 * "Redmi Buds 6 Play" (título). Sem isso, o mesmo produto nunca casaria.
 */
export function canonicalModel(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Título normalizado para análise (preserva espaços entre palavras). */
function normalizeTitleText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Stopword genérica (não confundida com GENERIC_TOKENS de bloqueio). */
function isNoiseToken(token: string): boolean {
  return (
    TITLE_NOISE.has(token) ||
    GENERIC_TOKENS.has(token) ||
    token.length <= 1 ||
    /^\d+$/.test(token)
  );
}

/* ================================================================== */
/* CATEGORIA (FASE J — category-aware)                                */
/* ================================================================== */

/**
 * Sinais de categoria. A lista é EXTENSÍVEL de propósito: nova categoria =
 * nova entrada aqui, sem tocar no motor.
 */
const CATEGORY_SIGNALS: ReadonlyArray<{ slug: string; signals: string[] }> = [
  { slug: "smartphone", signals: ["smartphone", "celular", "galaxy", "iphone", "redmi", "moto"] },
  { slug: "notebook", signals: ["notebook", "laptop", "macbook"] },
  { slug: "tv", signals: ["smart tv", "televisao", "oled", "qled"] },
  { slug: "eletrodomestico", signals: ["geladeira", "forno", "lavadora", "ventilador", "micro-ondas"] },
  { slug: "audio", signals: ["fone", "headset", "earphone", "airpods", "fone de ouvido"] },
  { slug: "monitor", signals: ["monitor"] },
  { slug: "teclado", signals: ["teclado"] },
  { slug: "mouse", signals: ["mouse"] },
  { slug: "carregador", signals: ["carregador", "adaptador", "fonte", "charger"] },
  { slug: "cabo", signals: ["cabo"] },
  { slug: "acessorio", signals: ["capa", "case", "pelicula", "pulseira", "protetor"] },
  { slug: "impressora", signals: ["impressora"] },
  { slug: "panela", signals: ["panela", "cooktop"] },
  { slug: "cadeira", signals: ["cadeira"] },
];

/** Categoria canônica derivada do título (primeiro sinal que casar). */
export function canonicalCategory(listing: NormalizedMarketplaceListingV1): string {
  const haystack = normalizeTitleText(
    `${listing.catalog.title ?? ""} ${listing.catalog.category ?? ""}`,
  );
  for (const { slug, signals } of CATEGORY_SIGNALS) {
    for (const signal of signals) {
      const normalized = normalizeTitleText(signal);
      if (normalized && haystack.includes(normalized)) return slug;
    }
  }
  return "default";
}

/* ================================================================== */
/* FASE C3 — EXTRAÇÃO DE MARCA E MODELO A PARTIR DO TÍTULO             */
/* ================================================================== */

/**
 * Marca da listing: estruturada quando a fonte fornece; senão, extraída do
 * TÍTULO usando um léxico derivado do PRÓPRIO CATÁLOGO (não inventado).
 */
export function extractBrand(
  listing: NormalizedMarketplaceListingV1,
  brandLexicon: ReadonlySet<string>,
): { brand: string; provenance: KeyProvenance } {
  const structured = listing.identity.brand;
  if (typeof structured === "string" && structured.trim() && structured !== UNKNOWN) {
    return { brand: canonicalModel(structured), provenance: "STRUCTURED_FIELD" };
  }
  const title = normalizeTitleText(listing.catalog.title);
  if (!title) return { brand: "", provenance: "TITLE_EXTRACTED" };
  /*
   * Marca pode ter MAIS DE UMA PALAVRA ("fast plug", "electrick teck").
   * Casar token a token falhava: o token "fast" nunca iguala "fastplug".
   * Por isso comparamos o título INTEIRO canonicalizado contra a marca.
   */
  const canonicalTitle = canonicalModel(title);
  for (const brand of brandLexicon) {
    if (brand.length < 3) continue;
    if (canonicalTitle.includes(brand)) {
      return { brand, provenance: "TITLE_EXTRACTED" };
    }
  }
  return { brand: "", provenance: "TITLE_EXTRACTED" };
}

/**
 * Candidatos de modelo canônico.
 *
 * Ordenados por confiança:
 *  1. manufacturerModel/MPN/model estruturados (STRUCTURED_FIELD);
 *  2. frase de modelo do título, com marca e ruído removidos
 *     (TITLE_EXTRACTED);
 *  3. de volta canônica do model estruturado (CANONICAL_DERIVED).
 */
export function extractModelCandidates(
  listing: NormalizedMarketplaceListingV1,
  brand: string,
): Array<{ model: string; provenance: KeyProvenance }> {
  const out: Array<{ model: string; provenance: KeyProvenance }> = [];
  const seen = new Set<string>();
  const push = (model: string, provenance: KeyProvenance) => {
    const c = canonicalModel(model);
    if (c.length < 2 || seen.has(c)) return;
    // Não deixa a "modelo" ser só um token genérico isolado.
    if (GENERIC_TOKENS.has(c)) return;
    seen.add(c);
    out.push({ model: c, provenance });
  };

  // CAMADA 1 — campos estruturados.
  for (const raw of [
    listing.identity.manufacturerModel,
    listing.identity.mpn,
    listing.identity.model,
  ]) {
    if (typeof raw === "string" && raw.trim() && raw !== UNKNOWN) {
      push(raw, "STRUCTURED_FIELD");
    }
  }

  // CAMADA 2 — frase de modelo do título, removendo marca e ruído.
  const title = normalizeTitleText(listing.catalog.title);
  if (title) {
    const brandToken = brand;
    const kept = title
      .split(" ")
      .filter(Boolean)
      .filter((token) => !isNoiseToken(token))
      .filter((token) => canonicalModel(token) !== brandToken)
      // medidas são EIXO, não modelo (FASE C: storage não vira modelo).
      .filter((token) => !/^\d+(tb|gb|mb|v|w|cm|mm|in)$/.test(token));
    /*
     * NÃO removemos dígitos soltos. "Redmi Buds 6 Play" sem o 6 vira
     * "redmibudsplay" e deixa de casar com "redmibuds6play" do outro site.
     * Dígito sozinho só é removido quando é medida (tratado acima).
     */
    if (kept.length > 0) {
      push(kept.join(" "), "TITLE_EXTRACTED");
    }

    /*
     * CANDIDATOS ADICIONAIS — tokens que PARECEM CÓDIGO de modelo.
     *
     * Títulos de commerce carregam ruído de cor/acessório
     * ("mouse m170 cinza f133"). A frase inteira vira uma chave tão
     * específica que nunca casa com a do outro site. O código do modelo
     * ("m170") é o que realmente identifica.
     *
     * Só aceita token que tem LETRA e DÍGITO juntos — "6" ou "20w" são
     * medida, não modelo.
     */
    const codeTokens = title
      .split(" ")
      .filter(Boolean)
      .filter((token) => /(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)/.test(token))
      .filter((token) => !/^\d+(tb|gb|mb|v|w|cm|mm|in)$/.test(token));
    for (const token of codeTokens) {
      push(token, "TITLE_EXTRACTED");
    }

    /*
     * MODEL_CODE por TOKEN relevante (não só códigos com dígito).
     *
     * A frase inteira depende do tamanho do título: "carregador iphone"
     * vira "iphone", enquanto "carregador ... iphone ... distribuidor
     * autorizado" vira "iponedistribuidorautorizado" — e as duas nunca se
     * encontram. O token em si é o sinal estável entre marketplaces.
     */
    for (const token of kept) {
      if (token.length >= 3) push(token, "TITLE_EXTRACTED");
    }
  }

  return out;
}

/* ================================================================== */
/* FASE C/E — CONSTRUÇÃO DAS BLOCKING KEYS                             */
/* ================================================================== */

export interface BuildKeysOptions {
  /** Léxico de marcas (normalizado canônico). */
  brandLexicon: ReadonlySet<string>;
}

/**
 * Gera TODAS as blocking keys de uma listing.
 *
 * Uma listing emite VÁRIAS chaves; o cruzamento acontece por "compartilham
 * ao menos uma chave". É isso que faz uma key estruturada (ex.:
 * manufacturerModel) e uma key de título encontrarem o mesmo par.
 */
export function buildBlockingKeys(
  listing: NormalizedMarketplaceListingV1,
  options: BuildKeysOptions,
): CandidateBlockingKeyV1[] {
  const keys: CandidateBlockingKeyV1[] = [];
  const category = canonicalCategory(listing);
  const { brand, provenance: brandProv } = extractBrand(listing, options.brandLexicon);
  const models = extractModelCandidates(listing, brand);

  const add = (
    type: BlockingKeyType,
    normalizedValue: string,
    strength: BlockingKeyStrength,
    provenance: KeyProvenance,
    cat = "",
  ) => {
    if (!normalizedValue) return;
    keys.push({
      version: CANDIDATE_BLOCKING_KEY_V1,
      type,
      normalizedValue,
      strength,
      provenance,
      category: cat,
    });
  };

  // CAMADA 1 — identificadores fortes.
  for (const gtin of listing.identity.gtin ?? []) {
    const v = canonicalModel(gtin);
    if (v) add("GTIN", v, "STRONG", "STRUCTURED_FIELD");
  }
  if (listing.identity.mpn) {
    add("MPN", canonicalModel(listing.identity.mpn), "STRONG", "STRUCTURED_FIELD");
  }
  if (listing.identity.manufacturerModel) {
    add(
      "MANUFACTURER_MODEL",
      canonicalModel(listing.identity.manufacturerModel),
      "STRONG",
      "STRUCTURED_FIELD",
    );
  }

  // CAMADA 2/3 — assinatura brand+category+model.
  if (brand && models.length > 0) {
    for (const { model, provenance } of models) {
      add("BRAND_CATEGORY_MODEL", `${brand}|${category}|${model}`, "MEDIUM", provenance, category);
      add("BRAND_MODEL_SIGNATURE", `${brand}|${model}`, "MEDIUM", provenance, category);
    }
  }

  /*
   * MODEL_CODE — o valor de modelo SEM a casca de brand/categoria.
   *
   * Sem esta chave, uma provenance estruturada e uma de título nunca se
   * encontram: o outro site indexa `MANUFACTURER_MODEL:m170` e o probe só
   * consegue produzir `BRAND_CATEGORY_MODEL:logitech|mouse|m170`. Como o
   * TIPO faz parte da chave, eram dois buckets distintos e o par nunca
   * aparecia — apesar de ser o mesmo produto.
   *
   * MODEL_CODE é sempre MEDIUM: um código de modelo sozinho não identifica
   * variante (pois storage/voltagem são eixos), então nunca vira EXACT.
   */
  for (const { model, provenance } of models) {
    add("MODEL_CODE", model, "MEDIUM", provenance, category);
  }
  // Marca veio do título (provenance TITLE_EXTRACTED) — ainda assim chave MEDIUM,
  // nunca STRONG. A decisão final NÃO olha isto; olha as evidências da política.
  void brandProv;

  return keys;
}

/* ================================================================== */
/* FASE F/G — ÍNDICE E TETO DE CANDIDATOS                              */
/* ================================================================== */

export interface BlockingKeyIndex {
  /** Lookup por chave exata, com teto. */
  lookup(
    type: BlockingKeyType,
    normalizedValue: string,
    limit: number,
  ): NormalizedMarketplaceListingV1[];
  /** Índice completo, para auditoria/diagnóstico. */
  size(): number;
}

export class InMemoryBlockingKeyIndex implements BlockingKeyIndex {
  private readonly map = new Map<string, NormalizedMarketplaceListingV1[]>();

  constructor(pool: NormalizedMarketplaceListingV1[] = []) {
    for (const listing of pool) this.addListing(listing);
  }

  /** Adiciona todas as chaves de uma listing ao índice. */
  addListing(listing: NormalizedMarketplaceListingV1, options?: BuildKeysOptions): void {
    const keys = buildBlockingKeys(listing, options ?? { brandLexicon: defaultBrandLexicon });
    for (const key of keys) {
      const bucket = this.map.get(indexKey(key.type, key.normalizedValue)) ?? [];
      bucket.push(listing);
      this.map.set(indexKey(key.type, key.normalizedValue), bucket);
    }
  }

  lookup(
    type: BlockingKeyType,
    normalizedValue: string,
    limit: number,
  ): NormalizedMarketplaceListingV1[] {
    const bucket = this.map.get(indexKey(type, normalizedValue)) ?? [];
    return bucket.slice(0, limit);
  }

  bucketSize(type: BlockingKeyType, normalizedValue: string): number {
    return this.map.get(indexKey(type, normalizedValue))?.length ?? 0;
  }

  size(): number {
    return this.map.size;
  }
}

function indexKey(type: BlockingKeyType, value: string): string {
  return `${type}:${value}`;
}

/** Lexicon mínimo de marcas para bootstrap. Ampliável por catálogo. */
const defaultBrandLexicon: ReadonlySet<string> = new Set([
  "apple", "xiaomi", "samsung", "anker", "soundcore", "logitech", "starlink",
  "philips", "sony", "lg", "asus", "lenovo", "dell", "hp", "motorola",
  "jbl", "baseus", "eleftric", "electrick", "faster", "tect", "x redundante",
]);

/* ================================================================== */
/* FASE G/H — GERAÇÃO DE CANDIDATOS COM PRE-FILTRO                    */
/* ================================================================== */

export type CandidateSkipReason =
  | "NO_STRONG_KEY"
  | "NO_BRAND"
  | "NO_MODEL"
  | "CATEGORY_MISMATCH"
  | "AMBIGUOUS_BLOCK"
  | "HARD_CONFLICT_PRE_FILTER"
  | "CANDIDATE_CAP"
  | "SAME_MARKETPLACE";

export interface CandidateSkipStat {
  reason: CandidateSkipReason;
  count: number;
}

export interface GeneratedCandidate {
  probeKey: string;
  candidateKey: string;
  candidateMarketplaceId: string;
  sharedKeyType: BlockingKeyType;
  sharedKeyValue: string;
  sharedKeyProvenance: KeyProvenance;
  sharedKeyStrength: BlockingKeyStrength;
}

export interface CandidateGenerationResult {
  candidates: GeneratedCandidate[];
  /** Uma entrada por probe, para diagnóstico. */
  perProbe: Array<{
    probeKey: string;
    reason: CandidateSkipReason | "OK";
    candidateCount: number;
  }>;
  skipStats: Record<string, number>;
  /** Chaves geradas mas que estouraram o teto (para AMBIGUOUS_BLOCK). */
  ambiguousBlocks: number;
}

export interface GenerateOptions {
  /** Teto de candidatos por probe. FASE G. */
  maxCandidatesPerListing?: number;
  /** Se true, descarta candidatos com hard conflict estrutural (FASE H). */
  hardConflictPreFilter?: boolean;
  brandLexicon?: ReadonlySet<string>;
}

export const MAX_CANDIDATES_PER_LISTING = 20;

/**
 * FASE H — pré-filtro de conflito duro.
 *
 * Regras:
 *  - SÓ quando AMBOS os lados falam de forma ESTRUTURADA.
 *  - UNKNOWN (ausente) nunca é conflito.
 *  - Compara GRANDEZA (1TB == 1024GB), não texto cru (FASE I).
 */
export function hasHardConflictPreFilter(
  probe: NormalizedMarketplaceListingV1,
  candidate: NormalizedMarketplaceListingV1,
): boolean {
  const axes = ["storage", "memory", "ram", "voltage", "screenSize"];
  for (const axis of axes) {
    const left = readAxis(probe, axis);
    const right = readAxis(candidate, axis);
    // UNKNOWN / ausente não é conflito.
    if (left.value === null || right.value === null) continue;
    // Só valor estruturado pode gerar conflito (título é descrição).
    if (left.fromText && right.fromText) continue;
    if (left.value === right.value) continue;
    const lg = capacityToGb(left.value);
    const rg = capacityToGb(right.value);
    if (lg !== null && rg !== null) {
      if (Math.abs(lg - rg) > 0.5) return true; // grandezas diferentes
    } else {
      return true; // não-capacidades com texto diferente = conflito
    }
  }
  return false;
}

/**
 * FASE G — gera candidatos cruzados para um probe.
 *
 * Determinístico: mesma entrada ⇒ mesma saída (sem random, sem clock).
 */
export function generateCandidates(
  probe: NormalizedMarketplaceListingV1,
  index: BlockingKeyIndex,
  options: GenerateOptions = {},
): CandidateGenerationResult {
  const max = options.maxCandidatesPerListing ?? MAX_CANDIDATES_PER_LISTING;
  const brandLexicon = options.brandLexicon ?? defaultBrandLexicon;
  const preFilter = options.hardConflictPreFilter ?? true;
  const probeKey = `${probe.marketplaceId}:${probe.externalListingId}`;

  const keys = buildBlockingKeys(probe, { brandLexicon });

  const result: CandidateGenerationResult = {
    candidates: [],
    perProbe: [],
    skipStats: {},
    ambiguousBlocks: 0,
  };

  if (keys.length === 0) {
    // Diagnóstico: por que não há chave.
    const hasBrand = extractBrand(probe, brandLexicon).brand.length > 0;
    const hasModel = extractModelCandidates(probe, "").length > 0;
    const hasStrong = keys.some((k) => k.strength === "STRONG");
    const reason: CandidateSkipReason = !hasBrand
      ? "NO_BRAND"
      : !hasModel
        ? "NO_MODEL"
        : !hasStrong
          ? "NO_STRONG_KEY"
          : "NO_MODEL";
    result.perProbe.push({ probeKey, reason, candidateCount: 0 });
    result.skipStats[reason] = (result.skipStats[reason] ?? 0) + 1;
    return result;
  }

  const seenCandidates = new Map<string, GeneratedCandidate>();
  let hitCap = false;

  // Itera de chave MAIS ESPECÍFICA para menos (FASE G: tenta a específica).
  const ordered = [...keys].sort((a, b) => {
    if (a.strength !== b.strength) return a.strength === "STRONG" ? -1 : 1;
    if (a.type !== b.type) return a.type === "MANUFACTURER_MODEL" ? -1 : 1;
    return a.normalizedValue.localeCompare(b.normalizedValue);
  });

  for (const key of ordered) {
    const bucketSize = (index as InMemoryBlockingKeyIndex).bucketSize
      ? (index as InMemoryBlockingKeyIndex).bucketSize(key.type, key.normalizedValue)
      : 0;
    if (bucketSize > max) {
      // Bloqueio ambíguo: esta chave traria candidatos demais.
      // Marcamos e seguimos para uma chave mais específica.
      result.ambiguousBlocks += 1;
      result.skipStats.AMBIGUOUS_BLOCK = (result.skipStats.AMBIGUOUS_BLOCK ?? 0) + 1;
      if (seenCandidates.size >= max) {
        hitCap = true;
        break;
      }
      continue;
    }
    const bucket = index.lookup(key.type, key.normalizedValue, max + 1);
    for (const cand of bucket) {
      if (cand.marketplaceId === probe.marketplaceId) continue; // não é cross-market
      if (cand.externalListingId === probe.externalListingId &&
          cand.marketplaceId === probe.marketplaceId) continue;
      const ckey = `${cand.marketplaceId}:${cand.externalListingId}`;
      if (seenCandidates.has(ckey)) continue;
      if (preFilter && hasHardConflictPreFilter(probe, cand)) {
        result.skipStats.HARD_CONFLICT_PRE_FILTER =
          (result.skipStats.HARD_CONFLICT_PRE_FILTER ?? 0) + 1;
        continue;
      }
      if (seenCandidates.size >= max) {
        hitCap = true;
        break;
      }
      seenCandidates.set(ckey, {
        probeKey,
        candidateKey: ckey,
        candidateMarketplaceId: cand.marketplaceId,
        sharedKeyType: key.type,
        sharedKeyValue: key.normalizedValue,
        sharedKeyProvenance: key.provenance,
        sharedKeyStrength: key.strength,
      });
    }
    if (hitCap) break;
  }

  result.candidates = [...seenCandidates.values()];
  if (hitCap) {
    result.skipStats.CANDIDATE_CAP = (result.skipStats.CANDIDATE_CAP ?? 0) + 1;
  }
  result.perProbe.push({
    probeKey,
    reason: "OK",
    candidateCount: result.candidates.length,
  });
  return result;
}
