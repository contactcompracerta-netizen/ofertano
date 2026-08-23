import type {
  ProductImport,
} from "@/services/importers/core/types";

import {
  canonizarHifensModelo,
  codigosDeIdentidadeDoItemVendido,
  ehCodigoSkuEspecifico,
  ehPapelNaoPrincipal,
  extrairGtinDaConsulta,
  normalizarTextoIdentidade,
  resolverIdentidadeProduto,
  selecionarCodigosModeloMaisEspecificos,
} from "./resolver";

import type {
  IdentityVariantKey,
  ProductIdentity,
} from "./resolver";

import {
  candidatoTemClasseEquivalente,
  compatibilidadeDeClasseProduto,
  tokensDeClasseConhecidos,
  type ClassCompatibility,
  type ProductClassId,
} from "./productClass";

export type QueryIdentityInput = Pick<
  ProductImport,
  "title" | "brand" | "attributes"
>;

export type EvidenceState = "MATCH" | "MISSING" | "CONFLICT" | "UNKNOWN";

export type MatchDecisionStatus = "ACCEPTED" | "REJECTED" | "INSUFFICIENT";

export type QueryMatchResult = {
  compatible: boolean;
  status: MatchDecisionStatus;
  score: number;
  textRelevance: number;
  roleCompatible: boolean;
  roleBoost: number;
  finalRelevance: number;
  reason: string;
  matchedBy:
    | "MODEL"
    | "BRAND"
    | "LEXICAL"
    | "GENERIC"
    | null;
  conflicts: string[];
  hardConflicts: string[];
  positiveEvidence: string[];
  queryProductClass: string;
  candidateProductClass: string;
  productClassCompatibility: EvidenceState;
  queryBrand: string | null;
  candidateBrand: string | null;
  brandCompatibility: EvidenceState;
  attributeMatches: string[];
  attributeMissing: string[];
  attributeConflicts: string[];
  distinctiveTermsMatched: string[];
  distinctiveTermsMissing: string[];
  matchedTerms: string[];
  missingTerms: string[];
  identityEvidenceScore: number;
  attributeCoverage: number;
  autoAcceptanceReason: string;
};

const QUERY_STOP_WORDS = new Set([
  "a",
  "as",
  "o",
  "os",
  "de",
  "da",
  "das",
  "do",
  "dos",
  "e",
  "em",
  "na",
  "nas",
  "no",
  "nos",
  "para",
  "por",
  "com",
  "sem",
  "um",
  "uma",
  "novo",
  "nova",
  "original",
  "oficial",
  "oferta",
  "promocao",
  "mais",
]);

const MODEL_SUFFIX_STOP_WORDS = new Set([
  ...QUERY_STOP_WORDS,
  "intel",
  "amd",
  "nvidia",
  "windows",
  "linux",
  "macos",
  "core",
  "geracao",
]);

const GENERIC_PRODUCT_WORDS = new Set([
  "produto",
  "smartphone",
  "celular",
  "telefone",
  "notebook",
  "laptop",
  "tablet",
  "televisao",
  "tv",
  "monitor",
  "camera",
  "relogio",
  "smartwatch",
]);

/*
 * Termos de classe, conectividade, cor e adjetivo comercial.
 * Nao entram em GENERIC_PRODUCT_WORDS para nao quebrar extracao
 * de modelo (ex.: iPhone 15). Servem so para ponderar relevancia
 * e montar o plano de busca progressivo.
 */
const GENERIC_CLASS_WORDS = new Set([
  ...GENERIC_PRODUCT_WORDS,
  "fone",
  "fones",
  "ouvido",
  "ouvidos",
  "headphone",
  "headphones",
  "headset",
  "earbuds",
  "earphone",
  "earphones",
  "auricular",
  "mouse",
  "teclado",
  "keyboard",
  "pendrive",
  "lanterna",
  "console",
  "videogame",
  "microfone",
  "speaker",
  "caixa",
  "som",
  "liquidificador",
  "furadeira",
  "parafusadeira",
  "aspirador",
  "cafeteira",
  "airfryer",
  "fritadeira",
  "balanca",
  "scale",
  "lustre",
  "luminaria",
  "abajur",
  "espelho",
  "jogo",
  "colher",
  "controle",
  "altofalante",
  "soundbar",
  "soundbox",
  "estojo",
  ...tokensDeClasseConhecidos(),
  "almofada",
  "almofadas",
  "capa",
  "capinha",
  "case",
  "pelicula",
  "cabo",
  "carregador",
  "adaptador",
  "suporte",
  "bolsa",
  "protetor",
  "substituicao",
  "reposicao",
  "peca",
  "mesa",
  "cabeceira",
  "criado",
  "mudo",
  "comoda",
  "gaveta",
  "gavetas",
  "armario",
  "estante",
  "rack",
  "sofa",
  "cama",
  "moveis",
]);

const GENERIC_CONNECTIVITY_WORDS = new Set([
  "wireless",
  "bluetooth",
  "wifi",
  "wi",
  "fi",
  "bt",
  "nfc",
  "usb",
  "cabo",
]);

const GENERIC_COLOR_WORDS = new Set([
  "preto",
  "preta",
  "branco",
  "branca",
  "cinza",
  "prata",
  "prateado",
  "azul",
  "verde",
  "vermelho",
  "vermelha",
  "rosa",
  "pink",
  "roxo",
  "roxa",
  "dourado",
  "dourada",
  "bege",
  "marrom",
  "amarelo",
  "amarela",
  "laranja",
  "black",
  "white",
  "red",
  "blue",
  "green",
  "gold",
  "silver",
  "gray",
  "grey",
]);

