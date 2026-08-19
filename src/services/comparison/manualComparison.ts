import prisma from "@/lib/prisma";
import { mercadoLivreFetch } from "@/lib/mercadolivre";

import {
  saveProduct,
  sincronizarMelhorOfertaDoProduto,
} from "@/services/database/saveProduct";
import type {
  MarketplaceName,
  ProductImport,
} from "@/services/importers/core/types";

const MARKETPLACES: MarketplaceName[] = [
  "Mercado Livre",
  "Amazon",
  "Shopee",
  "Magazine Luiza",
  "AliExpress",
];

const MAX_MERCADO_LIVRE_CANDIDATES = 8;

type MercadoLivreSearchResult = {
  id?: string;
  name?: string;
  domain_id?: string;
};

type MercadoLivreSearchResponse = {
  keywords?: string;
  product_identifier?: string;
  domain_id?: string;

  paging?: {
    total?: number;
    offset?: number;
    limit?: number;
  };

  results?: MercadoLivreSearchResult[];
};

type MercadoLivreDomainAttribute = {
  id?: string;
  value_id?: string | null;
  value_name?: string | null;
};

type MercadoLivreDomainPrediction = {
  domain_id?: string;
  domain_name?: string;
  category_id?: string;
  category_name?: string;
  attributes?: MercadoLivreDomainAttribute[];
};

export type ManualComparisonSummary = {
  query: string;

  searchedMarketplaces: string[];
  pendingMarketplaces: string[];

  scanned: number;
  importedCandidates: number;
  rejectedCandidates: number;

  found: number;

  offers: Array<{
    marketplace: MarketplaceName;
    externalId: string;
    productId: string;
    name: string;
    price: number;
    affiliateLink: string | null;
    reason: string;
  }>;

  rejections: Array<{
    marketplace: MarketplaceName;
    catalogId: string;
    name: string;
    reason: string;
  }>;

  errors: string[];
};

type ProductIdentity = {
  brand: string | null;
  gtin: string | null;
  model: string | null;
  modelTokens: string[];

  variants: {
    voltage: string | null;
    storage: string | null;
    ram: string | null;
    network: string | null;
    color: string | null;
    size: string | null;
  };
};

type MatchResult = {
  exact: boolean;
  reason: string;
};

type CapacityCandidate = {
  value: string;
  megabytes: number;
  index: number;
};

const BRAND_ALIASES: Array<{
  canonical: string;
  aliases: string[];
}> = [
  { canonical: "samsung", aliases: ["samsung"] },
  { canonical: "apple", aliases: ["apple"] },
  { canonical: "motorola", aliases: ["motorola"] },
  { canonical: "xiaomi", aliases: ["xiaomi", "redmi", "poco"] },
  { canonical: "realme", aliases: ["realme"] },
  { canonical: "jbl", aliases: ["jbl"] },
  { canonical: "kingston", aliases: ["kingston"] },
  { canonical: "acer", aliases: ["acer"] },
  { canonical: "lenovo", aliases: ["lenovo"] },
  { canonical: "asus", aliases: ["asus"] },
  { canonical: "dell", aliases: ["dell"] },
  { canonical: "hp", aliases: ["hp"] },
  { canonical: "notavel", aliases: ["notavel", "notÃƒÂ¡vel"] },
  { canonical: "aramoveis", aliases: ["aramoveis", "aramÃƒÂ³veis"] },
  { canonical: "lg", aliases: ["lg"] },
  { canonical: "sony", aliases: ["sony"] },
  { canonical: "philips", aliases: ["philips"] },
  { canonical: "mondial", aliases: ["mondial"] },
  { canonical: "electrolux", aliases: ["electrolux"] },
  { canonical: "brastemp", aliases: ["brastemp"] },
  { canonical: "consul", aliases: ["consul"] },
  { canonical: "midea", aliases: ["midea"] },
  { canonical: "intelbras", aliases: ["intelbras"] },
  { canonical: "logitech", aliases: ["logitech"] },
  { canonical: "hyperx", aliases: ["hyperx"] },
  { canonical: "corsair", aliases: ["corsair"] },
  { canonical: "seagate", aliases: ["seagate"] },
  { canonical: "sandisk", aliases: ["sandisk"] },
  {
    canonical: "western digital",
    aliases: ["western digital", "wd"],
  },
];

const CORES_CONHECIDAS = [
  "preto",
  "preta",
  "branco",
  "branca",
  "azul marinho",
  "azul",
  "verde",
  "vermelho",
  "vermelha",
  "rosa",
  "dourado",
  "dourada",
  "prata",
  "prateado",
  "prateada",
  "cinza",
  "grafite",
  "bege",
  "roxo",
  "roxa",
  "lilas",
] as const;

function normalizarTexto(
  value: string | null | undefined,
): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizarChave(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizarCodigo(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .trim();

  return normalized || null;
}

function normalizarValorVariante(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const normalized = normalizarTexto(value)
    .replace(
      /(\d)\s+(gb|tb|mb|mah|w|v|hz)\b/g,
      "$1$2",
    )
    .trim();

  return normalized || null;
}

function inferirTamanhoGenericoPeloTitulo(
  title: string,
): string | null {
  const texto = normalizarTexto(title);

  const tamanhoExplicito = texto.match(
    /\b(?:tamanho|tam)\s*(rn|xpp|pp|p|m|g|gg|xg|xgg|xxg|xxxg)\b/i,
  );

  if (tamanhoExplicito?.[1]) {
    return tamanhoExplicito[1].toLowerCase();
  }

  /*
   * Tamanhos mais especÃƒÂ­ficos podem ser inferidos sem o prefixo
   * "tamanho". Isso cobre, por exemplo, fraldas XGG.
   * P/M/G isolados continuam exigindo contexto explÃƒÂ­cito para
   * evitar falsos positivos com cÃƒÂ³digos genÃƒÂ©ricos.
   */
  const tamanhoForte = texto.match(
    /\b(rn|xpp|pp|gg|xg|xgg|xxg|xxxg)\b/i,
  );

  return tamanhoForte?.[1]?.toLowerCase() ?? null;
}

function normalizarMarcadorPacote(
  value: string,
): string {
  const mapa: Record<string, string> = {
    unitario: "unitario",
    unitaria: "unitario",
    duplo: "duplo",
    dupla: "duplo",
    triplo: "triplo",
    tripla: "triplo",
    quadruplo: "quadruplo",
    quadrupla: "quadruplo",
    quintuplo: "quintuplo",
    quintupla: "quintuplo",
    sextuplo: "sextuplo",
    sextupla: "sextuplo",
  };

  return mapa[value] ?? value;
}

function extrairAssinaturaPacote(
  title: string,
): string[] {
  const texto = normalizarTexto(title);
  const encontrados: string[] = [];

  const palavras = [
    "unitario",
    "unitaria",
    "duplo",
    "dupla",
    "triplo",
    "tripla",
    "quadruplo",
    "quadrupla",
    "quintuplo",
    "quintupla",
    "sextuplo",
    "sextupla",
  ];

  for (const palavra of palavras) {
    const pattern = new RegExp(`\\b${palavra}\\b`, "i");

    if (pattern.test(texto)) {
      encontrados.push(
        normalizarMarcadorPacote(palavra),
      );
    }
  }

  const padroes = [
    /\bkit\s+(\d{1,4})\b/gi,
    /\b(\d{1,4})\s*(?:unidades?|unid\.?|unds?|un)\b/gi,
  ];

  for (const pattern of padroes) {
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(texto)) !== null) {
      if (match[1]) {
        encontrados.push(`qtd:${Number(match[1])}`);
      }
    }
  }

  return Array.from(new Set(encontrados)).sort();
}

function titulosComerciaisEquivalentes(
  original: ProductImport,
  candidate: ProductImport,
  a: ProductIdentity,
  b: ProductIdentity,
): MatchResult | null {
  const tituloA = normalizarTexto(original.title);
  const tituloB = normalizarTexto(candidate.title);

  if (!tituloA || !tituloB) {
    return null;
  }

  if (a.brand && b.brand && a.brand !== b.brand) {
    return null;
  }

  const variantesCriticas = [
    "color",
    "storage",
    "voltage",
    "size",
  ] as const;

  for (const chave of variantesCriticas) {
    const valorA = a.variants[chave];
    const valorB = b.variants[chave];

    if (valorA && valorB && valorA !== valorB) {
      return {
        exact: false,
        reason: `Variante ${chave} diferente: ${valorA} x ${valorB}.`,
      };
    }

    if (Boolean(valorA) !== Boolean(valorB)) {
      return null;
    }
  }

  const tokensA = tituloA.split(" ").filter(Boolean);
  const tokensB = tituloB.split(" ").filter(Boolean);
  const menor = tituloA.length <= tituloB.length ? tituloA : tituloB;
  const maior = tituloA.length > tituloB.length ? tituloA : tituloB;
  const menorTokens = Math.min(tokensA.length, tokensB.length);
  const proporcao = menor.length / maior.length;

  /*
   * EvidÃƒÂªncia forte, mas conservadora, para produtos sem MODEL/MPN
   * confiÃƒÂ¡vel: o tÃƒÂ­tulo completo ÃƒÂ© idÃƒÂªntico ou um tÃƒÂ­tulo inteiro
   * estÃƒÂ¡ contido no outro com pequena extensÃƒÂ£o (geralmente marca).
   * NÃƒÂ£o aceitamos apenas similaridade ou reordenaÃƒÂ§ÃƒÂ£o de palavras.
   */
  const tituloForte =
    tituloA === tituloB ||
    (
      menorTokens >= 5 &&
      proporcao >= 0.72 &&
      maior.includes(menor)
    );

  if (!tituloForte) {
    return null;
  }

  const pacoteA = extrairAssinaturaPacote(original.title);
  const pacoteB = extrairAssinaturaPacote(candidate.title);

  if (
    pacoteA.length > 0 &&
    pacoteB.length > 0 &&
    pacoteA.join("|") !== pacoteB.join("|")
  ) {
    return {
      exact: false,
      reason:
        `Quantidade/pacote diferente: ${pacoteA.join(", ")} x ${pacoteB.join(", ")}.`,
    };
  }

  return {
    exact: true,
    reason:
      tituloA === tituloB
        ? "TÃƒÂ­tulo comercial normalizado idÃƒÂªntico e variantes crÃƒÂ­ticas compatÃƒÂ­veis."
        : "TÃƒÂ­tulo comercial completo equivalente por contenÃƒÂ§ÃƒÂ£o e variantes crÃƒÂ­ticas compatÃƒÂ­veis.",
  };
}

