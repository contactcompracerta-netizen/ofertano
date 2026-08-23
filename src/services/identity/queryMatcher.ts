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

export type QueryIdentityInput = Pick<
  ProductImport,
  "title" | "brand" | "attributes"
>;

export type QueryMatchResult = {
  compatible: boolean;
  score: number;
  textRelevance: number;
  roleCompatible: boolean;
  reason: string;
  matchedBy:
    | "MODEL"
    | "BRAND"
    | "LEXICAL"
    | "GENERIC"
    | null;
  conflicts: string[];
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

function reject(
  reason: string,
  conflicts: string[],
  extras: {
    textRelevance?: number;
    roleCompatible?: boolean;
  } = {},
): QueryMatchResult {
  return {
    compatible: false,
    score: 0,
    textRelevance: extras.textRelevance ?? 0,
    roleCompatible: extras.roleCompatible ?? true,
    reason,
    matchedBy: null,
    conflicts,
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
): boolean {
  return sinonimosDeToken(token).some((item) =>
    candidateTokens.has(item),
  );
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
  matchedTokens: string[];
  queryTokens: string[];
  missingDistinctive: string[];
} {
  const queryTokens = tokensRelevantes(query);
  const candidateTokens = new Set(tokensRelevantes(candidateTitle));
  const matchedTokens = queryTokens.filter((token) =>
    candidatoPossuiToken(token, candidateTokens),
  );
  const missingDistinctive = tokensDistintivosDaConsulta(query).filter(
    (token) => !candidatoPossuiToken(token, candidateTokens),
  );

  if (queryTokens.length === 0) {
    return {
      score: 0.5,
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

  return {
    score: totalWeight === 0 ? 0 : matchedWeight / totalWeight,
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

  if (missing.length > 0) {
    return {
      keep: false,
      reason: `Termo distintivo ausente no Discovery: ${missing.join(", ")}.`,
    };
  }

  return {
    keep: true,
    reason: "Termos distintivos da consulta presentes no titulo.",
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
  const textRelevance = modelMatched
    ? 1
    : Math.min(1, lexicalScore);
  const distinctiveTokens = tokensDistintivosDaConsulta(query);
  const missingDistinctive = lexical.missingDistinctive;
  const candidateDistinctive = tokensRelevantes(candidate.title)
    .filter(ehTokenDistintivo)
    .filter((token) => !distinctiveTokens.includes(token));

  const roleCompatible =
    ehPapelNaoPrincipal(queryIdentity.kind) ===
      ehPapelNaoPrincipal(candidate.kind) &&
    (
      !ehPapelNaoPrincipal(queryIdentity.kind) ||
      queryIdentity.kind === candidate.kind
    );

  const conflicts: string[] = [];

  if (!roleCompatible) {
    conflicts.push(
      queryIdentity.kind === "GENERIC" || queryIdentity.role === "MAIN"
        ? `classe:${queryIdentity.role}!=${candidate.role}`
        : `classe:${queryIdentity.kind}!=${candidate.kind}`,
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

  if (
    queryIdentity.brand &&
    candidate.brand &&
    queryIdentity.brand !== candidate.brand
  ) {
    conflicts.push(
      `brand:${queryIdentity.brand}!=${candidate.brand}`,
    );
  }

  const queryClassGroups = gruposDeClasse(queryTokens);
  const candidateClassGroups = gruposDeClasse(
    tokensRelevantes(candidate.title),
  );

  if (
    queryClassGroups.size > 0 &&
    candidateClassGroups.size > 0 &&
    ![...queryClassGroups].some((group) => candidateClassGroups.has(group))
  ) {
    conflicts.push(
      `classe:${[...queryClassGroups][0]}!=${[...candidateClassGroups][0]}`,
    );
  }

  conflicts.push(
    ...verificarVariantesExplicitas(
      queryIdentity,
      candidate,
    ),
  );

  if (conflicts.length > 0) {
    return reject(
      `Conflito de identidade com a consulta: ${conflicts.join(", ")}.`,
      conflicts,
      {
        textRelevance,
        roleCompatible,
      },
    );
  }

  if (queryCodes.length > 0) {
    if (!modeloCoincide(queryCodes, candidate, queryIdentity)) {
      return reject(
        `Modelo solicitado nao encontrado no candidato: ${codigosMaisEspecificos(queryCodes).join(", ")}.`,
        ["model"],
        {
          textRelevance,
          roleCompatible: true,
        },
      );
    }

    return {
      compatible: true,
      score: 1,
      textRelevance: 1,
      roleCompatible: true,
      reason: "Modelo forte da consulta e variantes explicitas compativeis.",
      matchedBy: "MODEL",
      conflicts: [],
    };
  }

  if (queryTokens.length === 0) {
    return {
      compatible: true,
      score: 0.5,
      textRelevance: 0.5,
      roleCompatible: true,
      reason: "Consulta sem tokens fortes; candidato sem conflito estrutural.",
      matchedBy: "GENERIC",
      conflicts: [],
    };
  }

  const brandRequested = Boolean(queryIdentity.brand);
  const brandConfirmed = Boolean(
    queryIdentity.brand &&
    candidate.brand === queryIdentity.brand,
  );
  const distinctiveConfirmed =
    distinctiveTokens.length > 0 &&
    missingDistinctive.length === 0;

  if (distinctiveTokens.length > 0 && missingDistinctive.length > 0) {
    const entityConflict =
      candidateDistinctive.length > 0
        ? `brand:${missingDistinctive[0]}!=${candidateDistinctive[0]}`
        : `distinctive:${missingDistinctive.join(",")}`;

    return reject(
      `Termo distintivo da consulta ausente no candidato: ${missingDistinctive.join(", ")}.`,
      [entityConflict],
      {
        textRelevance,
        roleCompatible: true,
      },
    );
  }

  const minimum =
    queryTokens.length <= 2 && distinctiveTokens.length === 0
      ? 1
      : distinctiveConfirmed
        ? 0.35
        : brandRequested && brandConfirmed
          ? 0.5
          : 0.65;

  if (lexicalScore < minimum) {
    return reject(
      `Cobertura lexical insuficiente: ${matchedTokens.length}/${queryTokens.length}.`,
      ["lexical"],
      {
        textRelevance,
        roleCompatible: true,
      },
    );
  }

  return {
    compatible: true,
    score: Math.min(
      0.99,
      lexicalScore +
        (brandConfirmed ? 0.12 : 0) +
        (distinctiveConfirmed ? 0.08 : 0),
    ),
    textRelevance,
    roleCompatible: true,
    reason: brandConfirmed
      ? "Marca e termos relevantes da consulta compativeis."
      : distinctiveConfirmed
        ? "Entidade distintiva e termos relevantes da consulta compativeis."
        : "Termos relevantes da consulta compativeis.",
    matchedBy: brandConfirmed ? "BRAND" : "LEXICAL",
    conflicts: [],
  };
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