const GENERIC_ADJECTIVE_WORDS = new Set([
  "resistente",
  "resistentes",
  "resistencia",
  "agua",
  "waterproof",
  "recarregavel",
  "tatico",
  "tatica",
  "led",
  "profissional",
  "digital",
  "metalico",
  "metalica",
  "portatil",
  "inalambrico",
  "inalambrica",
  "sem",
  "fio",
  "fios",
  "novo",
  "nova",
  "original",
  "oficial",
  "premium",
  "barato",
  "barata",
  "oferta",
  "promocao",
  "kit",
  "modelo",
  "true",
  "stereo",
  "audio",
  "mdp",
  "mdf",
]);

const PRODUCT_CLASS_GROUPS: string[][] = [
  [
    "fone",
    "fones",
    "ouvido",
    "ouvidos",
    "headphone",
    "headphones",
    "headset",
    "earbuds",
    "earphone",
    "earphones",
    "auricular",
  ],
  ["smartphone", "celular", "telefone", "iphone"],
  ["notebook", "laptop"],
  ["liquidificador"],
  ["furadeira", "parafusadeira"],
  ["pendrive"],
  ["lanterna"],
  ["mouse"],
  ["teclado", "keyboard"],
  ["caixa", "som", "speaker"],
  [
    "mesa",
    "cabeceira",
    "criado",
    "comoda",
    "gaveta",
    "gavetas",
    "armario",
    "moveis",
  ],
];

const DISTINCTIVE_TOKEN_WEIGHT = 5;
const CLASS_TOKEN_WEIGHT = 1;
const ATTRIBUTE_TOKEN_WEIGHT = 1.2;
const DEFAULT_TOKEN_WEIGHT = 2;

const STRONG_VARIANT_KEYS: IdentityVariantKey[] = [
  "voltage",
  "storage",
  "ram",
  "network",
  "color",
  "size",
  "capacity",
  "kitQuantity",
  "condition",
  "bundle",
];

/*
 * Cor, bundle e extras opcionais: ausencia nao prova identidade.
 * Conflito so existe quando os dois lados declaram valores diferentes.
 * Armazenamento, RAM, rede, voltagem e capacidade continuam estritos.
 */
const OPTIONAL_VARIANT_KEYS = new Set<IdentityVariantKey>([
  "color",
  "bundle",
]);

type MatchEvidence = Pick<
  QueryMatchResult,
  | "queryProductClass"
  | "candidateProductClass"
  | "productClassCompatibility"
  | "queryBrand"
  | "candidateBrand"
  | "brandCompatibility"
  | "attributeMatches"
  | "attributeMissing"
  | "attributeConflicts"
  | "distinctiveTermsMatched"
  | "distinctiveTermsMissing"
  | "matchedTerms"
  | "missingTerms"
  | "identityEvidenceScore"
  | "attributeCoverage"
  | "autoAcceptanceReason"
>;

const EMPTY_EVIDENCE: MatchEvidence = {
  queryProductClass: "UNKNOWN",
  candidateProductClass: "UNKNOWN",
  productClassCompatibility: "UNKNOWN",
  queryBrand: null,
  candidateBrand: null,
  brandCompatibility: "UNKNOWN",
  attributeMatches: [],
  attributeMissing: [],
  attributeConflicts: [],
  distinctiveTermsMatched: [],
  distinctiveTermsMissing: [],
  matchedTerms: [],
  missingTerms: [],
  identityEvidenceScore: 0,
  attributeCoverage: 0,
  autoAcceptanceReason: "",
};

function reject(
  reason: string,
  conflicts: string[],
  extras: {
    textRelevance?: number;
    roleCompatible?: boolean;
    roleBoost?: number;
    finalRelevance?: number;
    status?: MatchDecisionStatus;
    positiveEvidence?: string[];
  } & Partial<MatchEvidence> = {},
): QueryMatchResult {
  const textRelevance = extras.textRelevance ?? 0;
  const roleCompatible = extras.roleCompatible ?? true;
  const roleBoost = extras.roleBoost ?? (roleCompatible ? 1 : 0);
  const status = extras.status ?? "REJECTED";

  return {
    compatible: false,
    status,
    score: 0,
    textRelevance,
    roleCompatible,
    roleBoost,
    finalRelevance: extras.finalRelevance ?? textRelevance * roleBoost,
    reason,
    matchedBy: null,
    conflicts,
    hardConflicts: conflicts,
    positiveEvidence: extras.positiveEvidence ?? [],
    ...EMPTY_EVIDENCE,
    ...extras,
    autoAcceptanceReason: extras.autoAcceptanceReason ?? "",
  };
}

function normalizeCode(
  value: string,
): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\+/g, "PLUS")
    .replace(/[^A-Z0-9]+/g, "")
    .trim();
}

function isTechnicalCode(
  code: string,
): boolean {
  return (
    /^(?:4G|5G|6G|LTE|WIFI\d*|BLUETOOTH\d*|BT\d*)$/.test(code) ||
    /^(?:2K|4K|5K|6K|8K|10K)$/.test(code) ||
    /^(?:\d+(?:GB|TB|MB|KB|MAH|MP|HZ|KHZ|MHZ|GHZ|W|KW|V|A|MM|CM|ML|L|KG|G))$/.test(code) ||
    /^(?:DDR|LPDDR|GDDR|USB|HDMI|HDR|IP|RTX|GTX|NVME|SSD|HDD)\d/.test(code)
  );
}