function buscarAtributo(
  product: ProductImport,
  aliases: readonly string[],
): string | null {
  const normalizedAliases = aliases.map(normalizarChave);

  for (const [rawKey, rawValue] of Object.entries(product.attributes ?? {})) {
    const key = normalizarChave(rawKey);

    const matched = normalizedAliases.some(
      (alias) => key === alias || key.endsWith(`_${alias}`),
    );

    if (
      matched &&
      typeof rawValue === "string" &&
      rawValue.trim()
    ) {
      return rawValue.trim();
    }
  }

  return null;
}

function normalizarMarca(
  value: string | null | undefined,
): string | null {
  const normalized = normalizarTexto(value);

  if (!normalized) {
    return null;
  }

  /*
   * Marketplaces podem retornar valores genÃƒÂ©ricos
   * no campo de marca. Esses valores nÃƒÂ£o devem
   * participar da identidade do produto.
   */
  const marcasInvalidas = new Set([
    "generico",
    "generica",
    "generic",
    "sem marca",
    "nao definido",
    "nao definida",
    "nao informado",
    "nao informada",
    "unknown",
    "not defined",
    "unbranded",
  ]);

  if (marcasInvalidas.has(normalized)) {
    return null;
  }

  const padded = ` ${normalized} `;

  for (const brand of BRAND_ALIASES) {
    for (const alias of brand.aliases) {
      const aliasNormalizado = normalizarTexto(alias);

      if (padded.includes(` ${aliasNormalizado} `)) {
        return brand.canonical;
      }
    }
  }

  return normalized;
}

function inferirMarcaPeloTitulo(
  title: string,
): string | null {
  const normalized = normalizarTexto(title);

  if (!normalized) {
    return null;
  }

  /*
   * Marketplaces podem retornar valores genÃƒÂ©ricos
   * no campo de marca. Esses valores nÃƒÂ£o devem
   * participar da identidade do produto.
   */
  const marcasInvalidas = new Set([
    "generico",
    "generica",
    "generic",
    "sem marca",
    "nao definido",
    "nao definida",
    "nao informado",
    "nao informada",
    "unknown",
    "not defined",
    "unbranded",
  ]);

  if (marcasInvalidas.has(normalized)) {
    return null;
  }

  const padded = ` ${normalized} `;

  for (const brand of BRAND_ALIASES) {
    for (const alias of brand.aliases) {
      const aliasNormalizado = normalizarTexto(alias);

      if (padded.includes(` ${aliasNormalizado} `)) {
        return brand.canonical;
      }
    }
  }

  return null;
}

function buscarMarcaEstruturada(
  product: ProductImport,
): string | null {
  return (
    product.brand?.trim() ||
    buscarAtributo(product, ["BRAND", "MARCA"])
  );
}

function buscarModeloEstruturado(
  product: ProductImport,
): string | null {
  return buscarAtributo(product, [
    "MODEL",
    "MODELO",
    "MODEL_NUMBER",
    "NUMERO_DO_MODELO",
    "MPN",
    "PART_NUMBER",
    "MANUFACTURER_PART_NUMBER",
  ]);
}

function extrairModeloDescritivoDoTitulo(
  title: string,
): string | null {
  const texto = normalizarTexto(title);

  const patterns = [
    /\bgalaxy\s+[a-z]\d{2,3}(?:\s+(?:fe|plus|ultra))?\b/i,
    /\biphone\s+\d{1,2}(?:\s+(?:pro max|pro|plus|max|e))?\b/i,
    /\bedge\s+\d{1,3}(?:\s+(?:pro|fusion|neo|ultra))?\b/i,
    /\bmoto\s+g\s*\d{1,3}\b/i,
    /\bredmi\s+note\s*\d{1,3}(?:\s+(?:pro plus|pro|plus))?\b/i,
    /\bpoco\s+[xmfc]\d{1,3}(?:\s+pro)?\b/i,
    /\bnitro\s+v?\s*\d{1,2}\b/i,
    /\btune\s+\d{3,4}[a-z]*\b/i,
  ];

  for (const pattern of patterns) {
    const match = texto.match(pattern);

    if (match?.[0]) {
      return match[0].trim();
    }
  }

  return null;
}

function ehTokenModeloUtil(rawToken: string): boolean {
  const token = normalizarCodigo(rawToken);

  if (!token) {
    return false;
  }

  if (token.length < 3 || token.length > 30) {
    return false;
  }

  if (!/[A-Z]/.test(token) || !/\d/.test(token)) {
    return false;
  }

  if (
    /^\d+(?:GB|TB|MB|KB|MP|MPX|MAH|W|V|HZ|KHZ|MHZ|GHZ|CM|MM)$/.test(
      token,
    )
  ) {
    return false;
  }

  if (/^(?:3G|4G|5G|6G)$/.test(token)) {
    return false;
  }

  if (/^(?:DDR|LPDDR)\d+[A-Z]*$/.test(token)) {
    return false;
  }

  if (/^WIFI\d*[A-Z]*$/.test(token)) {
    return false;
  }

  if (/^USB\d+[A-Z]*$/.test(token)) {
    return false;
  }

  if (/^HDMI\d+[A-Z]*$/.test(token)) {
    return false;
  }

  if (/^(?:FHD|UHD|QHD)\d*$/.test(token)) {
    return false;
  }

  return true;
}

function extrairTokensModeloTexto(value: string): string[] {
  const semAcentos = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  const rawTokens =
    semAcentos.match(/[A-Z0-9]+(?:-[A-Z0-9]+)*/g) ?? [];

  return Array.from(
    new Set(
      rawTokens
        .filter(ehTokenModeloUtil)
        .map((token) => normalizarCodigo(token))
        .filter((token): token is string => Boolean(token)),
    ),
  );
}

function extrairTokensModelo(
  product: ProductImport,
  modelStructured: string | null,
): string[] {
  const encontrados: string[] = [];

  const modeloDescritivo = extrairModeloDescritivoDoTitulo(
    product.title,
  );

  if (modeloDescritivo) {
    const codigo = normalizarCodigo(modeloDescritivo);

    if (codigo) {
      encontrados.push(codigo);
    }
  }

  encontrados.push(...extrairTokensModeloTexto(product.title));

  if (modelStructured) {
    const modeloCompleto = normalizarCodigo(modelStructured);

    if (modeloCompleto) {
      encontrados.push(modeloCompleto);
    }

    encontrados.push(...extrairTokensModeloTexto(modelStructured));
  }

  return Array.from(new Set(encontrados));
}

function normalizarCapacidade(
  rawNumber: string,
  rawUnit: string,
): {
  value: string;
  megabytes: number;
} | null {
  const numero = Number(rawNumber.replace(",", "."));

  if (!Number.isFinite(numero) || numero <= 0) {
    return null;
  }

  const unit = rawUnit.trim().toLowerCase();

  let multiplicador = 0;

  if (unit === "tb") {
    multiplicador = 1024 * 1024;
  } else if (unit === "gb") {
    multiplicador = 1024;
  } else if (unit === "mb") {
    multiplicador = 1;
  } else {
    return null;
  }

  const numeroFormatado = Number.isInteger(numero)
    ? String(numero)
    : String(numero).replace(".", ",");

  return {
    value: `${numeroFormatado}${unit}`,
    megabytes: numero * multiplicador,
  };
}

function extrairCapacidadesTitulo(
  title: string,
): CapacityCandidate[] {
  const texto = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const regex = /(\d+(?:[.,]\d+)?)\s*(tb|gb|mb)\b/gi;
  const encontrados: CapacityCandidate[] = [];

  let match: RegExpExecArray | null;

  while ((match = regex.exec(texto)) !== null) {
    if (!match[1] || !match[2]) {
      continue;
    }

    const capacidade = normalizarCapacidade(match[1], match[2]);

    if (!capacidade) {
      continue;
    }

    encontrados.push({
      value: capacidade.value,
      megabytes: capacidade.megabytes,
      index: match.index,
    });
  }

  return encontrados;
}

function inferirRamPeloTitulo(
  title: string,
): string | null {
  const texto = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const patterns = [
    /(\d+(?:[.,]\d+)?)\s*(gb|mb)\s*(?:de\s*)?(?:ram|memoria\s+ram)\b/i,
    /(?:ram|memoria\s+ram)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*(gb|mb)\b/i,
  ];

  for (const pattern of patterns) {
    const match = texto.match(pattern);

    if (!match?.[1] || !match?.[2]) {
      continue;
    }

    const capacidade = normalizarCapacidade(match[1], match[2]);

    if (capacidade) {
      return capacidade.value;
    }
  }

  return null;
}

