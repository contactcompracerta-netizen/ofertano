/**
 * CATALOG_ARCHITECTURE_V1 — IDENTITY CONFIDENCE ENGINE (FASE 8.1 / FASE F, L, M).
 *
 * Formaliza a decisão de identidade cross-market. A FASE 8 provou que
 * similaridade textual sozinha NÃO pode produzir EXACT. Aqui a política é
 * explícita, versionada e EXPLICÁVEL.
 *
 * TRÊS PRINCÍPIOS:
 *
 *  1. NENHUM campo textual sozinho produz EXACT.
 *     GTIN sozinho: forte (identidade física). MPN/model/brand são
 *     "estruturais" mas exigem corroboração. Texto (título) nunca basta.
 *
 *  2. CONFLICT ≠ UNKNOWN.
 *     - CONFLICT  (256GB vs 512GB): as duas fontes AFIRMARAM valores
 *       diferentes => REJECT. Impede EXACT sempre.
 *     - UNKNOWN   (256GB vs ausente): a segunda fonte NÃO AFIRMOU nada.
 *       Não é contradição, mas também não é confirmação. Quando o atributo
 *       é CRÍTICO para a categoria => no máximo REVIEW, nunca EXACT.
 *
 *  3. A decisão vem dos DADOS, nunca do nome do marketplace.
 *     Não existe `if marketplace === "SHOPEE"` aqui nem em nenhum lugar do
 *     núcleo. A Shopee falha em REVIEW por não ter storage/GTIN — isso é
 *     consequência da ausência de dado, e a MESMA política aplicaria a
 *     qualquer outra fonte incompleta.
 *
 * A política é versionada (IDENTITY_POLICY_V1) para que um match antigo
 * possa ser reprocessado e saibamos qual regra o produziu (FASE M).
 */

import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import { UNKNOWN } from "../types/normalizedListingV1";

/** Versão da política. Todo match guarda a versão que o produziu. */
export const IDENTITY_POLICY_V1 = "IDENTITY_POLICY_V1" as const;
export type IdentityPolicyVersion = typeof IDENTITY_POLICY_V1;

export type IdentityConfidence = "EXACT" | "REVIEW" | "REJECT";

/* ------------------------------------------------------------------ */
/* ATRIBUTOS CRÍTICOS POR CATEGORIA (category-aware)                  */
/* ------------------------------------------------------------------ */

/**
 * Eixos de atributo com semântica de HARD CONFLICT. `critical` marca os que
 * são necessários para poder afirmar EXACT naquela categoria.
 */
export interface AttributeAxis {
  /** Identificador estável do eixo (nunca nome de marketplace). */
  key: string;
  /** Rotulo legível. */
  label: string;
  /** Quando true, a ausência do eixo IMPEDE EXACT (vira REVIEW). */
  critical: boolean;
}

export type CategoryProfile = {
  /** Categoria canônica (lowercase). */
  category: string;
  /** Sinais que classificam a listing nesta categoria. */
  match: string[];
  /** Eixos exigidos para EXACT. */
  criticalAxes: AttributeAxis[];
  /** Eixos comparados quando presentes, mas não exigidos. */
  optionalAxes: AttributeAxis[];
};

/** Eixos reutilizados entre categorias. */
const AXIS = {
  storage: { key: "storage", label: "Armazenamento", critical: true },
  memory: { key: "memory", label: "Memoria RAM", critical: true },
  model: { key: "model", label: "Modelo", critical: true },
  /*
   * version NAO e crítica para smartphone.
   *
   * Um eixo crítico que NENHUMA fonte disponível preenche transforma toda
   * decisão em REVIEW permanente — e um REVIEW que nunca pode virar EXACT não
   * é sinal, é ruído. Hoje nem a Shopee nem a oferta legada do ML expõem
   * versão estruturada, então exigir version tornaria smartphone
   * inexoravelmente REVIEW. Fica como eixo OPCIONAL: quando existir, ajuda;
   * quando faltar, não trava.
   */
  version: { key: "version", label: "Versao", critical: false },
  screenSize: { key: "screenSize", label: "Tamanho de tela", critical: true },
  voltage: { key: "voltage", label: "Voltagem", critical: true },
  ram: { key: "ram", label: "RAM", critical: true },
  cpu: { key: "cpu", label: "CPU", critical: false },
  size: { key: "size", label: "Tamanho", critical: false },
} as const satisfies Record<string, AttributeAxis>;

/**
 * Perfis de categoria. `match` sao sinais (normalizados) que, se aparecerem o
 * titulo/categoria da listing, colocam o produto nesta categoria.
 *
 * A lista é INTENCIONALMENTE pequena e cobre as categorias já observadas no
 * catálogo. É extensível: adicionar categoria = adicionar uma entrada aqui,
 * sem tocar no motor.
 */
export const CATEGORY_PROFILES: ReadonlyArray<CategoryProfile> = [
  {
    category: "smartphone",
    match: ["smartphone", "celular", "iphone", "galaxy", "redmi", "moto"],
    criticalAxes: [AXIS.model, AXIS.storage, AXIS.memory],
    optionalAxes: [AXIS.version, AXIS.screenSize, AXIS.voltage],
  },
  {
    category: "notebook",
    match: ["notebook", "laptop", "macbook", "chromebook"],
    criticalAxes: [AXIS.model, AXIS.ram, AXIS.storage],
    optionalAxes: [AXIS.cpu, AXIS.screenSize],
  },
  {
    category: "tv",
    match: ["smart tv", "smarttv", "televisao", "televisor", "oled", "qled"],
    criticalAxes: [AXIS.model, AXIS.screenSize],
    optionalAxes: [AXIS.version],
  },
  {
    category: "eletrodomestico",
    match: ["geladeira", "forno", "micro-ondas", "microondas", "lavadora", "ventilador", "air conditioner"],
    criticalAxes: [AXIS.model, AXIS.voltage],
    optionalAxes: [AXIS.size],
  },
  {
    category: "audio",
    match: ["fone", "headset", "earphone", "airpods", "fone de ouvido", "fone de ouvido"],
    criticalAxes: [AXIS.model],
    optionalAxes: [AXIS.size, AXIS.memory, AXIS.storage, AXIS.version],
  },
  {
    category: "computador_periferico",
    match: ["monitor", "teclado", "mouse", "cadeira gamer", "headset gamer"],
    criticalAxes: [AXIS.model],
    optionalAxes: [AXIS.size, AXIS.screenSize],
  },
];

/** Perfil genérico: não exige eixo crítico além do modelo. */
const DEFAULT_PROFILE: CategoryProfile = {
  category: "default",
  match: [],
  criticalAxes: [AXIS.model],
  optionalAxes: [AXIS.storage, AXIS.memory, AXIS.voltage, AXIS.size, AXIS.screenSize],
};

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Classifica a listing numa categoria pelo titulo/categoria declarados. */
export function classifyCategory(
  listing: NormalizedMarketplaceListingV1,
): CategoryProfile {
  const haystack = normalizeText(
    `${listing.catalog.title ?? ""} ${listing.catalog.category ?? ""}`,
  );
  if (haystack === "") return DEFAULT_PROFILE;
  for (const profile of CATEGORY_PROFILES) {
    if (profile.match.some((signal) => haystack.includes(normalizeText(signal)))) {
      return profile;
    }
  }
  return DEFAULT_PROFILE;
}