/*
 * Extrai apenas codigos de modelo explicitamente fortes na consulta.
 *
 * A regra e global: alfanumericos como A16, G75, XT2503, SM-S921B
 * ou familia + numero como Edge 60 e iPhone 15. Numeros de uma casa
 * nao viram modelo por conta propria, evitando interpretar "2 gavetas"
 * como codigo de produto.
 */
function extrairCodigosFortesDaConsulta(
  query: string,
  identity?: ProductIdentity,
): string[] {
  const normalized = normalizarTextoIdentidade(query);
  const words = normalized.split(" ").filter(Boolean);
  const codes = new Set<string>();

  const rawTokens =
    canonizarHifensModelo(query).match(
      /[A-Za-z0-9]+(?:[-+][A-Za-z0-9]+)*/g,
    ) ?? [];

  for (const raw of rawTokens) {
    const code = normalizeCode(raw);

    if (
      code &&
      /[A-Z]/.test(code) &&
      /\d/.test(code) &&
      code.length >= 2 &&
      !isTechnicalCode(code)
    ) {
      codes.add(code);
    }
  }

  const technicalContexts = new Set([
    "camera",
    "tela",
    "display",
    "bateria",
    "memoria",
    "ram",
    "rom",
    "ssd",
    "hdd",
    "potencia",
    "voltagem",
    "tensao",
    "frequencia",
    "peso",
    "capacidade",
  ]);

  const technicalUnits = new Set([
    "gb",
    "tb",
    "mb",
    "mah",
    "mp",
    "hz",
    "khz",
    "mhz",
    "ghz",
    "w",
    "kw",
    "v",
    "mm",
    "cm",
    "ml",
    "kg",
    "pol",
    "polegada",
    "polegadas",
    "inch",
    "inches",
    "litro",
    "litros",
  ]);

  const variantNumbers = new Set(
    identity
      ? Object.values(identity.variants)
          .filter((value): value is string => Boolean(value))
          .map((value) => value.match(/^\d+(?:[.,]\d+)?/)?.[0] ?? null)
          .filter((value): value is string => Boolean(value))
      : [],
  );

  for (let index = 0; index < words.length - 1; index += 1) {
    const first = words[index] ?? "";
    const second = words[index + 1] ?? "";
    const third = words[index + 2] ?? "";
    const fourth = words[index + 3] ?? "";

    if (
      !/^[a-z][a-z0-9+]{1,20}$/.test(first) ||
      !/^\d{2,4}$/.test(second) ||
      GENERIC_PRODUCT_WORDS.has(first) ||
      technicalContexts.has(first) ||
      /\d/.test(first)
    ) {
      continue;
    }

    /*
     * Numero que ja foi resolvido como dimensao/variante (ex.: TV 55
     * polegadas) nao pode virar modelo forte por acidente.
     */
    if (variantNumbers.has(second)) {
      continue;
    }

    if (technicalUnits.has(third)) {
      continue;
    }

    const baseCode = normalizeCode(`${first}${second}`);

    if (baseCode && !isTechnicalCode(baseCode)) {
      codes.add(baseCode);
    }

    if (
      (
        /^[a-z][a-z0-9+]{1,20}$/.test(third) ||
        /^\d{1,4}[a-z][a-z0-9]{0,8}$/.test(third)
      ) &&
      !technicalUnits.has(third) &&
      !MODEL_SUFFIX_STOP_WORDS.has(third)
    ) {
      const specificCode = normalizeCode(
        `${first}${second}${third}`,
      );

      if (specificCode && !isTechnicalCode(specificCode)) {
        codes.add(specificCode);
      }

      if (
        (
          /^[a-z][a-z0-9+]{1,20}$/.test(fourth) ||
          /^\d{1,4}[a-z][a-z0-9]{0,8}$/.test(fourth)
        ) &&
        !technicalUnits.has(fourth) &&
        !MODEL_SUFFIX_STOP_WORDS.has(fourth)
      ) {
        const extendedCode = normalizeCode(
          `${first}${second}${third}${fourth}`,
        );

        if (extendedCode && !isTechnicalCode(extendedCode)) {
          codes.add(extendedCode);
        }
      }
    }
  }

  return Array.from(codes);
}

function codigosMaisEspecificos(
  codes: string[],
): string[] {
  const normalized = Array.from(
    new Set(codes.map(normalizeCode).filter(Boolean)),
  );

  return normalized.filter(
    (code) =>
      !normalized.some(
        (other) =>
          other !== code &&
          other.startsWith(code) &&
          other.length > code.length,
      ),
  );
}

function tokensRelevantes(
  value: string,
): string[] {
  return normalizarTextoIdentidade(value)
    .split(" ")
    .filter(
      (token) =>
        Boolean(token) &&
        token.length >= 2 &&
        !QUERY_STOP_WORDS.has(token) &&
        !/^\d+(?:gb|tb|mb|kb|mah|mp|hz|khz|mhz|ghz|w|kw|v|a|mm|cm|ml|l|kg|g)$/.test(token),
    );
}

function ehTokenDeClasse(
  token: string,
): boolean {
  return GENERIC_CLASS_WORDS.has(token);
}

function ehTokenDeAtributoGenerico(
  token: string,
): boolean {
  return (
    GENERIC_CONNECTIVITY_WORDS.has(token) ||
    GENERIC_COLOR_WORDS.has(token) ||
    GENERIC_ADJECTIVE_WORDS.has(token)
  );
}