function capacidadeEhRamNoTitulo(
  texto: string,
  candidate: CapacityCandidate,
): boolean {
  /*
   * Vinculamos RAM somente ÃƒÂ  capacidade que estÃƒÂ¡
   * imediatamente associada ÃƒÂ  palavra RAM.
   *
   * Exemplo:
   * "128GB 4GB RAM"
   *
   * 4GB ÃƒÂ© RAM. 128GB nÃƒÂ£o deve ser descartado sÃƒÂ³
   * porque a palavra RAM aparece alguns caracteres depois.
   */
  const depois = texto.slice(
    candidate.index,
    Math.min(texto.length, candidate.index + 48),
  );

  if (
    /^\d+(?:[.,]\d+)?\s*(?:gb|mb)\s*(?:de\s*)?(?:ram|memoria\s+ram)\b/i.test(
      depois,
    )
  ) {
    return true;
  }

  const antes = texto.slice(
    Math.max(0, candidate.index - 36),
    candidate.index,
  );

  return /(?:ram|memoria\s+ram)\s*(?:de\s*)?$/i.test(antes);
}

function inferirArmazenamentoPeloTitulo(
  title: string,
): string | null {
  const texto = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const candidatos = extrairCapacidadesTitulo(title);

  if (candidatos.length === 0) {
    return null;
  }

  const naoRam = candidatos.filter(
    (candidate) =>
      !capacidadeEhRamNoTitulo(
        texto,
        candidate,
      ),
  );

  if (naoRam.length === 0) {
    return null;
  }

  const armazenamentoExplicito = naoRam.find((candidate) => {
    const inicio = Math.max(0, candidate.index - 22);
    const fim = Math.min(texto.length, candidate.index + 28);
    const contexto = texto.slice(inicio, fim);

    return /\b(?:ssd|rom|armazenamento|memoria\s+interna|storage)\b/i.test(
      contexto,
    );
  });

  if (armazenamentoExplicito) {
    return armazenamentoExplicito.value;
  }

  const maior = [...naoRam].sort(
    (a, b) => b.megabytes - a.megabytes,
  )[0];

  if (!maior) {
    return null;
  }

  /*
   * Sem um rÃƒÂ³tulo explÃƒÂ­cito, sÃƒÂ³ tratamos como armazenamento
   * capacidades a partir de 64 GB. Isso reduz o risco de
   * interpretar RAM como armazenamento.
   */
  if (maior.megabytes < 64 * 1024) {
    return null;
  }

  return maior.value;
}

function inferirRedePeloTitulo(
  title: string,
): string | null {
  const texto = normalizarTexto(title);
  const match = texto.match(/\b(3g|4g|5g|6g)\b/i);

  return match?.[1]?.toLowerCase() ?? null;
}

function inferirVoltagemPeloTitulo(
  title: string,
): string | null {
  const texto = normalizarTexto(title);

  if (/\bbivolt\b/.test(texto)) {
    return "bivolt";
  }

  const match = texto.match(/\b(110|127|220)\s*v\b/i);

  return match?.[1] ? `${match[1]}v` : null;
}

function normalizarCorSimples(color: string): string {
  const normalized = normalizarTexto(color);

  const mapa: Record<string, string> = {
    preta: "preto",
    preto: "preto",
    branca: "branco",
    branco: "branco",
    vermelha: "vermelho",
    vermelho: "vermelho",
    dourada: "dourado",
    dourado: "dourado",
    prateada: "prata",
    prateado: "prata",
    prata: "prata",
    roxa: "roxo",
    roxo: "roxo",
    lilas: "lilas",
  };

  return mapa[normalized] ?? normalized;
}

function extrairCoresCanonicas(
  value: string,
): string[] {
  const texto = ` ${normalizarTexto(value)} `;

  const encontradas = Array.from(
    new Set(
      CORES_CONHECIDAS
        .filter((cor) =>
          texto.includes(
            ` ${normalizarTexto(cor)} `,
          ),
        )
        .map(normalizarCorSimples),
    ),
  );

  /*
   * Uma cor composta especÃƒÂ­fica deve substituir
   * sua cor base.
   *
   * Exemplo:
   * "Azul Marinho" tambÃƒÂ©m contÃƒÂ©m "Azul",
   * mas representa uma ÃƒÂºnica variante.
   */
  const especificas = encontradas.filter((cor) => {
    const tokensCor = normalizarTexto(cor)
      .split(" ")
      .filter(Boolean);

    return !encontradas.some((outra) => {
      if (outra === cor) {
        return false;
      }

      const tokensOutra = normalizarTexto(outra)
        .split(" ")
        .filter(Boolean);

      return (
        tokensOutra.length > tokensCor.length &&
        tokensCor.every((token) =>
          tokensOutra.includes(token),
        )
      );
    });
  });

  return especificas;
}

function normalizarCor(color: string): string {
  const encontradas =
    extrairCoresCanonicas(color);

  if (encontradas.length > 0) {
    /*
     * A ordem vem de CORES_CONHECIDAS, nÃƒÂ£o do texto.
     * Assim "Branco e Roxo", "Roxo/Branco" e
     * "Branco/Roxo" resultam na mesma variante.
     */
    return encontradas.join(" e ");
  }

  return normalizarTexto(color);
}

function inferirCorPeloTitulo(
  title: string,
): string | null {
  const encontradas =
    extrairCoresCanonicas(title);

  if (encontradas.length === 0) {
    return null;
  }

  /*
   * Cores compostas reais tambÃƒÂ©m sÃƒÂ£o uma variante
   * vÃƒÂ¡lida. Ex.: "Branco e Roxo".
   *
   * Isso mantÃƒÂ©m o matcher estrito: um candidato sem
   * cor continua retornando null e uma combinaÃƒÂ§ÃƒÂ£o
   * diferente continua produzindo valor diferente.
   */
  return encontradas.join(" e ");
}

function escolherCorProduto(
  colorStructured: string | null,
  title: string,
): string | null {
  const estruturada = colorStructured
    ? normalizarCor(colorStructured)
    : null;

  const peloTitulo =
    inferirCorPeloTitulo(title);

  if (!estruturada) {
    return peloTitulo;
  }

  if (!peloTitulo || estruturada === peloTitulo) {
    return estruturada;
  }

  /*
   * Quando o tÃƒÂ­tulo anuncia alternativas de variaÃƒÂ§ÃƒÂ£o,
   * a cor estruturada representa a variante selecionada.
   *
   * Exemplo real:
   * "Mouse Logitech M170 Preto ou Cinza"
   * com COLOR="PRETO" deve ser tratado como PRETO, e nÃƒÂ£o
   * como uma variante inexistente "preto e cinza".
   */
  const tituloNormalizado =
    normalizarTexto(title);

  if (
    tituloNormalizado.includes(" ou ") &&
    extrairCoresCanonicas(title).length > 1
  ) {
    return estruturada;
  }

  const tokensEstruturada = normalizarTexto(estruturada)
    .split(" ")
    .filter(Boolean);

  const tokensTitulo = normalizarTexto(peloTitulo)
    .split(" ")
    .filter(Boolean);

  /*
   * Alguns marketplaces enviam COLOR="Azul" enquanto o
   * prÃƒÂ³prio tÃƒÂ­tulo informa "Azul Marinho". Nesse caso,
   * mantemos a informaÃƒÂ§ÃƒÂ£o mais especÃƒÂ­fica do tÃƒÂ­tulo.
   *
   * Cores realmente divergentes continuam usando o valor
   * estruturado e serÃƒÂ£o barradas normalmente pelo matcher.
   */
  const tituloRefinaEstruturada =
    tokensTitulo.length > tokensEstruturada.length &&
    tokensEstruturada.every((token) =>
      tokensTitulo.includes(token),
    );

  return tituloRefinaEstruturada
    ? peloTitulo
    : estruturada;
}

function extrairIdentidade(
  product: ProductImport,
): ProductIdentity {
  const brandStructured = buscarMarcaEstruturada(product);
  const modelStructured = buscarModeloEstruturado(product);

  const brand =
    normalizarMarca(brandStructured) ??
    inferirMarcaPeloTitulo(product.title);

  const gtin = buscarAtributo(product, [
    "GTIN",
    "GTIN_8",
    "GTIN_12",
    "GTIN_13",
    "GTIN_14",
    "EAN",
    "UPC",
    "BARCODE",
    "CODIGO_EAN",
    "CODIGO_DE_BARRAS",
  ]);

  const voltageStructured = buscarAtributo(product, [
    "VOLTAGE",
    "VOLTAGEM",
    "TENSAO",
    "TENSAO_ELETRICA",
  ]);

  const storageStructured = buscarAtributo(product, [
    "INTERNAL_MEMORY",
    "MEMORIA_INTERNA",
    "STORAGE_CAPACITY",
    "CAPACIDADE_DE_ARMAZENAMENTO",
    "ARMAZENAMENTO",
  ]);

  const ramStructured = buscarAtributo(product, [
    "RAM",
    "MEMORIA_RAM",
  ]);

  const networkStructured = buscarAtributo(product, [
    "MOBILE_NETWORK",
    "NETWORK",
    "REDE_MOVEL",
    "TECNOLOGIA_DE_REDE",
  ]);

  const colorStructured = buscarAtributo(product, [
    "COLOR",
    "COR",
  ]);

  const sizeStructured = buscarAtributo(product, [
    "SIZE",
    "TAMANHO",
  ]);

  return {
    brand,
    gtin: normalizarCodigo(gtin),
    model: normalizarCodigo(modelStructured),
    modelTokens: extrairTokensModelo(product, modelStructured),

    variants: {
      voltage:
        normalizarValorVariante(voltageStructured) ??
        normalizarValorVariante(
          inferirVoltagemPeloTitulo(product.title),
        ),

      storage:
        normalizarValorVariante(storageStructured) ??
        normalizarValorVariante(
          inferirArmazenamentoPeloTitulo(product.title),
        ),

      ram:
        normalizarValorVariante(ramStructured) ??
        normalizarValorVariante(inferirRamPeloTitulo(product.title)),

      network:
        normalizarValorVariante(networkStructured) ??
        normalizarValorVariante(inferirRedePeloTitulo(product.title)),

      color: escolherCorProduto(
        colorStructured,
        product.title,
      ),

      size:
        normalizarValorVariante(sizeStructured) ??
        inferirTamanhoGenericoPeloTitulo(product.title),
    },
  };
}

