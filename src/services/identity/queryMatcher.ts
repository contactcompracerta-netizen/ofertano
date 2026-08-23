import type {
  ProductImport,
} from "@/services/importers/core/types";

import {
  canonizarHifensModelo,
  ehCodigoSkuEspecifico,
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

function reject(
  reason: string,
  conflicts: string[],
): QueryMatchResult {
  return {
    compatible: false,
    score: 0,
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
      technicalContexts.has(first)
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

function modeloCoincide(
  queryCodes: string[],
  candidate: ProductIdentity,
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
   * O titulo descreve o SKU que esta realmente anunciado. Alguns feeds
   * carregam MODEL/MODEL_NUMBER herdado de catalogo ou de outra variacao.
   * Se o titulo possui codigo de modelo forte, ele tem prioridade absoluta
   * para validar a consulta. Os atributos estruturados ficam como fallback
   * somente quando o titulo nao traz nenhum codigo confiavel.
   *
   * Isso e uma regra global: evita aceitar qualquer modelo X porque um
   * atributo estruturado diz X enquanto o titulo anuncia claramente Y.
   */
  const titleCodes = selecionarCodigosModeloMaisEspecificos(
    extrairCodigosFortesDaConsulta(
      candidate.title,
      candidate,
    ),
  );

  const candidateCodes = new Set(
    (titleCodes.length > 0
      ? titleCodes
      : candidate.searchCodes
    ).map(normalizeCode),
  );

  const allCandidateCodes = new Set(
    [
      ...titleCodes,
      ...candidate.searchCodes,
      ...extrairCodigosFortesDaConsulta(candidate.title, candidate),
    ]
      .map(normalizeCode)
      .filter(Boolean),
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

  /*
   * Condicao especial e bundle sao assimetricos: um cliente que pede o
   * produto normal nao deve receber Outlet/usado/recondicionado nem um
   * combo com outro produto apenas porque marca/modelo coincidem. Se o
   * proprio cliente pediu essa configuracao, a regra acima exige igualdade.
   */
  if (!query.variants.condition && candidate.variants.condition) {
    conflicts.push(
      `condition:padrao!=${candidate.variants.condition}`,
    );
  }

  if (!query.variants.bundle && candidate.variants.bundle) {
    conflicts.push(
      `bundle:sem-bundle!=${candidate.variants.bundle}`,
    );
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
  const conflicts: string[] = [];

  if (
    queryIdentity.kind === "ACCESSORY" &&
    candidate.kind !== "ACCESSORY"
  ) {
    conflicts.push("classe:acessorio!=produto-principal");
  }

  if (
    queryIdentity.kind !== "ACCESSORY" &&
    candidate.kind === "ACCESSORY"
  ) {
    conflicts.push("classe:produto-principal!=acessorio");
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
    );
  }

  const queryCodes = extrairCodigosFortesDaConsulta(
    query,
    queryIdentity,
  );

  if (queryCodes.length > 0) {
    if (!modeloCoincide(queryCodes, candidate)) {
      return reject(
        `Modelo solicitado nao encontrado no candidato: ${codigosMaisEspecificos(queryCodes).join(", ")}.`,
        ["model"],
      );
    }

    return {
      compatible: true,
      score: 1,
      reason: "Modelo forte da consulta e variantes explicitas compativeis.",
      matchedBy: "MODEL",
      conflicts: [],
    };
  }

  const queryTokens = tokensRelevantes(query);
  const candidateTokens = new Set(
    tokensRelevantes(candidate.title),
  );

  if (queryTokens.length === 0) {
    return {
      compatible: true,
      score: 0.5,
      reason: "Consulta sem tokens fortes; candidato sem conflito estrutural.",
      matchedBy: "GENERIC",
      conflicts: [],
    };
  }

  const matched = queryTokens.filter((token) =>
    candidateTokens.has(token),
  );
  const lexicalScore = matched.length / queryTokens.length;

  const brandRequested = Boolean(queryIdentity.brand);
  const brandConfirmed = Boolean(
    queryIdentity.brand &&
    candidate.brand === queryIdentity.brand,
  );

  const minimum =
    queryTokens.length <= 2
      ? 1
      : brandRequested && brandConfirmed
        ? 0.5
        : 0.65;

  if (lexicalScore < minimum) {
    return reject(
      `Cobertura lexical insuficiente: ${matched.length}/${queryTokens.length}.`,
      ["lexical"],
    );
  }

  return {
    compatible: true,
    score: Math.min(
      0.99,
      lexicalScore + (brandConfirmed ? 0.1 : 0),
    ),
    reason: brandConfirmed
      ? "Marca e termos relevantes da consulta compativeis."
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
      ...candidate.searchCodes,
      ...extrairCodigosFortesDaConsulta(candidate.title, candidate),
    ]
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
    .filter((token) => !GENERIC_PRODUCT_WORDS.has(token))
    .join(" ")
    .trim();

  return Array.from(
    new Set(
      [
        original,
        gtin,
        skuQuery,
        compact,
        withoutCommercialNoise,
      ]
        .map((value) => (value ?? "").trim())
        .filter((value) => value.length >= 2),
    ),
  ).slice(0, 4);
}