function ehTokenDistintivo(
  token: string,
): boolean {
  if (!token || token.length < 3) {
    return false;
  }

  if (
    ehTokenDeClasse(token) ||
    ehTokenDeAtributoGenerico(token) ||
    QUERY_STOP_WORDS.has(token)
  ) {
    return false;
  }

  if (/^\d+$/.test(token)) {
    return false;
  }

  if (
    /^(?:gb|tb|mb|mah|mm|cm|pol|led|rgb|abs)$/.test(token)
  ) {
    return false;
  }

  return true;
}

function grupoDeClasseDoToken(
  token: string,
): string | null {
  const group = PRODUCT_CLASS_GROUPS.find((items) =>
    items.includes(token),
  );

  return group ? group[0] ?? null : null;
}

function gruposDeClasse(
  tokens: string[],
): Set<string> {
  const groups = new Set<string>();

  for (const token of tokens) {
    const group = grupoDeClasseDoToken(token);

    if (group) {
      groups.add(group);
    }
  }

  return groups;
}

function sinonimosDeToken(
  token: string,
): string[] {
  const group = PRODUCT_CLASS_GROUPS.find((items) =>
    items.includes(token),
  );

  return group ?? [token];
}

function candidatoPossuiToken(
  token: string,
  candidateTokens: Set<string>,
  candidateTitle = "",
): boolean {
  if (
    sinonimosDeToken(token).some((item) => candidateTokens.has(item))
  ) {
    return true;
  }

  if (candidateTitle && candidatoTemClasseEquivalente(token, candidateTitle)) {
    return true;
  }

  return candidateTitle
    ? atributoEquivalentePresente(token, candidateTitle)
    : false;
}

function pesoDoTokenConsulta(
  token: string,
): number {
  if (ehTokenDistintivo(token)) {
    return DISTINCTIVE_TOKEN_WEIGHT;
  }

  if (ehTokenDeClasse(token)) {
    return CLASS_TOKEN_WEIGHT;
  }

  if (ehTokenDeAtributoGenerico(token)) {
    return ATTRIBUTE_TOKEN_WEIGHT;
  }

  return DEFAULT_TOKEN_WEIGHT;
}

export function tokensDistintivosDaConsulta(
  query: string,
): string[] {
  return Array.from(
    new Set(
      tokensRelevantes(query).filter(ehTokenDistintivo),
    ),
  );
}

export function pontuarCoberturaLexicalPonderada(
  query: string,
  candidateTitle: string,
): {
  score: number;
  queryCoverage: number;
  matchedTokens: string[];
  queryTokens: string[];
  missingDistinctive: string[];
} {
  const queryTokens = tokensRelevantes(query);
  const candidateTokenList = tokensRelevantes(candidateTitle);
  const candidateTokens = new Set(candidateTokenList);
  const queryTokenSet = new Set(queryTokens);
  const matchedTokens = queryTokens.filter((token) =>
    candidatoPossuiToken(token, candidateTokens, candidateTitle),
  );
  const missingDistinctive = tokensDistintivosDaConsulta(query).filter(
    (token) => !candidatoPossuiToken(token, candidateTokens, candidateTitle),
  );

  if (queryTokens.length === 0) {
    return {
      score: 0.5,
      queryCoverage: 0.5,
      matchedTokens,
      queryTokens,
      missingDistinctive,
    };
  }

  const totalWeight = queryTokens.reduce(
    (total, token) => total + pesoDoTokenConsulta(token),
    0,
  );
  const matchedWeight = matchedTokens.reduce(
    (total, token) => total + pesoDoTokenConsulta(token),
    0,
  );
  const extraCandidate = candidateTokenList.filter((token) => {
    if (queryTokenSet.has(token)) {
      return false;
    }

    if (sinonimosDeToken(token).some((item) => queryTokenSet.has(item))) {
      return false;
    }

    return ehTokenDistintivo(token) || ehTokenDeClasse(token);
  });
  const extraWeight = extraCandidate.reduce(
    (total, token) => total + pesoDoTokenConsulta(token),
    0,
  );
  const queryCoverage = totalWeight === 0 ? 0 : matchedWeight / totalWeight;
  /*
   * Relevancia bilateral: tokens extras do candidato (lustre, colher, jogo)
   * entram no denominador. Cobertura so da query fazia todos os anuncios
   * com a mesma marca receberem o mesmo queryTextRelevance.
   */
  const twoSided =
    totalWeight + extraWeight === 0
      ? 0
      : matchedWeight / (totalWeight + extraWeight);

  return {
    score: twoSided,
    queryCoverage,
    matchedTokens,
    queryTokens,
    missingDistinctive,
  };
}

export function candidatoPodeSeguirNoDiscovery(
  query: string,
  title: string,
): {
  keep: boolean;
  reason: string;
} {
  const distinctive = tokensDistintivosDaConsulta(query);

  if (distinctive.length === 0) {
    return {
      keep: true,
      reason: "Consulta sem termo distintivo; Discovery permanece amplo.",
    };
  }

  const missing = pontuarCoberturaLexicalPonderada(query, title)
    .missingDistinctive;
  const matchedDistinctive = distinctive.filter(
    (token) => !missing.includes(token),
  );

  if (matchedDistinctive.length === 0) {
    return {
      keep: false,
      reason: `Nenhum termo distintivo da consulta aparece no titulo: ${distinctive.join(", ")}.`,
    };
  }

  return {
    keep: true,
    reason: "Pelo menos um termo distintivo da consulta esta no titulo.",
  };
}