function encontrarModeloEmComum(
  a: ProductIdentity,
  b: ProductIdentity,
): string | null {
  if (a.model && b.model) {
    return a.model === b.model ? a.model : null;
  }

  const tokensB = new Set(b.modelTokens);

  for (const token of a.modelTokens) {
    if (tokensB.has(token)) {
      return token;
    }
  }

  return null;
}

const TERMOS_MOVEIS = [
  "armario",
  "guarda roupa",
  "balcao",
  "buffet",
  "aparador",
  "comoda",
  "rack",
  "painel para tv",
  "estante",
  "mesa de cabeceira",
  "criado mudo",
  "sapateira",
  "gabinete de cozinha",
  "cozinha completa",
  "cozinha modulada",
  "cozinha compacta",
  "cozinha suspensa",
] as const;

const TOKENS_GENERICOS_MOVEL = new Set([
  "armario",
  "armarios",
  "cozinha",
  "completa",
  "completo",
  "compacta",
  "compacto",
  "modulada",
  "modulado",
  "suspensa",
  "suspenso",
  "aereo",
  "aerea",
  "balcao",
  "balcoes",
  "buffet",
  "aparador",
  "guarda",
  "roupa",
  "comoda",
  "rack",
  "painel",
  "estante",
  "mesa",
  "cabeceira",
  "criado",
  "mudo",
  "sapateira",
  "gabinete",
  "kit",
  "movel",
  "moveis",
  "mdf",
  "mdp",
  "porta",
  "portas",
  "gaveta",
  "gavetas",
  "com",
  "sem",
  "para",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "em",
  "e",
  "cm",
  "mm",
  "metro",
  "metros",
  "cor",
  "cores",

  /*
   * Acabamentos comuns nÃƒÂ£o identificam a linha/modelo.
   */
  "preto",
  "preta",
  "branco",
  "branca",
  "grafite",
  "cinamomo",
  "carvalho",
  "amendoa",
  "freijo",
  "nogueira",
  "nature",
  "off",
  "white",
  "bege",
  "marrom",
  "cinza",
  "verde",
  "azul",
  "rosa",
  "dourado",
  "dourada",
  "prata",
]);

function ehProdutoMovel(
  title: string,
): boolean {
  const texto =
    normalizarTexto(title);

  return TERMOS_MOVEIS.some(
    (termo) =>
      texto.includes(
        normalizarTexto(termo),
      ),
  );
}

function extrairContagemMovel(
  title: string,
  tipo: "porta" | "gaveta",
): number | null {
  const texto =
    normalizarTexto(title);

  const pattern =
    tipo === "porta"
      ? /\b(\d{1,2})\s*portas?\b/i
      : /\b(\d{1,2})\s*gavetas?\b/i;

  const match =
    texto.match(pattern);

  if (!match?.[1]) {
    return null;
  }

  const valor =
    Number(match[1]);

  return Number.isInteger(valor) &&
    valor > 0
    ? valor
    : null;
}

function extrairTokensFortesMovel(
  title: string,
  brand: string | null,
): string[] {
  const brandTokens =
    new Set(
      normalizarTexto(
        brand ?? "",
      )
        .split(" ")
        .filter(Boolean),
    );

  return Array.from(
    new Set(
      normalizarTexto(title)
        .split(" ")
        .filter(Boolean)
        .filter((token) => {
          if (
            brandTokens.has(token) ||
            TOKENS_GENERICOS_MOVEL.has(token)
          ) {
            return false;
          }

          /*
           * Numeros pequenos normalmente sÃƒÂ£o
           * quantidade de portas/gavetas.
           * CÃƒÂ³digos longos continuam vÃƒÂ¡lidos
           * como identificadores de modelo.
           */
          if (/^\d+$/.test(token)) {
            return token.length >= 5;
          }

          return token.length >= 3;
        }),
    ),
  );
}

function compararMovelEstritamente(
  original: ProductImport,
  candidate: ProductImport,
  a: ProductIdentity,
  b: ProductIdentity,
): MatchResult | null {
  if (!ehProdutoMovel(original.title)) {
    return null;
  }

  if (!ehProdutoMovel(candidate.title)) {
    return {
      exact: false,
      reason:
        "O candidato nÃƒÂ£o pertence ÃƒÂ  mesma famÃƒÂ­lia de mÃƒÂ³veis.",
    };
  }

  /*
   * A marca do produto original continua obrigatÃƒÂ³ria.
   * Caso a outra loja nÃƒÂ£o forneÃƒÂ§a brand estruturada,
   * aceitamos a marca somente se ela estiver escrita
   * explicitamente no tÃƒÂ­tulo.
   */
  if (!a.brand) {
    return {
      exact: false,
      reason:
        "Marca do mÃƒÂ³vel original insuficiente para confirmaÃƒÂ§ÃƒÂ£o automÃƒÂ¡tica.",
    };
  }

  const marcaOriginal =
    normalizarTexto(a.brand);

  if (
    b.brand &&
    normalizarTexto(b.brand) !==
      marcaOriginal
  ) {
    return {
      exact: false,
      reason:
        `Marca diferente: ${a.brand} x ${b.brand}.`,
    };
  }

  if (!b.brand) {
    const tituloCandidato =
      ` ${normalizarTexto(candidate.title)} `;

    if (
      !tituloCandidato.includes(
        ` ${marcaOriginal} `,
      )
    ) {
      return {
        exact: false,
        reason:
          `A marca ${a.brand} nÃƒÂ£o foi confirmada no candidato.`,
      };
    }
  }

  const portasOriginal =
    extrairContagemMovel(
      original.title,
      "porta",
    );

  const portasCandidato =
    extrairContagemMovel(
      candidate.title,
      "porta",
    );

  if (portasOriginal !== null) {
    if (portasCandidato === null) {
      return {
        exact: false,
        reason:
          `${portasOriginal} porta(s) no original, mas quantidade nÃƒÂ£o confirmada no candidato.`,
      };
    }

    if (
      portasOriginal !==
      portasCandidato
    ) {
      return {
        exact: false,
        reason:
          `Quantidade de portas diferente: ${portasOriginal} x ${portasCandidato}.`,
      };
    }
  }

  const gavetasOriginal =
    extrairContagemMovel(
      original.title,
      "gaveta",
    );

  const gavetasCandidato =
    extrairContagemMovel(
      candidate.title,
      "gaveta",
    );

  if (gavetasOriginal !== null) {
    if (gavetasCandidato === null) {
      return {
        exact: false,
        reason:
          `${gavetasOriginal} gaveta(s) no original, mas quantidade nÃƒÂ£o confirmada no candidato.`,
      };
    }

    if (
      gavetasOriginal !==
      gavetasCandidato
    ) {
      return {
        exact: false,
        reason:
          `Quantidade de gavetas diferente: ${gavetasOriginal} x ${gavetasCandidato}.`,
      };
    }
  }

  /*
   * Se ambas as lojas informarem cor,
   * cores diferentes continuam sendo variantes
   * distintas.
   */
  if (
    a.variants.color &&
    b.variants.color &&
    a.variants.color !==
      b.variants.color
  ) {
    return {
      exact: false,
      reason:
        `Cor diferente: ${a.variants.color} x ${b.variants.color}.`,
    };
  }

  const tokensOriginal =
    extrairTokensFortesMovel(
      original.title,
      a.brand,
    );

  const tokensCandidato =
    new Set(
      extrairTokensFortesMovel(
        candidate.title,
        b.brand ?? a.brand,
      ),
    );

  const tokensComuns =
    tokensOriginal.filter(
      (token) =>
        tokensCandidato.has(token),
    );

  /*
   * Para "Kit Mega", por exemplo, Mega vira
   * um identificador forte. Atenas, Nanda,
   * Luana etc. nÃƒÂ£o passam.
   */
  if (tokensOriginal.length === 0) {
    return {
      exact: false,
      reason:
        "Linha/modelo do mÃƒÂ³vel insuficiente para confirmaÃƒÂ§ÃƒÂ£o automÃƒÂ¡tica.",
    };
  }

  const minimoTokens =
    tokensOriginal.length >= 2
      ? 2
      : 1;

  if (
    tokensComuns.length <
    minimoTokens
  ) {
    return {
      exact: false,
      reason:
        `Linha/modelo do mÃƒÂ³vel nÃƒÂ£o coincide. ` +
        `Original: ${tokensOriginal.join(", ") || "nÃƒÂ£o identificado"}.`,
    };
  }

  const detalhes = [
    ...tokensComuns,
    portasOriginal !== null
      ? `${portasOriginal} portas`
      : null,
    gavetasOriginal !== null
      ? `${gavetasOriginal} gavetas`
      : null,
  ]
    .filter(
      (value): value is string =>
        Boolean(value),
    )
    .join(", ");

  return {
    exact: true,
    reason:
      `MÃƒÂ³vel confirmado por marca, linha/modelo e caracterÃƒÂ­sticas: ${detalhes}.`,
  };
}