function modeloCoincide(
  queryCodes: string[],
  candidate: ProductIdentity,
  queryIdentity: ProductIdentity,
): boolean {
  if (queryCodes.length === 0) {
    return false;
  }

  const requiredCodes = selecionarCodigosModeloMaisEspecificos(queryCodes);
  const requiredSku = requiredCodes
    .filter((code) => ehCodigoSkuEspecifico(code))
    .sort((first, second) => second.length - first.length)[0] ?? null;
  const codesToRequire = requiredSku ? [requiredSku] : requiredCodes;

  /*
   * Identidade do item vendido ja foi resolvida. Codigos do hospedeiro
   * so entram quando a propria consulta pede acessorio/peca.
   */
  const soldCodes = codigosDeIdentidadeDoItemVendido(candidate);
  const hostCodes =
    ehPapelNaoPrincipal(queryIdentity.kind) &&
    ehPapelNaoPrincipal(candidate.kind)
      ? candidate.hostModelCandidates
      : [];
  const fallbackTitleCodes =
    candidate.compatibilityRelation ||
    candidate.hostModelCandidates.length > 0
      ? []
      : extrairCodigosFortesDaConsulta(
          candidate.title,
          candidate,
        );
  const identityCodes = [
    ...(soldCodes.length > 0 ? soldCodes : fallbackTitleCodes),
    ...hostCodes,
  ];
  const candidateCodes = new Set(identityCodes.map(normalizeCode));
  const allCandidateCodes = new Set(
    identityCodes.map(normalizeCode).filter(Boolean),
  );

  return codesToRequire.some((code) => {
    const normalizedCode = normalizeCode(code);

    if (
      !candidateCodes.has(normalizedCode) &&
      !allCandidateCodes.has(normalizedCode)
    ) {
      return false;
    }

    /*
     * Se o candidato declara um submodelo mais especifico que a consulta,
     * nao tratamos o codigo-base como equivalencia. Ex.: iPhone 15 Pro nao
     * pode aceitar Pro Max apenas porque ambos contem IPHONE15PRO.
     */
    const moreSpecificCandidate = Array.from(allCandidateCodes).some(
      (candidateCode) =>
        candidateCode.startsWith(normalizedCode) &&
        candidateCode.length > normalizedCode.length,
    );

    return !moreSpecificCandidate;
  });
}

function atributoEquivalentePresente(
  token: string,
  title: string,
): boolean {
  const normalized = normalizarTextoIdentidade(title);

  if (
    token === "wireless" ||
    token === "bluetooth" ||
    token === "inalambrico" ||
    token === "inalambrica"
  ) {
    return (
      /\bsem fio\b/.test(normalized) ||
      /\bwireless\b/.test(normalized) ||
      /\bbluetooth\b/.test(normalized)
    );
  }

  if (token === "fio" || token === "sem") {
    return /\bsem fio\b/.test(normalized) || /\bwireless\b/.test(normalized);
  }

  if (
    token === "resistente" ||
    token === "resistentes" ||
    token === "waterproof" ||
    token === "agua"
  ) {
    return (
      /\bresistente(?:s)? a agua\b/.test(normalized) ||
      /\ba prova d? agua\b/.test(normalized) ||
      /\bwaterproof\b/.test(normalized) ||
      /\bipx?\d+\b/.test(normalized)
    );
  }

  return false;
}

function trechoVendido(title: string): string {
  const normalized = normalizarTextoIdentidade(title);
  const [sold = normalized] = normalized.split(
    /\b(?:compative(?:l|is) com|compatible(?:s)? with|edicao|para)\b/,
  );

  return sold.trim();
}

function entidadeComercialDaConsulta(
  query: string,
  identity: ProductIdentity,
): string | null {
  void query;

  /*
   * Evidencia positiva de marca no motor atual:
   * 1. campo estruturado / atributo BRAND|MARCA
   * 2. alias conhecido no titulo (inferirMarcaPeloTitulo no resolver)
   *
   * Classe reconhecida + token restante NAO e marca. Atributo, material,
   * cor, tecnologia e caracteristica continuam termos lexicais.
   */
  return identity.brand;
}

function mesmaEntidadeComercial(
  first: string,
  second: string,
): boolean {
  const left = first
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
  const right = second
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");

  return Boolean(left) && left === right;
}

function entidadeComercialDoCandidato(
  candidateBrand: string | null,
  candidateTitle: string,
): string | null {
  if (candidateBrand) {
    return candidateBrand;
  }

  const sold = trechoVendido(candidateTitle);
  const entity = tokensRelevantes(sold).find(
    (token) => ehTokenDistintivo(token) && !/\d/.test(token) && token.length >= 3,
  );

  return entity ?? null;
}

function compararMarcaConsulta(
  queryBrand: string | null,
  candidateBrand: string | null,
  candidateTitle: string,
): EvidenceState {
  if (!queryBrand) {
    return "UNKNOWN";
  }

  const resolvedCandidate = entidadeComercialDoCandidato(
    candidateBrand,
    candidateTitle,
  );

  if (resolvedCandidate) {
    return mesmaEntidadeComercial(queryBrand, resolvedCandidate)
      ? "MATCH"
      : "CONFLICT";
  }

  const sold = trechoVendido(candidateTitle);

  if (sold.split(" ").some((token) => mesmaEntidadeComercial(token, queryBrand))) {
    return "MATCH";
  }

  if (
    normalizarTextoIdentidade(candidateTitle)
      .split(" ")
      .some((token) => mesmaEntidadeComercial(token, queryBrand))
  ) {
    return "CONFLICT";
  }

  return "MISSING";
}