const TERMOS_CALCADOS = [
  "tenis",
  "sapato",
  "sapatilha",
  "sandalia",
  "chinelo",
  "bota",
  "coturno",
  "mocassim",
  "sapatÃƒÂªnis",
  "sapatenis",
] as const;

const TOKENS_GENERICOS_CALCADO = new Set([
  "tenis",
  "sapato",
  "sapatos",
  "sapatilha",
  "sapatilhas",
  "sandalia",
  "sandalias",
  "chinelo",
  "chinelos",
  "bota",
  "botas",
  "coturno",
  "coturnos",
  "mocassim",
  "mocassins",
  "sapatenis",
  "calcado",
  "calcados",
  "feminino",
  "feminina",
  "masculino",
  "masculina",
  "unissex",
  "adulto",
  "adulta",
  "infantil",
  "juvenil",
  "original",
  "novo",
  "nova",
  "com",
  "sem",
  "para",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "em",
  "e",
  "cor",
  "cores",
  "branco",
  "branca",
  "preto",
  "preta",
  "azul",
  "marinho",
  "verde",
  "vermelho",
  "vermelha",
  "rosa",
  "roxo",
  "roxa",
  "lilas",
  "cinza",
  "grafite",
  "bege",
  "dourado",
  "dourada",
  "prata",
  "prateado",
  "prateada",
]);

function ehProdutoCalcado(
  title: string,
): boolean {
  const texto = normalizarTexto(title);

  return TERMOS_CALCADOS.some(
    (termo) =>
      texto.includes(
        normalizarTexto(termo),
      ),
  );
}

function extrairGeneroCalcado(
  product: ProductImport,
): string | null {
  const estruturado =
    buscarAtributo(product, [
      "GENDER",
      "GENERO",
      "SEXO",
    ]);

  const texto = normalizarTexto(
    estruturado ?? product.title,
  );

  if (
    /\bfeminin[oa]\b/.test(texto)
  ) {
    return "feminino";
  }

  if (
    /\bmasculin[oa]\b/.test(texto)
  ) {
    return "masculino";
  }

  if (
    /\bunissex\b/.test(texto)
  ) {
    return "unissex";
  }

  return null;
}