function avaliarAtributosDaConsulta(
  query: string,
  queryIdentity: ProductIdentity,
  candidate: ProductIdentity,
): {
  matches: string[];
  missing: string[];
  conflicts: string[];
  coverage: number;
} {
  const matches: string[] = [];
  const missing: string[] = [];
  const conflicts: string[] = [];
  const queryText = normalizarTextoIdentidade(query);
  const candidateText = normalizarTextoIdentidade(candidate.title);

  const queryWireless =
    /\b(?:wireless|bluetooth|inalambrico|inalambrica)\b/.test(queryText) ||
    /\bsem fio\b/.test(queryText);
  const candidateWireless =
    /\b(?:wireless|bluetooth|inalambrico|inalambrica)\b/.test(candidateText) ||
    /\bsem fio\b/.test(candidateText);
  const candidateWired = /\bcom fio\b/.test(candidateText) || /\bwired\b/.test(candidateText);

  if (queryWireless) {
    if (candidateWired && !candidateWireless) {
      conflicts.push("wireless");
    } else if (candidateWireless) {
      matches.push("wireless");
    } else {
      missing.push("wireless");
    }
  }

  const queryWaterproof =
    /\b(?:waterproof|ipx?\d+)\b/.test(queryText) ||
    /\bresistente(?:s)? a agua\b/.test(queryText) ||
    /\ba prova d? agua\b/.test(queryText);
  const candidateWaterproof =
    /\b(?:waterproof|ipx?\d+)\b/.test(candidateText) ||
    /\bresistente(?:s)? a agua\b/.test(candidateText) ||
    /\ba prova d? agua\b/.test(candidateText);

  if (queryWaterproof) {
    if (candidateWaterproof) {
      matches.push("waterproof");
    } else {
      missing.push("waterproof");
    }
  }

  const queryMic = /\b(?:microfone|microphone)\b/.test(queryText);
  const candidateMic = /\b(?:microfone|microphone)\b/.test(candidateText);

  if (queryMic) {
    if (candidateMic) {
      matches.push("microphone");
    } else {
      missing.push("microphone");
    }
  }

  for (const key of STRONG_VARIANT_KEYS) {
    const requested = queryIdentity.variants[key];
    const found = candidate.variants[key];

    if (!requested) {
      continue;
    }

    if (!found) {
      if (OPTIONAL_VARIANT_KEYS.has(key)) {
        missing.push(key);
      } else {
        conflicts.push(`${key}:${requested}!=nao-informado`);
      }
      continue;
    }

    if (requested !== found) {
      conflicts.push(`${key}:${requested}!=${found}`);
    } else {
      matches.push(key);
    }
  }

  const requestedCount = matches.length + missing.length + conflicts.length;

  return {
    matches,
    missing,
    conflicts,
    coverage: requestedCount === 0 ? 1 : matches.length / requestedCount,
  };
}

function verificarVariantesExplicitas(
  query: ProductIdentity,
  candidate: ProductIdentity,
): string[] {
  const conflicts: string[] = [];

  for (const key of STRONG_VARIANT_KEYS) {
    const requested = query.variants[key];
    const found = candidate.variants[key];

    if (!requested) {
      continue;
    }

    /*
     * Se o cliente explicitou uma variante, ausencia de evidencia tambem
     * nao e suficiente para confirmar o candidato. Isso evita que uma
     * oferta sem "4G/5G", armazenamento, RAM, voltagem etc. atravesse uma
     * consulta que pediu exatamente essa configuracao. Adapters podem
     * preencher a evidencia via attributes quando o titulo for incompleto.
     */
    if (!found) {
      if (OPTIONAL_VARIANT_KEYS.has(key)) {
        continue;
      }

      conflicts.push(
        `${key}:${requested}!=nao-informado`,
      );
      continue;
    }

    if (requested !== found) {
      conflicts.push(
        `${key}:${requested}!=${found}`,
      );
    }
  }

  return conflicts;
}