function extrairTamanhoExplicitoCalcado(
  product: ProductImport,
): string | null {
  const texto =
    normalizarTexto(product.title);

  const patterns = [
    /\b(?:tamanho|tam|numero)\s*(\d{2})\b/i,
    /\b(\d{2})\s*(?:br|bra)\b/i,
  ];

  for (const pattern of patterns) {
    const match = texto.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

function extrairTokensFortesCalcado(
  title: string,
  brand: string | null,
): string[] {
  const brandTokens =
    new Set(
      normalizarTexto(
        brand ?? "",
      )
        .split(" ")
        .filter(Boolean),
    );

  return Array.from(
    new Set(
      normalizarTexto(title)
        .split(" ")
        .filter(Boolean)
        .filter((token) => {
          if (
            brandTokens.has(token) ||
            TOKENS_GENERICOS_CALCADO.has(token)
          ) {
            return false;
          }

          /*
           * NumeraÃƒÂ§ÃƒÂ£o de calÃƒÂ§ado nÃƒÂ£o identifica a linha/modelo.
           */
          if (/^\d{2}$/.test(token)) {
            return false;
          }

          return token.length >= 3;
        }),
    ),
  );
}

function compararCalcadoEstritamente(
  original: ProductImport,
  candidate: ProductImport,
  a: ProductIdentity,
  b: ProductIdentity,
): MatchResult | null {
  if (!ehProdutoCalcado(original.title)) {
    return null;
  }

  if (!ehProdutoCalcado(candidate.title)) {
    return {
      exact: false,
      reason:
        "O candidato nÃƒÂ£o pertence ÃƒÂ  mesma famÃƒÂ­lia de calÃƒÂ§ados.",
    };
  }

  if (!a.brand) {
    return {
      exact: false,
      reason:
        "Marca do calÃƒÂ§ado original insuficiente para confirmaÃƒÂ§ÃƒÂ£o automÃƒÂ¡tica.",
    };
  }

  const marcaOriginal =
    normalizarTexto(a.brand);

  if (
    b.brand &&
    normalizarTexto(b.brand) !==
      marcaOriginal
  ) {
    return {
      exact: false,
      reason:
        `Marca diferente: ${a.brand} x ${b.brand}.`,
    };
  }

  if (!b.brand) {
    const tituloCandidato =
      ` ${normalizarTexto(candidate.title)} `;

    if (
      !tituloCandidato.includes(
        ` ${marcaOriginal} `,
      )
    ) {
      return {
        exact: false,
        reason:
          `A marca ${a.brand} nÃƒÂ£o foi confirmada no candidato.`,
      };
    }
  }

  /*
   * Cor continua sendo variante forte de calÃƒÂ§ado.
   * Se o original tem cor conhecida, o candidato tambÃƒÂ©m
   * precisa confirmÃƒÂ¡-la.
   */
  if (a.variants.color) {
    if (!b.variants.color) {
      return {
        exact: false,
        reason:
          "Cor do calÃƒÂ§ado nÃƒÂ£o confirmada no candidato.",
      };
    }

    if (
      a.variants.color !==
      b.variants.color
    ) {
      return {
        exact: false,
        reason:
          `Cor diferente: ${a.variants.color} x ${b.variants.color}.`,
      };
    }
  }

  /*
   * NumeraÃƒÂ§ÃƒÂ£o sÃƒÂ³ ÃƒÂ© bloqueante quando estiver explÃƒÂ­cita
   * no tÃƒÂ­tulo das duas ofertas.
   *
   * Muitos marketplaces retornam SIZE estruturado da
   * variaÃƒÂ§ÃƒÂ£o selecionada, enquanto o anÃƒÂºncio concorrente
   * representa a pÃƒÂ¡gina pai com seleÃƒÂ§ÃƒÂ£o de tamanho.
   * NÃƒÂ£o usamos essa assimetria oculta para descartar
   * automaticamente a mesma linha/cor.
   */
  const tamanhoOriginal =
    extrairTamanhoExplicitoCalcado(
      original,
    );

  const tamanhoCandidato =
    extrairTamanhoExplicitoCalcado(
      candidate,
    );

  if (
    tamanhoOriginal &&
    tamanhoCandidato &&
    tamanhoOriginal !==
      tamanhoCandidato
  ) {
    return {
      exact: false,
      reason:
        `Tamanho diferente: ${tamanhoOriginal} x ${tamanhoCandidato}.`,
    };
  }

  const generoOriginal =
    extrairGeneroCalcado(original);

  const generoCandidato =
    extrairGeneroCalcado(candidate);

  if (
    generoOriginal &&
    generoCandidato &&
    generoOriginal !==
      generoCandidato
  ) {
    return {
      exact: false,
      reason:
        `GÃƒÂªnero diferente: ${generoOriginal} x ${generoCandidato}.`,
    };
  }

  /*
   * Linhas de moda normalmente usam nomes textuais,
   * nÃƒÂ£o cÃƒÂ³digos alfanumÃƒÂ©ricos.
   *
   * Exemplo:
   * "Puma Carina Street BDP".
   *
   * O matcher genÃƒÂ©rico exige letras + nÃƒÂºmeros nos tokens
   * de modelo e, por isso, nÃƒÂ£o consegue confirmar essa
   * famÃƒÂ­lia. Para calÃƒÂ§ados usamos os tokens fortes da
   * prÃƒÂ³pria linha/modelo.
   */
  const tokensOriginal =
    extrairTokensFortesCalcado(
      original.title,
      a.brand,
    );

  const tokensCandidato =
    new Set(
      extrairTokensFortesCalcado(
        candidate.title,
        b.brand ?? a.brand,
      ),
    );

  if (tokensOriginal.length < 2) {
    return {
      exact: false,
      reason:
        "Linha/modelo do calÃƒÂ§ado insuficiente para confirmaÃƒÂ§ÃƒÂ£o automÃƒÂ¡tica.",
    };
  }

  const tokensComuns =
    tokensOriginal.filter(
      (token) =>
        tokensCandidato.has(token),
    );

  const minimoTokens =
    tokensOriginal.length <= 3
      ? tokensOriginal.length
      : Math.max(
          3,
          Math.ceil(
            tokensOriginal.length * 0.75,
          ),
        );

  if (
    tokensComuns.length <
    minimoTokens
  ) {
    return {
      exact: false,
      reason:
        `Linha/modelo do calÃƒÂ§ado nÃƒÂ£o coincide. ` +
        `Original: ${tokensOriginal.join(", ")}.`,
    };
  }

  const detalhes = [
    `linha=${tokensComuns.join(" ")}`,
    a.variants.color
      ? `cor=${a.variants.color}`
      : null,
    generoOriginal &&
    generoCandidato
      ? `genero=${generoOriginal}`
      : null,
    tamanhoOriginal &&
    tamanhoCandidato
      ? `tamanho=${tamanhoOriginal}`
      : null,
  ]
    .filter(
      (value): value is string =>
        Boolean(value),
    )
    .join(", ");

  return {
    exact: true,
    reason:
      `CalÃƒÂ§ado confirmado por marca, linha/modelo e variante(s): ${detalhes}.`,
  };
}

function compararProdutoEstritamente(
  original: ProductImport,
  candidate: ProductImport,
): MatchResult {
  const a = extrairIdentidade(original);
  const b = extrairIdentidade(candidate);

  /*
   * ProteÃ§Ã£o semÃ¢ntica:
   * produto principal nunca pode ser agrupado automaticamente
   * com acessÃ³rio, peÃ§a ou item de reposiÃ§Ã£o.
   *
   * Exemplo:
   * JBL Tune 520BT != almofada de reposiÃ§Ã£o para JBL Tune 520BT.
   */
  const termosAcessorio = [
    /\balmofad(?:a|as)\b/,
    /\bear\s*pad(?:s)?\b/,
    /\bearpad(?:s)?\b/,
    /\bsubstituicao\s+de\b/,
    /\breplacement\b/,
    /\bcapa\s+para\b/,
    /\bcase\s+para\b/,
    /\bestojo\s+para\b/,
    /\bprotetor(?:a)?\s+para\b/,
    /\bpelicula\s+para\b/,
    /\bpeca(?:s)?\s+de\s+reposicao\b/,
    /\bkit\s+de\s+reposicao\b/,
    /\badaptador\s+para\b/,
    /\bsuporte\s+para\b/,
  ];

  const tituloOriginalNormalizado =
    normalizarTexto(original.title);

  const tituloCandidatoNormalizado =
    normalizarTexto(candidate.title);

  const originalEhAcessorio =
    termosAcessorio.some((regex) =>
      regex.test(tituloOriginalNormalizado),
    );

  const candidatoEhAcessorio =
    termosAcessorio.some((regex) =>
      regex.test(tituloCandidatoNormalizado),
    );

  if (originalEhAcessorio !== candidatoEhAcessorio) {
    return {
      exact: false,
      reason:
        "Produto principal e acessÃ³rio/peÃ§a de reposiÃ§Ã£o nÃ£o podem ser agrupados automaticamente.",
    };
  }

  if (a.gtin && b.gtin) {
    if (a.gtin === b.gtin) {
      return {
        exact: true,
        reason: "GTIN/EAN idÃƒÂªntico.",
      };
    }

    return {
      exact: false,
      reason: "GTIN/EAN diferente.",
    };
  }

  const matchMovel =
    compararMovelEstritamente(
      original,
      candidate,
      a,
      b,
    );

  if (matchMovel) {
    return matchMovel;
  }

  const matchCalcado =
    compararCalcadoEstritamente(
      original,
      candidate,
      a,
      b,
    );

  if (matchCalcado) {
    return matchCalcado;
  }

  const matchTituloComercial =
    titulosComerciaisEquivalentes(
      original,
      candidate,
      a,
      b,
    );

  if (matchTituloComercial) {
    return matchTituloComercial;
  }

  if (a.brand && b.brand && a.brand !== b.brand) {
    return {
      exact: false,
      reason: `Marca diferente: ${a.brand} x ${b.brand}.`,
    };
  }

  if (!a.brand || !b.brand) {
    return {
      exact: false,
      reason: "Marca insuficiente para confirmaÃƒÂ§ÃƒÂ£o automÃƒÂ¡tica.",
    };
  }

  if (a.model && b.model && a.model !== b.model) {
    return {
      exact: false,
      reason: `Modelo/MPN diferente: ${a.model} x ${b.model}.`,
    };
  }

  const modeloEmComum = encontrarModeloEmComum(a, b);

  if (!modeloEmComum) {
    return {
      exact: false,
      reason: "Modelo/cÃƒÂ³digo insuficiente para confirmaÃƒÂ§ÃƒÂ£o automÃƒÂ¡tica.",
    };
  }

  const variantKeys = [
    "voltage",
    "storage",
    "ram",
    "network",
    "color",
    "size",
  ] as const;

  let agreements = 0;
  const acordos: string[] = [];

  for (const key of variantKeys) {
    const first = a.variants[key];
    const second = b.variants[key];

    if (first && second) {
      if (first !== second) {
        return {
          exact: false,
          reason: `Variante ${key} diferente: ${first} x ${second}.`,
        };
      }

      agreements += 1;
      acordos.push(`${key}=${first}`);
    }
  }

  if (agreements === 0) {
    /*
     * Marca + modelo/codigo forte sao suficientes
     * quando nenhuma variante informada entra em conflito.
     */
    return {
      exact: true,
      reason:
        `Marca e modelo/codigo ${modeloEmComum} coincidem ` +
        "e nao ha variante explicitamente conflitante.",
    };
  }

  return {
    exact: true,
    reason:
      `Marca ${a.brand}, modelo/cÃƒÂ³digo ${modeloEmComum} e ` +
      `variante(s) forte(s) ${acordos.join(", ")} coincidem.`,
  };
}

function criarTermoBusca(
  product: ProductImport,
): string {
  /*
   * MÃƒÂ³veis dependem muito de nome da linha,
   * quantidade de portas/gavetas e marca.
   *
   * Exemplo:
   * AramÃƒÂ³veis Kit Mega 9 Portas 2 Gavetas.
   *
   * Por isso preservamos o tÃƒÂ­tulo completo
   * como consulta em vez de reduzir a um
   * token genÃƒÂ©rico.
   */
  if (ehProdutoMovel(product.title)) {
    return normalizarTexto(
      product.title,
    ).slice(0, 180);
  }

  const identity = extrairIdentidade(product);

  const modeloBusca =
    extrairModeloDescritivoDoTitulo(product.title) ??
    buscarModeloEstruturado(product) ??
    identity.modelTokens[0] ??
    null;

  /*
   * A busca deve priorizar identidade estÃƒÂ¡vel, nÃƒÂ£o cor.
   *
   * Cor ÃƒÂ© validada depois pelo matcher estrito. ColocÃƒÂ¡-la
   * na consulta reduz demais o recall entre marketplaces,
   * principalmente quando uma loja anuncia vÃƒÂ¡rias cores no
   * mesmo tÃƒÂ­tulo e outra publica uma cor por anÃƒÂºncio.
   *
   * Exemplo:
   * "Logitech M170 Preto ou Cinza" => busca "logitech m170".
   */
  const partesFortes = [
    identity.brand,
    modeloBusca,
    identity.variants.network,
    identity.variants.storage,
    identity.variants.ram,
    identity.variants.voltage,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());

  const fortes = Array.from(
    new Set(
      partesFortes.map((value) =>
        normalizarTexto(value),
      ),
    ),
  ).filter(Boolean);

  if (identity.brand && modeloBusca) {
    return fortes.join(" ").slice(0, 180);
  }

  const fallback = Array.from(
    new Set([
      ...fortes,
      identity.variants.color
        ? normalizarTexto(identity.variants.color)
        : "",
    ]),
  ).filter(Boolean);

  if (fallback.length >= 2) {
    return fallback.join(" ").slice(0, 180);
  }

  return product.title.trim().slice(0, 180);
}


function criarTermosBuscaMultiloja(
  product: ProductImport,
  termoPrincipal: string,
): string[] {
  /*
   * Produtos com marca + modelo forte ja possuem
   * uma consulta precisa. Mantemos esse comportamento,
   * que foi validado com Logitech M170.
   */
  const identity =
    extrairIdentidade(product);

  const modeloBusca =
    extrairModeloDescritivoDoTitulo(
      product.title,
    ) ??
    buscarModeloEstruturado(product) ??
    identity.modelTokens[0] ??
    null;

  if (
    identity.brand &&
    modeloBusca
  ) {
    return [termoPrincipal];
  }

  /*
   * Moveis continuam usando o titulo completo.
   * Neles, linha, portas, gavetas etc. podem fazer
   * parte essencial da identidade.
   */
  if (
    ehProdutoMovel(product.title)
  ) {
    return [termoPrincipal];
  }

  const tituloNormalizado =
    normalizarTexto(
      product.title,
    )
      .replace(/\s+/g, " ")
      .trim();

  /*
   * Remove apenas caudas claramente promocionais.
   *
   * Exemplo:
   * "caixa bob ... ekipsom + brinde pendrive"
   * vira:
   * "caixa bob ... ekipsom"
   */
  const tituloSemPromocao =
    tituloNormalizado
      .replace(
        /\b(?:brinde|frete\s+gratis|envio\s+imediato|oferta\s+imperdivel|promocao\s+imperdivel)\b.*$/i,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();

  const palavrasDescartaveis =
    new Set([
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
      "para",
      "por",
      "com",
      "sem",
      "gamer",
      "premium",
      "profissional",
      "profissionais",
      "completo",
      "completa",
      "novo",
      "nova",
      "original",
      "oficial",
    ]);

  const tokensEssenciais =
    tituloSemPromocao
      .split(" ")
      .filter(Boolean)
      .filter(
        (token) =>
          !palavrasDescartaveis.has(
            token,
          ),
      );

  /*
   * Uma busca curta melhora recall quando lojas
   * usam titulos comerciais muito diferentes.
   *
   * O matcher EXACT continua sendo responsavel
   * por impedir a uniao de produtos diferentes.
   */
  const termoCurto =
    tokensEssenciais
      .slice(0, 8)
      .join(" ")
      .trim();

  return Array.from(
    new Set(
      [
        termoPrincipal,
        tituloSemPromocao,
        termoCurto,
      ]
        .map(
          (value) =>
            value
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 180),
        )
        .filter(
          (value) =>
            value.length >= 3,
        ),
    ),
  ).slice(0, 3);
}

async function preverDominioMercadoLivre(
  product: ProductImport,
): Promise<MercadoLivreDomainPrediction | null> {
  const query = product.title.trim().slice(0, 180);

  if (!query) {
    return null;
  }

  try {
    const endpoint =
      "/sites/MLB/domain_discovery/search" +
      "?limit=1" +
      `&q=${encodeURIComponent(query)}`;

    const response = (await mercadoLivreFetch(
      endpoint,
    )) as MercadoLivreDomainPrediction[];

    if (!Array.isArray(response) || response.length === 0) {
      return null;
    }

    return response[0] ?? null;
  } catch (error) {
    console.warn(
      "NÃƒÂ£o foi possÃƒÂ­vel prever o domÃƒÂ­nio do Mercado Livre. A busca continuarÃƒÂ¡ sem domÃƒÂ­nio.",
      error,
    );

    return null;
  }
}

function prepararAtributosPreditos(
  prediction: MercadoLivreDomainPrediction | null,
): Array<{
  id: string;
  value_id?: string;
  value_name?: string;
}> {
  if (!prediction?.attributes) {
    return [];
  }

  const prioridade = [
    "BRAND",
    "LINE",
    "MODEL",
    "INTERNAL_MEMORY",
    "RAM",
    "COLOR",
  ];

  const validos = prediction.attributes
    .filter(
      (attribute) =>
        typeof attribute.id === "string" &&
        attribute.id.trim() &&
        (attribute.value_id || attribute.value_name),
    )
    .sort((a, b) => {
      const indexA = prioridade.indexOf(a.id ?? "");
      const indexB = prioridade.indexOf(b.id ?? "");

      const rankA = indexA === -1 ? 999 : indexA;
      const rankB = indexB === -1 ? 999 : indexB;

      return rankA - rankB;
    })
    .slice(0, 5)
    .map((attribute) => {
      const item: {
        id: string;
        value_id?: string;
        value_name?: string;
      } = {
        id: attribute.id!.trim(),
      };

      if (attribute.value_id) {
        item.value_id = attribute.value_id;
      } else if (attribute.value_name) {
        item.value_name = attribute.value_name;
      }

      return item;
    });

  return validos;
}

function adicionarResultadosSemDuplicar(
  destino: MercadoLivreSearchResult[],
  response: MercadoLivreSearchResponse | null,
) {
  const results = Array.isArray(response?.results)
    ? response.results
    : [];

  const idsExistentes = new Set(
    destino
      .map((item) => item.id?.trim())
      .filter((id): id is string => Boolean(id)),
  );

  for (const result of results) {
    const id = result.id?.trim();

    if (!id || idsExistentes.has(id)) {
      continue;
    }

    destino.push(result);
    idsExistentes.add(id);

    if (destino.length >= MAX_MERCADO_LIVRE_CANDIDATES) {
      return;
    }
  }
}

async function pesquisarCatalogoMercadoLivre(
  product: ProductImport,
): Promise<MercadoLivreSearchResult[]> {
  const identity = extrairIdentidade(product);

  if (identity.gtin) {
    const endpoint =
      "/products/search" +
      "?status=active" +
      "&site_id=MLB" +
      "&limit=5" +
      `&product_identifier=${encodeURIComponent(identity.gtin)}`;

    const response = (await mercadoLivreFetch(
      endpoint,
    )) as MercadoLivreSearchResponse;

    return Array.isArray(response.results)
      ? response.results.slice(0, 5)
      : [];
  }

  const query = criarTermoBusca(product);
  const prediction = await preverDominioMercadoLivre(product);
  const domainId = prediction?.domain_id?.trim() || null;
  const resultados: MercadoLivreSearchResult[] = [];

  /*
   * Primeira tentativa: busca por atributos previstos pelo prÃƒÂ³prio
   * Mercado Livre. A documentaÃƒÂ§ÃƒÂ£o exige ao menos trÃƒÂªs atributos.
   */
  const atributos = prepararAtributosPreditos(prediction);

  if (domainId && atributos.length >= 3) {
    try {
      const response = (await mercadoLivreFetch(
        "/products/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            domain_id: domainId,
            site_id: "MLB",
            status: "active",
            attributes: atributos,
          }),
        },
      )) as MercadoLivreSearchResponse;

      adicionarResultadosSemDuplicar(resultados, response);
    } catch (error) {
      console.warn(
        "Busca por atributos do Mercado Livre falhou. A busca continuarÃƒÂ¡ por texto.",
        error,
      );
    }
  }

  /*
   * Segunda tentativa: consulta curta e objetiva, restringida ao
   * domÃƒÂ­nio previsto quando ele estiver disponÃƒÂ­vel.
   */
  if (resultados.length < MAX_MERCADO_LIVRE_CANDIDATES) {
    const endpoint =
      "/products/search" +
      "?status=active" +
      "&site_id=MLB" +
      "&limit=10" +
      "&offset=0" +
      `&q=${encodeURIComponent(query)}` +
      (domainId
        ? `&domain_id=${encodeURIComponent(domainId)}`
        : "");

    const response = (await mercadoLivreFetch(
      endpoint,
    )) as MercadoLivreSearchResponse;

    adicionarResultadosSemDuplicar(resultados, response);
  }

  /*
   * Fallback: se o domÃƒÂ­nio previsto trouxe poucos candidatos,
   * repetimos a mesma consulta sem restringir o domÃƒÂ­nio.
   * O matcher estrito continua sendo a barreira de seguranÃƒÂ§a.
   */
  if (
    domainId &&
    resultados.length < Math.min(5, MAX_MERCADO_LIVRE_CANDIDATES)
  ) {
    const endpoint =
      "/products/search" +
      "?status=active" +
      "&site_id=MLB" +
      "&limit=10" +
      "&offset=0" +
      `&q=${encodeURIComponent(query)}`;

    const response = (await mercadoLivreFetch(
      endpoint,
    )) as MercadoLivreSearchResponse;

    adicionarResultadosSemDuplicar(resultados, response);
  }

  return resultados.slice(0, MAX_MERCADO_LIVRE_CANDIDATES);
}

export async function buscarComparacaoManual(
  original: ProductImport,
  targetProductId: string,
): Promise<ManualComparisonSummary> {
  /*
   * O produto importado manualmente ÃƒÂ© a referÃƒÂªncia.
   *
   * A descoberta das outras lojas usa o mesmo
   * Marketplace Discovery da busca pÃƒÂºblica.
   *
   * Antes de anexar qualquer oferta ao Product
   * principal, mantemos uma validaÃƒÂ§ÃƒÂ£o estrita de
   * identidade e variante.
   */
  const query =
    criarTermoBusca(original);

  const {
    descobrirProdutos,
  } = await import(
    "@/services/discovery"
  );

  const marketplaceOrigemDiscovery:
    | "MERCADO_LIVRE"
    | "AMAZON"
    | "SHOPEE"
    | "MAGAZINE_LUIZA"
    | "ALIEXPRESS" =
    original.marketplace === "Mercado Livre"
      ? "MERCADO_LIVRE"
      : original.marketplace === "Amazon"
        ? "AMAZON"
        : original.marketplace === "Shopee"
          ? "SHOPEE"
          : original.marketplace === "Magazine Luiza"
            ? "MAGAZINE_LUIZA"
            : "ALIEXPRESS";

  const termosBusca =
    criarTermosBuscaMultiloja(
      original,
      query,
    );

  type ResultadoDescoberta =
    Awaited<
      ReturnType<
        typeof descobrirProdutos
      >
    >;

  type CandidatoDescoberta =
    ResultadoDescoberta[
      "candidates"
    ][number];

  type ResultadoMarketplaceDescoberta =
    ResultadoDescoberta[
      "results"
    ][number];

  const resultadosDescoberta:
    ResultadoDescoberta[] = [];

  /*
   * Executamos sequencialmente para nao pressionar
   * simultaneamente as APIs das marketplaces.
   */
  for (
    const termoBusca of termosBusca
  ) {
    const busca =
      await descobrirProdutos(
        termoBusca,
        5,
        {
          excludeMarketplace:
            marketplaceOrigemDiscovery,
        },
      );

    resultadosDescoberta.push(
      busca,
    );
  }

  /*
   * Uma mesma oferta pode aparecer em duas ou tres
   * consultas. Mantemos apenas uma copia.
   */
  const candidatosUnicos =
    new Map<
      string,
      CandidatoDescoberta
    >();

  const resultadosPorMarketplace =
    new Map<
      string,
      ResultadoMarketplaceDescoberta
    >();

  for (
    const busca of resultadosDescoberta
  ) {
    for (
      const candidato of busca.candidates
    ) {
      const chave =
        `${candidato.marketplace}:${candidato.externalId}`;

      if (
        !candidatosUnicos.has(
          chave,
        )
      ) {
        candidatosUnicos.set(
          chave,
          candidato,
        );
      }
    }

    for (
      const marketplace of busca.results
    ) {
      const atual =
        resultadosPorMarketplace.get(
          marketplace.marketplace,
        );

      if (!atual) {
        resultadosPorMarketplace.set(
          marketplace.marketplace,
          {
            ...marketplace,
          },
        );

        continue;
      }

      resultadosPorMarketplace.set(
        marketplace.marketplace,
        {
          ...atual,

          scanned:
            (atual.scanned ?? 0) +
            (marketplace.scanned ?? 0),

          error:
            atual.error ??
            marketplace.error,
        },
      );
    }
  }

  const resultado = {
    candidates:
      Array.from(
        candidatosUnicos.values(),
      ),

    results:
      Array.from(
        resultadosPorMarketplace.values(),
      ),
  };

  const marketplacesDisponiveis = [
    "Mercado Livre",
    "Amazon",
    "Shopee",
    "Magazine Luiza",
    "AliExpress",
  ];

  const searchedMarketplaces =
    marketplacesDisponiveis.filter(
      (marketplace) =>
        marketplace !==
        original.marketplace,
    );

  const pendingMarketplaces:
    string[] = [];

  const errors =
    resultado.results
      .filter(
        (marketplace) =>
          Boolean(
            marketplace.error,
          ),
      )
      .map(
        (marketplace) =>
          `${marketplace.marketplace}: ${marketplace.error}`,
      );

  const offers:
    ManualComparisonSummary["offers"] =
      [];

  const rejections:
    ManualComparisonSummary["rejections"] =
      [];

  const marketplacesEncontrados =
    new Set<string>();

  let importedCandidates = 0;
  let rejectedCandidates = 0;

  const scanned =
    resultado.results.reduce(
      (total, marketplace) =>
        total +
        marketplace.scanned,
      0,
    );

  /*
   * Processamos primeiro as ofertas de menor preÃƒÂ§o.
   *
   * Como o schema mantÃƒÂ©m uma oferta por
   * marketplace/Product, a primeira oferta EXACT
   * de cada loja serÃƒÂ¡ a mais barata encontrada.
   */
  const candidatos =
    [...resultado.candidates].sort(
      (primeiro, segundo) =>
        (
          primeiro.price ??
          Number.POSITIVE_INFINITY
        ) -
        (
          segundo.price ??
          Number.POSITIVE_INFINITY
        ),
    );

  const identidadeOriginal =
    extrairIdentidade(
      original,
    );

  for (const candidato of candidatos) {
    if (
      candidato.marketplaceName ===
      original.marketplace
    ) {
      /*
       * A oferta original jÃƒÂ¡ foi salva pela rota.
       * NÃƒÂ£o permitimos que o Discovery substitua
       * o link manual/afiliado informado.
       */
      continue;
    }

    if (
      marketplacesEncontrados.has(
        candidato.marketplaceName,
      )
    ) {
      continue;
    }

    if (
      candidato.status !== "FOUND" ||
      candidato.price === null ||
      !Number.isFinite(
        candidato.price,
      ) ||
      candidato.price <= 0
    ) {
      continue;
    }

    const image =
      candidato.image?.trim();

    if (!image) {
      continue;
    }

    importedCandidates += 1;

    const oldPrice =
      candidato.oldPrice !== null &&
      Number.isFinite(
        candidato.oldPrice,
      ) &&
      candidato.oldPrice >
        candidato.price
        ? candidato.oldPrice
        : null;

    const candidateProduct:
      ProductImport = {
      marketplace:
        candidato.marketplaceName,

      externalId:
        candidato.externalId.trim(),

      url:
        candidato.sourceUrl.trim(),

      affiliateLink:
        candidato.affiliateLink
          ?.trim() ||
        null,

      title:
        candidato.title.trim(),

      description:
        null,

      brand:
        candidato.brand?.trim() ||
        null,

      category:
        candidato.category?.trim() ||
        null,

      image,

      images: [
        image,
      ],

      price:
        candidato.price,

      oldPrice,

      discount:
        oldPrice
          ? Math.round(
              (
                (
                  oldPrice -
                  candidato.price
                ) /
                oldPrice
              ) *
                100,
            )
          : null,

      installments:
        null,

      rating:
        null,

      reviews:
        null,

      sales:
        null,

      stock:
        null,

      seller:
        candidato.seller?.trim() ||
        null,

      attributes:
        {},
    };

    const identidadeCandidata =
      extrairIdentidade(
        candidateProduct,
      );

    /*
     * Para variantes crÃƒÂ­ticas, ausÃƒÂªncia de
     * informaÃƒÂ§ÃƒÂ£o de apenas um lado tambÃƒÂ©m impede
     * agrupamento automÃƒÂ¡tico.
     *
     * Exemplo:
     * - iPhone Azul nÃƒÂ£o pode receber oferta sem cor;
     * - 128 GB nÃƒÂ£o pode receber oferta sem capacidade;
     * - eletrodomÃƒÂ©stico 127V nÃƒÂ£o pode receber 220V
     *   ou tensÃƒÂ£o desconhecida.
     */
    const variantesCriticas = [
      "color",
      "storage",
      "voltage",
      "size",
    ] as const;

    let varianteInsegura:
      string | null = null;

    /*
     * O matcher especÃƒÂ­fico de mÃƒÂ³veis jÃƒÂ¡ valida
     * marca, linha/modelo, portas, gavetas e
     * divergÃƒÂªncia de cor quando ambos os lados
     * informam a cor.
     *
     * Portanto, ausÃƒÂªncia de uma variante em uma
     * das lojas nÃƒÂ£o deve impedir o mÃƒÂ³vel de chegar
     * ao matcher especÃƒÂ­fico.
     *
     * EletrÃƒÂ´nicos continuam com a proteÃƒÂ§ÃƒÂ£o rÃƒÂ­gida.
     */
    if (
      !ehProdutoMovel(original.title) &&
      !ehProdutoCalcado(original.title)
    ) {
      for (
        const chave
        of variantesCriticas
      ) {
        const originalValor =
          identidadeOriginal
            .variants[chave];

        const candidataValor =
          identidadeCandidata
            .variants[chave];

        if (
          Boolean(originalValor) !==
          Boolean(candidataValor)
        ) {
          varianteInsegura =
            `Variante ${chave} insuficiente para confirmaÃƒÂ§ÃƒÂ£o automÃƒÂ¡tica.`;

          break;
        }
      }
    }

    if (varianteInsegura) {
      rejectedCandidates += 1;

      rejections.push({
        marketplace:
          candidato.marketplaceName,

        catalogId:
          candidato.externalId,

        name:
          candidato.title,

        reason:
          varianteInsegura,
      });

      continue;
    }

    const match =
      compararProdutoEstritamente(
        original,
        candidateProduct,
      );

    if (!match.exact) {
      rejectedCandidates += 1;

      rejections.push({
        marketplace:
          candidato.marketplaceName,

        catalogId:
          candidato.externalId,

        name:
          candidato.title,

        reason:
          match.reason,
      });

      continue;
    }

    try {
      const saved =
        await saveProduct(
          candidateProduct,
          candidateProduct
            .affiliateLink ??
            null,
          {
            targetProductId,
            discoverySource:
              "ON_DEMAND_SEARCH",
            sourceQuery:
              query,
            autoCreated:
              false,
          },
        );

      if (
        saved.id !==
        targetProductId
      ) {
        /*
         * O matcher ja confirmou esta oferta como EXACT.
         * Se ela pertence a outro Product, unificamos
         * somente esta MarketplaceOffer validada.
         */
        const movida =
          await prisma.marketplaceOffer.updateMany({
            where: {
              productId:
                saved.id,

              marketplace:
                candidato.marketplace,

              externalId:
                candidato.externalId,
            },

            data: {
              productId:
                targetProductId,

              matchStatus:
                "EXACT",

              matchScore: 1,
            },
          });

        if (movida.count === 0) {
          errors.push(
            `${candidato.marketplaceName}: oferta EXACT encontrada em outro Product, mas nao foi possivel unifica-la.`,
          );

          continue;
        }
      }

      await prisma.$transaction(
        async (tx) => {
          await tx.marketplaceOffer.updateMany({
            where: {
              productId:
                targetProductId,

              marketplace:
                candidato.marketplace,

              externalId:
                candidato.externalId,
            },

            data: {
              matchStatus:
                "EXACT",
              matchScore: 1,
            },
          });

          await sincronizarMelhorOfertaDoProduto(
            tx,
            targetProductId,
          );
        },
      );

      marketplacesEncontrados.add(
        candidato.marketplaceName,
      );

      offers.push({
        marketplace:
          candidato.marketplaceName,

        externalId:
          candidato.externalId,

        productId:
          targetProductId,

        name:
          candidato.title,

        price:
          candidato.price,

        affiliateLink:
          candidato.affiliateLink ??
          null,

        reason:
          match.reason,
      });
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `${candidato.marketplaceName}: ${error.message}`
          : `${candidato.marketplaceName}: erro ao salvar oferta.`,
      );
    }
  }

  try {
    await prisma.product.update({
      where: {
        id:
          targetProductId,
      },

      data: {
        sourceQuery:
          query,

        lastSearchedAt:
          new Date(),
      },
    });
  } catch (error) {
    console.error(
      "Erro ao registrar comparaÃƒÂ§ÃƒÂ£o manual:",
      error,
    );
  }

  return {
    query,
    searchedMarketplaces,
    pendingMarketplaces,
    scanned,
    importedCandidates,
    rejectedCandidates,
    found:
      offers.length,
    offers,
    rejections,
    errors,
  };
}