export function matchQueryToCandidate(
  queryIdentity: ProductIdentity,
  candidate: ProductIdentity,
): QueryMatchResult {
  const query = queryIdentity.title;
  const queryCodes = extrairCodigosFortesDaConsulta(
    query,
    queryIdentity,
  );
  const modelMatched =
    queryCodes.length > 0 &&
    modeloCoincide(queryCodes, candidate, queryIdentity);
  const queryTokens = tokensRelevantes(query);
  const lexical = pontuarCoberturaLexicalPonderada(query, candidate.title);
  const matchedTokens = lexical.matchedTokens;
  const lexicalScore = lexical.score;
  const queryCoverage = lexical.queryCoverage;
  const textRelevance = Math.min(1, lexicalScore);
  const distinctiveTokens = tokensDistintivosDaConsulta(query);
  const missingDistinctive = lexical.missingDistinctive;
  const matchedDistinctive = distinctiveTokens.filter(
    (token) => !missingDistinctive.includes(token),
  );

  const queryClass = queryIdentity.productClass;
  const candidateClass = candidate.productClass;
  const classCompatibility = compatibilidadeDeClasseProduto(
    queryClass,
    candidateClass,
  );
  const queryBrand = entidadeComercialDaConsulta(query, queryIdentity);
  const candidateBrand =
    candidate.brand ??
    entidadeComercialDoCandidato(candidate.brand, candidate.title);
  const brandCompatibility = compararMarcaConsulta(
    queryBrand,
    candidate.brand,
    candidate.title,
  );
  const attributes = avaliarAtributosDaConsulta(
    query,
    queryIdentity,
    candidate,
  );

  const identityEvidenceScore = Math.min(
    1,
    (classCompatibility === "MATCH" ? 0.35 : 0) +
      (brandCompatibility === "MATCH" ? 0.35 : 0) +
      (modelMatched ? 0.3 : 0) +
      (attributes.coverage * 0.2),
  );

  const roleCompatible =
    ehPapelNaoPrincipal(queryIdentity.kind) ===
      ehPapelNaoPrincipal(candidate.kind) &&
    (
      !ehPapelNaoPrincipal(queryIdentity.kind) ||
      queryIdentity.kind === candidate.kind
    );
  const roleBoost = roleCompatible ? 1 : 0;
  const finalRelevance = textRelevance * (roleBoost || 0.15);

  const positiveEvidence: string[] = [];
  if (classCompatibility === "MATCH") {
    positiveEvidence.push(`productClass:${queryClass}`);
  }
  if (brandCompatibility === "MATCH" && queryBrand) {
    positiveEvidence.push(`brand:${queryBrand}`);
  }
  if (modelMatched) {
    positiveEvidence.push("model");
  }
  if (matchedDistinctive.length > 0) {
    positiveEvidence.push(`terms:${matchedDistinctive.join(",")}`);
  }

  const evidence: MatchEvidence = {
    queryProductClass: queryClass,
    candidateProductClass: candidateClass,
    productClassCompatibility: classCompatibility,
    queryBrand,
    candidateBrand,
    brandCompatibility,
    attributeMatches: attributes.matches,
    attributeMissing: attributes.missing,
    attributeConflicts: attributes.conflicts,
    distinctiveTermsMatched: matchedDistinctive,
    distinctiveTermsMissing: missingDistinctive,
    matchedTerms: matchedTokens,
    missingTerms: missingDistinctive,
    identityEvidenceScore,
    attributeCoverage: attributes.coverage,
    autoAcceptanceReason: "",
  };

  const gateExtras = {
    textRelevance,
    roleCompatible,
    roleBoost,
    finalRelevance,
    positiveEvidence,
    ...evidence,
  };

  const conflicts: string[] = [];

  /*
   * FASE A — hard gates. Score nao autoriza identidade.
   */
  if (
    !ehPapelNaoPrincipal(queryIdentity.kind) &&
    (
      ehPapelNaoPrincipal(candidate.kind) ||
      (
        Boolean(candidate.compatibilityRelation) &&
        candidate.role !== "MAIN"
      )
    )
  ) {
    conflicts.push(
      `soldItem:${candidate.soldItemType ?? candidate.role}!=MAIN`,
    );
  }

  if (!roleCompatible) {
    conflicts.push(
      queryIdentity.kind === "GENERIC" || queryIdentity.role === "MAIN"
        ? `papel:${queryIdentity.role}!=${candidate.role}`
        : `papel:${queryIdentity.kind}!=${candidate.kind}`,
    );
  }

  if (
    !ehPapelNaoPrincipal(queryIdentity.kind) &&
    (
      candidate.multiModelCompatibility ||
      (
        candidate.hostModelCandidates.length > 0 &&
        candidate.identityModelCandidates.length === 0
      )
    )
  ) {
    conflicts.push("identidade:lista-de-compatibilidade");
  }

  if (classCompatibility === "CONFLICT") {
    conflicts.push(
      `productClass:${queryClass}!=${candidateClass}`,
    );
  }

  if (brandCompatibility === "CONFLICT") {
    conflicts.push(
      `brand:${queryBrand}!=${candidate.brand ?? "title-host"}`,
    );
  }

  conflicts.push(...attributes.conflicts);

  if (queryCodes.length > 0 && !modelMatched) {
    conflicts.push(
      `model:${codigosMaisEspecificos(queryCodes).join(",")}`,
    );
  }

  if (conflicts.length > 0) {
    return reject(
      `Conflito de identidade com a consulta: ${conflicts.join(", ")}.`,
      conflicts,
      gateExtras,
    );
  }

  const brandConfirmed = brandCompatibility === "MATCH";
  const classConfirmed = classCompatibility === "MATCH";

  const rankingScore = Math.min(
    0.99,
    queryCoverage * 0.55 +
      lexicalScore * 0.2 +
      identityEvidenceScore * 0.2 +
      attributes.coverage * 0.15 +
      (brandConfirmed && classConfirmed ? 0.08 : 0),
  );

  function accepted(
    reason: string,
    matchedBy: QueryMatchResult["matchedBy"],
    autoAcceptanceReason: string,
    score: number,
    relevance: number,
  ): QueryMatchResult {
    return {
      compatible: true,
      status: "ACCEPTED",
      score,
      textRelevance: relevance,
      roleCompatible: true,
      roleBoost: 1,
      finalRelevance: relevance,
      reason,
      matchedBy,
      conflicts: [],
      hardConflicts: [],
      positiveEvidence,
      ...evidence,
      autoAcceptanceReason,
    };
  }

  if (modelMatched) {
    return accepted(
      "Modelo forte da consulta e variantes explicitas compativeis.",
      "MODEL",
      "modelo-forte-compativel",
      1,
      1,
    );
  }

  if (queryTokens.length === 0) {
    return reject(
      "Consulta sem tokens fortes; evidencia insuficiente para aceitar o candidato.",
      [],
      {
        ...gateExtras,
        status: "INSUFFICIENT",
        autoAcceptanceReason: "consulta-generica",
      },
    );
  }

  if (
    distinctiveTokens.length > 0 &&
    missingDistinctive.length === distinctiveTokens.length &&
    brandCompatibility !== "MATCH"
  ) {
    return reject(
      `Nenhum termo distintivo da consulta aparece no candidato: ${missingDistinctive.join(", ")}.`,
      [`distinctive:${missingDistinctive.join(",")}`],
      gateExtras,
    );
  }

  /*
   * FASE B — ranking so depois dos hard gates. Marca/token distintivo
   * sozinho nunca vira ACCEPT. Classe precisa casar.
   */
  if (!classConfirmed) {
    return reject(
      "Evidencia insuficiente: classe da consulta nao confirmada no candidato.",
      [],
      {
        ...gateExtras,
        status: "INSUFFICIENT",
        autoAcceptanceReason: "classe-nao-confirmada",
      },
    );
  }

  const minimum =
    queryTokens.length <= 2 && distinctiveTokens.length === 0
      ? 1
      : brandConfirmed
        ? 0.42
        : 0.55;

  if (queryCoverage < minimum) {
    return reject(
      `Cobertura lexical insuficiente: ${matchedTokens.length}/${queryTokens.length}.`,
      [],
      {
        ...gateExtras,
        status: "INSUFFICIENT",
        autoAcceptanceReason: "cobertura-insuficiente",
      },
    );
  }

  return accepted(
    brandConfirmed
      ? attributes.missing.length > 0
        ? "Classe e marca compativeis; atributos pedidos parcialmente ausentes."
        : "Classe, marca e atributos da consulta compativeis."
      : "Classe da consulta compativel sem marca exigida.",
    brandConfirmed ? "BRAND" : "LEXICAL",
    brandConfirmed
      ? attributes.missing.length > 0
        ? "classe-marca-compativeis-atributos-parciais"
        : "classe-marca-atributos-compativeis"
      : "classe-compativel-consulta-sem-marca",
    rankingScore,
    textRelevance,
  );
}

export function avaliarCompatibilidadeComConsulta(
  query: string,
  candidateInput: QueryIdentityInput,
): QueryMatchResult {
  const queryIdentity = resolverIdentidadeProduto({
    title: query,
    brand: null,
    attributes: {},
  });
  const candidate = resolverIdentidadeProduto(candidateInput);

  return matchQueryToCandidate(queryIdentity, candidate);
}

export function pontuarEspecificidadeDaConsulta(
  query: string,
  candidateInput: QueryIdentityInput,
): number {
  const queryIdentity = resolverIdentidadeProduto({
    title: query,
    brand: null,
    attributes: {},
  });
  const candidate = resolverIdentidadeProduto(candidateInput);
  const queryCodes = codigosMaisEspecificos(
    extrairCodigosFortesDaConsulta(query, queryIdentity),
  );
  const candidateCodes = new Set(
    [
      candidate.commercialModel,
      candidate.model,
      ...candidate.identityModelCandidates,
    ]
      .filter((value): value is string => Boolean(value))
      .map(normalizeCode)
      .filter(Boolean),
  );

  return queryCodes.reduce((total, code) => {
    const normalized = normalizeCode(code);

    if (!normalized || !candidateCodes.has(normalized)) {
      return total;
    }

    return total + normalized.length;
  }, 0);
}

export function criarConsultasGlobaisDeIdentidade(
  query: string,
): string[] {
  const original = query.replace(/\s+/g, " ").trim();

  if (!original) {
    return [];
  }

  const identity = resolverIdentidadeProduto({
    title: original,
    brand: null,
    attributes: {},
  });

  const strongCodes = extrairCodigosFortesDaConsulta(
    original,
    identity,
  );
  const originalSpecificToken = (
    canonizarHifensModelo(original).match(
      /[A-Za-z0-9]+(?:[-+][A-Za-z0-9]+)*/g,
    ) ?? []
  )
    .map((token) => ({
      token,
      code: normalizeCode(token),
    }))
    .filter(
      ({ code }) =>
        Boolean(code) &&
        strongCodes.includes(code) &&
        !isTechnicalCode(code),
    )
    .sort((first, second) => second.code.length - first.code.length)[0]
    ?.token ?? null;
  const gtin = extrairGtinDaConsulta(original);
  const variants = [
    identity.variants.storage,
    identity.variants.ram,
    identity.variants.network,
    identity.variants.voltage,
    identity.variants.size,
    identity.variants.capacity,
    identity.variants.condition,
    identity.variants.bundle,
  ].filter((value): value is string => Boolean(value));

  const skuQuery = [identity.brand, originalSpecificToken]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .trim();

  const compact = [
    identity.brand,
    originalSpecificToken,
    ...variants,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .trim();

  const withoutCommercialNoise = tokensRelevantes(original)
    .filter(
      (token) =>
        !GENERIC_PRODUCT_WORDS.has(token) &&
        !ehTokenDeClasse(token) &&
        !ehTokenDeAtributoGenerico(token),
    )
    .join(" ")
    .trim();

  const distinctive = tokensDistintivosDaConsulta(original);
  const classTokens = tokensRelevantes(original).filter(ehTokenDeClasse);
  const salientAttributes = tokensRelevantes(original).filter((token) =>
    GENERIC_COLOR_WORDS.has(token),
  );
  const categoryAndDistinctive = [
    ...classTokens.slice(0, 2),
    ...distinctive,
    ...salientAttributes.slice(0, 1),
  ]
    .join(" ")
    .trim();
  const distinctiveAndAttributes = [
    ...distinctive,
    ...salientAttributes.slice(0, 1),
  ]
    .join(" ")
    .trim();
  const distinctiveOnly = distinctive.join(" ").trim();

  return Array.from(
    new Set(
      [
        original,
        gtin,
        skuQuery,
        compact,
        categoryAndDistinctive,
        distinctiveAndAttributes,
        withoutCommercialNoise,
        distinctiveOnly,
      ]
        .map((value) => (value ?? "").trim())
        .filter((value) => value.length >= 2),
    ),
  ).slice(0, 6);
}
