import prisma from "@/lib/prisma";

import type { ProductImport } from "@/services/importers/core/types";

type MarketplaceDatabase =
  | "MERCADO_LIVRE"
  | "AMAZON"
  | "SHOPEE"
  | "MAGAZINE_LUIZA"
  | "ALIEXPRESS";

type DiscoverySourceDatabase =
  | "MANUAL"
  | "OPPORTUNITY"
  | "ON_DEMAND_SEARCH"
  | "PRICE_MONITOR"
  | "API";

export type SaveProductOptions = {
  targetProductId?: string | null;
  discoverySource?: DiscoverySourceDatabase;
  autoCreated?: boolean;
  sourceQuery?: string | null;
};

function criarSlug(
  texto: string,
  marketplace: MarketplaceDatabase,
  externalId: string,
): string {
  const base = texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);

  const loja = marketplace
    .toLowerCase()
    .replaceAll("_", "-");

  const codigo = externalId
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);

  return `${base}-${loja}-${codigo}`;
}

function normalizarLinkAfiliado(
  valor: string,
): string {
  let link = valor.trim();

  while (true) {
    const linkDuplicado = link.match(
      /^https?:\/\/(?:www\.)?meli\.la\/(https?:\/\/.+)$/i,
    );

    if (!linkDuplicado?.[1]) {
      break;
    }

    link = linkDuplicado[1].trim();
  }

  return link;
}

function converterMarketplace(
  marketplace: ProductImport["marketplace"],
): MarketplaceDatabase {
  switch (marketplace) {
    case "Mercado Livre":
      return "MERCADO_LIVRE";

    case "Amazon":
      return "AMAZON";

    case "Shopee":
      return "SHOPEE";

    case "Magazine Luiza":
      return "MAGAZINE_LUIZA";

    case "AliExpress":
      return "ALIEXPRESS";

    default: {
      const marketplaceNunca: never = marketplace;

      throw new Error(
        `Marketplace nÃ£o suportado: ${String(
          marketplaceNunca,
        )}`,
      );
    }
  }
}

function nomeMarketplace(
  marketplace: MarketplaceDatabase,
): string {
  const nomes: Record<
    MarketplaceDatabase,
    string
  > = {
    MERCADO_LIVRE: "Mercado Livre",
    AMAZON: "Amazon",
    SHOPEE: "Shopee",
    MAGAZINE_LUIZA: "Magazine Luiza",
    ALIEXPRESS: "AliExpress",
  };

  return nomes[marketplace];
}

function normalizarTextoIdentificador(
  valor: string,
): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}

function normalizarChaveAtributo(
  valor: string,
): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function encontrarAtributo(
  atributos: Record<string, string>,
  nomes: readonly string[],
): string | null {
  const nomesNormalizados = nomes.map(
    normalizarChaveAtributo,
  );

  const entradas = Object.entries(atributos)
    .map(([chave, valor]) => ({
      chaveNormalizada:
        normalizarChaveAtributo(chave),
      valor: valor.trim(),
    }))
    .filter((item) => Boolean(item.valor));

  for (const nome of nomesNormalizados) {
    const exato = entradas.find(
      (item) => item.chaveNormalizada === nome,
    );

    if (exato) {
      return exato.valor;
    }
  }

  for (const nome of nomesNormalizados) {
    const parcial = entradas.find((item) => {
      const chave = item.chaveNormalizada;

      return (
        chave.startsWith(`${nome}_`) ||
        chave.endsWith(`_${nome}`) ||
        chave.includes(`_${nome}_`)
      );
    });

    if (parcial) {
      return parcial.valor;
    }
  }

  return null;
}

function normalizarValorVariante(
  valor: string | null,
): string | null {
  if (!valor) {
    return null;
  }

  const normalizado =
    normalizarTextoIdentificador(valor)
      .replace(/[^A-Z0-9]+/g, "")
      .slice(0, 80);

  return normalizado || null;
}

function extrairVoltagemDoTitulo(
  titulo: string,
): string | null {
  const texto = normalizarTextoIdentificador(
    titulo,
  );

  if (texto.includes("BIVOLT")) {
    return "BIVOLT";
  }

  const encontrada = texto.match(
    /\b(110|127|220|240)\s*(?:V|VOLTS?)\b/,
  );

  return encontrada?.[1]
    ? `${encontrada[1]}V`
    : null;
}


function extrairTamanhoDoTitulo(
  titulo: string,
): string | null {
  const texto = normalizarTextoIdentificador(
    titulo,
  );

  const comUnidade = texto.match(
    /\b(\d{1,2})[.,](\d)\s*(?:["”″]|POLEGADAS?|POL)(?:\s|$)/,
  );

  if (comUnidade?.[1] && comUnidade[2]) {
    return normalizarValorVariante(
      `${comUnidade[1]}.${comUnidade[2]}`,
    );
  }

  const depoisDeTela = texto.match(
    /\bTELA\b.{0,30}\b(\d{1,2})[.,](\d)\b/,
  );

  if (depoisDeTela?.[1] && depoisDeTela[2]) {
    return normalizarValorVariante(
      `${depoisDeTela[1]}.${depoisDeTela[2]}`,
    );
  }

  return null;
}

function extrairRamDoTitulo(
  titulo: string,
): string | null {
  const texto = normalizarTextoIdentificador(
    titulo,
  );

  const depoisDoNumero = texto.match(
    /\b(\d{1,3})\s*GB\s*(?:DE\s*)?(?:RAM|DDR[345]?)\b/,
  );

  if (depoisDoNumero?.[1]) {
    return normalizarValorVariante(
      `${depoisDoNumero[1]}GB`,
    );
  }

  const depoisDeRam = texto.match(
    /\bRAM\s*(?:DE\s*)?(\d{1,3})\s*GB\b/,
  );

  if (depoisDeRam?.[1]) {
    return normalizarValorVariante(
      `${depoisDeRam[1]}GB`,
    );
  }

  return null;
}

function extrairArmazenamentoDoTitulo(
  titulo: string,
): string | null {
  const texto = normalizarTextoIdentificador(
    titulo,
  );

  const numeroAntes = texto.match(
    /\b(\d{2,4})\s*(GB|TB)\s*(?:SSD|NVME|HDD)\b/,
  );

  if (numeroAntes?.[1] && numeroAntes[2]) {
    return normalizarValorVariante(
      `${numeroAntes[1]}${numeroAntes[2]}`,
    );
  }

  const tipoAntes = texto.match(
    /\b(?:SSD|NVME|HDD)\s*(?:DE\s*)?(\d{2,4})\s*(GB|TB)\b/,
  );

  if (tipoAntes?.[1] && tipoAntes[2]) {
    return normalizarValorVariante(
      `${tipoAntes[1]}${tipoAntes[2]}`,
    );
  }

  return null;
}

function extrairModeloDoTitulo(
  titulo: string,
): string | null {
  const texto = normalizarTextoIdentificador(
    titulo,
  );

  /*
   * Fallback conservador para códigos de modelo
   * alfanuméricos com hífen, como E-02,
   * ANV15-52-77BG etc.
   *
   * Não usamos tokens genéricos como 220V, 30W,
   * 16GB ou RTX4050 como modelo.
   */
  const candidatos =
    texto.match(
      /\b[A-Z][A-Z0-9]{0,11}-[A-Z0-9][A-Z0-9-]{0,24}\b/g,
    ) ?? [];

  const bloqueados = new Set([
    "WI-FI",
    "USB-C",
    "TYPE-C",
  ]);

  for (const candidato of candidatos) {
    const codigo =
      normalizarCodigoProduto(candidato);

    if (
      codigo &&
      !bloqueados.has(codigo) &&
      !/^\d/.test(codigo)
    ) {
      return codigo;
    }
  }

  return null;
}

function normalizarMarcaCanonical(
  valor: string | null,
): string | null {
  if (!valor) {
    return null;
  }

  const marca = normalizarTextoIdentificador(
    valor,
  )
    .replace(/^VISITE A LOJA\s+/i, "")
    .replace(/^MARCA[:\s]+/i, "")
    .trim();

  return marca || null;
}


function tituloContemMarca(
  titulo: string,
  marca: string,
): boolean {
  const texto = normalizarTextoIdentificador(
    titulo,
  )
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();

  const marcaNormalizada =
    normalizarTextoIdentificador(marca)
      .replace(/[^A-Z0-9]+/g, " ")
      .trim();

  if (!texto || !marcaNormalizada) {
    return false;
  }

  return ` ${texto} `.includes(
    ` ${marcaNormalizada} `,
  );
}

function normalizarCodigoNumerico(
  valor: string | null,
): string | null {
  if (!valor) {
    return null;
  }

  const numeros = valor.replace(/\D/g, "");

  if (
    numeros.length < 8 ||
    numeros.length > 14
  ) {
    return null;
  }

  return numeros;
}

function normalizarCodigoProduto(
  valor: string | null,
): string | null {
  if (!valor) {
    return null;
  }

  const codigo = normalizarTextoIdentificador(
    valor,
  )
    .replace(/[^A-Z0-9._/-]+/g, "")
    .slice(0, 100);

  return codigo || null;
}


function normalizarCapacidadeDigital(
  valor: string | null,
): string | null {
  if (!valor) {
    return null;
  }

  const texto = normalizarTextoIdentificador(
    valor,
  );

  const encontrada = texto.match(
    /\b(\d+(?:[.,]\d+)?)\s*(MB|GB|TB)\b/,
  );

  if (!encontrada?.[1] || !encontrada[2]) {
    return null;
  }

  const numero = encontrada[1]
    .replace(",", ".")
    .replace(/\.0+$/, "");

  return `${numero}${encontrada[2]}`;
}

function encontrarCapacidadeRam(
  atributos: Record<string, string>,
): string | null {
  const entradas = Object.entries(atributos)
    .map(([chave, valor]) => ({
      chave: normalizarChaveAtributo(chave),
      valor: valor.trim(),
    }))
    .filter((item) => Boolean(item.valor));

  const prioridades = [
    "CAPACIDADE_TOTAL_DO_MODULO_DE_MEMORIA_RAM",
    "TAMANHO_INSTALADO_DA_MEMORIA_RAM",
    "CAPACIDADE_DA_MEMORIA_RAM",
    "CAPACIDADE_DE_MEMORIA_RAM",
    "MEMORIA_RAM_INSTALADA",
    "RAM_SIZE",
    "MEMORY_SIZE",
    "MEMORIA_RAM",
    "RAM",
  ];

  for (const prioridade of prioridades) {
    const exata = entradas.find(
      (item) => item.chave === prioridade,
    );

    const capacidade = normalizarCapacidadeDigital(
      exata?.valor ?? null,
    );

    if (capacidade) {
      return capacidade;
    }
  }

  const bloqueadas = [
    "TIPO",
    "VELOCIDADE",
    "FREQUENCIA",
    "SLOT",
    "MAXIMA",
    "MAXIMO",
    "SUPORTADA",
    "LATENCIA",
  ];

  for (const item of entradas) {
    const relacionada =
      item.chave.includes("MEMORIA_RAM") ||
      item.chave === "RAM" ||
      item.chave.endsWith("_RAM");

    if (!relacionada) {
      continue;
    }

    if (
      bloqueadas.some((palavra) =>
        item.chave.includes(palavra),
      )
    ) {
      continue;
    }

    const capacidade =
      normalizarCapacidadeDigital(item.valor);

    if (capacidade) {
      return capacidade;
    }
  }

  return null;
}

function encontrarCapacidadeArmazenamento(
  atributos: Record<string, string>,
): string | null {
  const entradas = Object.entries(atributos)
    .map(([chave, valor]) => ({
      chave: normalizarChaveAtributo(chave),
      valor: valor.trim(),
    }))
    .filter((item) => Boolean(item.valor));

  const prioridades = [
    "CAPACIDADE_DE_DISCO_SSD",
    "CAPACIDADE_DO_DISCO_SSD",
    "CAPACIDADE_DO_SSD",
    "CAPACIDADE_SSD",
    "SSD_CAPACITY",
    "CAPACIDADE_DO_DISCO_RIGIDO",
    "TAMANHO_DO_DISCO_RIGIDO",
    "CAPACIDADE_DE_ARMAZENAMENTO",
    "ARMAZENAMENTO",
    "STORAGE",
  ];

  for (const prioridade of prioridades) {
    const exata = entradas.find(
      (item) => item.chave === prioridade,
    );

    const capacidade = normalizarCapacidadeDigital(
      exata?.valor ?? null,
    );

    if (capacidade) {
      return capacidade;
    }
  }

  const bloqueadas = [
    "INTERFACE",
    "TIPO",
    "MODELO",
    "CONEXAO",
    "VELOCIDADE",
    "SLOT",
  ];

  for (const item of entradas) {
    const relacionada =
      item.chave.includes("SSD") ||
      item.chave.includes("HDD") ||
      item.chave.includes("ARMAZENAMENTO");

    if (!relacionada) {
      continue;
    }

    if (
      bloqueadas.some((palavra) =>
        item.chave.includes(palavra),
      )
    ) {
      continue;
    }

    const capacidade =
      normalizarCapacidadeDigital(item.valor);

    if (capacidade) {
      return capacidade;
    }
  }

  return null;
}

function extrairIdentificadores(
  product: ProductImport,
) {
  const eanEncontrado = encontrarAtributo(
    product.attributes,
    [
      "EAN",
      "CODIGO_EAN",
      "CODIGO_DE_BARRAS",
      "BARCODE",
    ],
  );

  const gtinEncontrado = encontrarAtributo(
    product.attributes,
    [
      "GTIN",
      "GTIN_8",
      "GTIN_12",
      "GTIN_13",
      "GTIN_14",
      "UPC",
      "ISBN",
    ],
  );

  const mpnEncontrado = encontrarAtributo(
    product.attributes,
    [
      "MPN",
      "PART_NUMBER",
      "NUMERO_DA_PECA",
      "CODIGO_DO_FABRICANTE",
      "REFERENCIA_DO_FABRICANTE",
    ],
  );

  const modeloEncontrado = encontrarAtributo(
    product.attributes,
    [
      "MODELO_ALFANUMERICO",
      "MODELO_DETALHADO",
      "MODEL_NUMBER",
      "NUMERO_DO_MODELO",
      "CODIGO_DO_MODELO",
      "NOME_DO_MODELO",
      "MODELO",
      "MODEL",
    ],
  );

  const corEncontrada = encontrarAtributo(
    product.attributes,
    [
      "COR",
      "COLOR",
      "COR_PRINCIPAL",
    ],
  );

  const voltagemEncontrada =
    encontrarAtributo(
      product.attributes,
      [
        "VOLTAGEM",
        "TENSAO",
        "VOLTAGE",
      ],
    );

  const tamanhoEncontrado =
    encontrarAtributo(
      product.attributes,
      [
        "TAMANHO",
        "SIZE",
        "TAMANHO_DO_COLCHAO",
        "TAMANHO_DA_TELA",
      ],
    );

  const capacidadeEncontrada =
    encontrarAtributo(
      product.attributes,
      [
        "CAPACIDADE",
        "CAPACIDADE_EM_VOLUME",
        "VOLUME_DA_UNIDADE",
        "PESO_LIQUIDO",
      ],
    );

  const ramEncontrada =
    encontrarCapacidadeRam(
      product.attributes,
    );

  const armazenamentoEncontrado =
    encontrarCapacidadeArmazenamento(
      product.attributes,
    );

  const quantidadeKitEncontrada =
    encontrarAtributo(
      product.attributes,
      [
        "UNIDADES_POR_EMBALAGEM",
        "QUANTIDADE_DE_PECAS",
        "QUANTIDADE_DE_UNIDADES",
        "QUANTIDADE_DE_MESAS_DE_CABECEIRA",
        "UNIDADES_POR_KIT",
      ],
    );

  const ean = normalizarCodigoNumerico(
    eanEncontrado,
  );

  const gtin = normalizarCodigoNumerico(
    gtinEncontrado,
  );

  const mpn = normalizarCodigoProduto(
    mpnEncontrado,
  );

  const modelNumber =
    normalizarCodigoProduto(
      modeloEncontrado,
    ) ??
    extrairModeloDoTitulo(product.title);

  const color = normalizarValorVariante(
    corEncontrada,
  );

  const voltage =
    normalizarValorVariante(
      voltagemEncontrada,
    ) ??
    extrairVoltagemDoTitulo(product.title);

  const size =
    normalizarValorVariante(
      tamanhoEncontrado,
    ) ??
    extrairTamanhoDoTitulo(product.title);

  const capacity = normalizarValorVariante(
    capacidadeEncontrada,
  );

  const ram =
    normalizarValorVariante(
      ramEncontrada,
    ) ??
    extrairRamDoTitulo(product.title);

  const storage =
    normalizarValorVariante(
      armazenamentoEncontrado,
    ) ??
    extrairArmazenamentoDoTitulo(
      product.title,
    );

  const kitQuantity =
    normalizarValorVariante(
      quantidadeKitEncontrada,
    );

  return {
    ean,
    gtin,
    mpn,
    modelNumber,
    color,
    voltage,
    size,
    capacity,
    ram,
    storage,
    kitQuantity,
  };
}

type ProdutoParaMatching = {
  id: string;
  name: string;
  canonicalName: string | null;
  brand: string | null;
  specifications: unknown;
  modelNumber: string | null;
  ean: string | null;
  gtin: string | null;
  mpn: string | null;
  color: string | null;
  voltage: string | null;
  size: string | null;
};

function converterEspecificacoesParaAtributos(
  specifications: unknown,
): Record<string, string> {
  if (
    !specifications ||
    typeof specifications !== "object" ||
    Array.isArray(specifications)
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(
      specifications as Record<string, unknown>,
    )
      .filter(
        ([, valor]) =>
          valor !== null &&
          valor !== undefined,
      )
      .map(([chave, valor]) => [
        chave,
        String(valor),
      ]),
  );
}

function extrairIdentidadeProdutoExistente(
  produto: ProdutoParaMatching,
) {
  const attributes =
    converterEspecificacoesParaAtributos(
      produto.specifications,
    );

  const mpnDosAtributos = normalizarCodigoProduto(
    encontrarAtributo(attributes, [
      "MPN",
      "PART_NUMBER",
      "NUMERO_DA_PECA",
      "CODIGO_DO_FABRICANTE",
      "REFERENCIA_DO_FABRICANTE",
    ]),
  );

  const modeloDosAtributos =
    normalizarCodigoProduto(
      encontrarAtributo(attributes, [
        "MODELO_ALFANUMERICO",
        "MODELO_DETALHADO",
        "MODEL_NUMBER",
        "NUMERO_DO_MODELO",
        "CODIGO_DO_MODELO",
        "NOME_DO_MODELO",
        "MODELO",
        "MODEL",
      ]),
    );

  const titulo =
    produto.canonicalName?.trim() ||
    produto.name;

  return {
    brand: normalizarMarcaCanonical(
      produto.brand,
    ),
    ean: normalizarCodigoNumerico(
      produto.ean,
    ),
    gtin: normalizarCodigoNumerico(
      produto.gtin,
    ),
    codes: Array.from(
      new Set(
        [
          normalizarCodigoProduto(
            produto.mpn,
          ),
          normalizarCodigoProduto(
            produto.modelNumber,
          ),
          mpnDosAtributos,
          modeloDosAtributos,
          extrairModeloDoTitulo(titulo),
        ].filter(
          (valor): valor is string =>
            Boolean(valor),
        ),
      ),
    ),
    color:
      normalizarValorVariante(
        produto.color,
      ) ??
      normalizarValorVariante(
        encontrarAtributo(attributes, [
          "COR",
          "COLOR",
          "COR_PRINCIPAL",
        ]),
      ),
    voltage:
      normalizarValorVariante(
        produto.voltage,
      ) ??
      normalizarValorVariante(
        encontrarAtributo(attributes, [
          "VOLTAGEM",
          "TENSAO",
          "VOLTAGE",
        ]),
      ) ??
      extrairVoltagemDoTitulo(titulo),
    size:
      normalizarValorVariante(
        produto.size,
      ) ??
      normalizarValorVariante(
        encontrarAtributo(attributes, [
          "TAMANHO",
          "SIZE",
          "TAMANHO_DO_COLCHAO",
          "TAMANHO_DA_TELA",
        ]),
      ) ??
      extrairTamanhoDoTitulo(titulo),
    capacity: normalizarValorVariante(
      encontrarAtributo(attributes, [
        "CAPACIDADE",
        "CAPACIDADE_EM_VOLUME",
        "VOLUME_DA_UNIDADE",
        "PESO_LIQUIDO",
      ]),
    ),
    ram:
      normalizarValorVariante(
        encontrarCapacidadeRam(attributes),
      ) ??
      extrairRamDoTitulo(titulo),
    storage:
      normalizarValorVariante(
        encontrarCapacidadeArmazenamento(
          attributes,
        ),
      ) ??
      extrairArmazenamentoDoTitulo(
        titulo,
      ),
    kitQuantity: normalizarValorVariante(
      encontrarAtributo(attributes, [
        "UNIDADES_POR_EMBALAGEM",
        "QUANTIDADE_DE_PECAS",
        "QUANTIDADE_DE_UNIDADES",
        "QUANTIDADE_DE_MESAS_DE_CABECEIRA",
        "UNIDADES_POR_KIT",
      ]),
    ),
  };
}

function calcularCompatibilidadeExata(
  produtoExistente: ProdutoParaMatching,
  product: ProductImport,
  identificadores: ReturnType<
    typeof extrairIdentificadores
  >,
): number | null {
  const existente =
    extrairIdentidadeProdutoExistente(
      produtoExistente,
    );

  const marcaImportada =
    normalizarMarcaCanonical(product.brand);

  const marcaExistente = existente.brand;

  const tituloExistente =
    produtoExistente.canonicalName?.trim() ||
    produtoExistente.name;

  if (
    marcaImportada &&
    marcaExistente &&
    marcaImportada !== marcaExistente
  ) {
    return null;
  }

  const marcasEstruturadasNosDois =
    Boolean(
      marcaImportada &&
      marcaExistente,
    );

  if (!marcasEstruturadasNosDois) {
    const marcaConfirmadaNoTitulo =
      !marcaImportada && marcaExistente
        ? tituloContemMarca(
            product.title,
            marcaExistente,
          )
        : marcaImportada && !marcaExistente
          ? tituloContemMarca(
              tituloExistente,
              marcaImportada,
            )
          : false;

    if (!marcaConfirmadaNoTitulo) {
      return null;
    }
  }

  const globalImportado =
    identificadores.gtin ||
    identificadores.ean;

  const globalExistente =
    existente.gtin || existente.ean;

  if (
    globalImportado &&
    globalExistente
  ) {
    return globalImportado === globalExistente
      ? 1
      : null;
  }

  const codigosImportados = Array.from(
    new Set(
      [
        identificadores.mpn,
        identificadores.modelNumber,
      ].filter(
        (valor): valor is string =>
          Boolean(valor),
      ),
    ),
  );

  const codigoCoincide =
    codigosImportados.some((codigo) =>
      existente.codes.includes(codigo),
    );

  if (!codigoCoincide) {
    return null;
  }

  const paresVariantes = [
    [identificadores.voltage, existente.voltage],
    [identificadores.size, existente.size],
    [identificadores.capacity, existente.capacity],
    [identificadores.ram, existente.ram],
    [identificadores.storage, existente.storage],
    [identificadores.kitQuantity, existente.kitQuantity],
  ] as const;

  let variantesFortesCoincidentes = 0;

  for (const [importada, salva] of paresVariantes) {
    if (importada && salva) {
      if (importada !== salva) {
        return null;
      }

      variantesFortesCoincidentes += 1;
    }
  }

  if (
    identificadores.color &&
    existente.color &&
    identificadores.color !== existente.color
  ) {
    return null;
  }

  /*
   * Sem GTIN/EAN:
   *
   * - com marca estruturada nos dois lados, exigimos
   *   ao menos uma variante forte coincidente;
   * - se uma loja não forneceu marca estruturada,
   *   a marca precisa aparecer no título e exigimos
   *   ao menos duas variantes fortes coincidentes.
   *
   * Isso permite comparar feeds pobres, como Shopee,
   * sem afrouxar a proteção contra variantes erradas.
   */
  const minimoVariantesFortes =
    marcasEstruturadasNosDois ? 1 : 2;

  if (
    variantesFortesCoincidentes <
    minimoVariantesFortes
  ) {
    return null;
  }

  const baseScore =
    marcasEstruturadasNosDois ? 0.95 : 0.94;

  return Math.min(
    baseScore +
      variantesFortesCoincidentes * 0.01,
    0.99,
  );
}

function criarCanonicalKey(
  product: ProductImport,
  identificadores: ReturnType<
    typeof extrairIdentificadores
  >,
): string | null {
  const codigoGlobal =
    identificadores.gtin ||
    identificadores.ean;

  if (codigoGlobal) {
    return `gtin:${codigoGlobal}`;
  }

  const marca = normalizarMarcaCanonical(
    product.brand,
  );

  const codigoFabricante =
    identificadores.mpn ||
    identificadores.modelNumber;

  if (!marca || !codigoFabricante) {
    return null;
  }

  const variantesFortes = [
    identificadores.voltage,
    identificadores.size,
    identificadores.capacity,
    identificadores.ram,
    identificadores.storage,
    identificadores.kitQuantity,
  ].filter(
    (valor): valor is string =>
      Boolean(valor),
  );

  /*
   * Sem GTIN/EAN, marca + código/modelo sozinhos
   * não são suficientes para autoagrupar variantes.
   * Ex.: um mesmo modelo pode existir em 127V e 220V.
   */
  if (variantesFortes.length < 1) {
    return null;
  }

  const partesVariantes = [
    identificadores.color
      ? `color=${identificadores.color}`
      : null,
    identificadores.voltage
      ? `voltage=${identificadores.voltage}`
      : null,
    identificadores.size
      ? `size=${identificadores.size}`
      : null,
    identificadores.capacity
      ? `capacity=${identificadores.capacity}`
      : null,
    identificadores.ram
      ? `ram=${identificadores.ram}`
      : null,
    identificadores.storage
      ? `storage=${identificadores.storage}`
      : null,
    identificadores.kitQuantity
      ? `kit=${identificadores.kitQuantity}`
      : null,
  ].filter(
    (valor): valor is string =>
      Boolean(valor),
  );

  return [
    "brand-code-v3",
    marca,
    codigoFabricante,
    ...partesVariantes,
  ].join(":");
}

function calcularDesconto(
  oldPrice: number | null,
  price: number,
): number | null {
  if (
    oldPrice === null ||
    oldPrice <= price ||
    oldPrice <= 0
  ) {
    return null;
  }

  return Math.round(
    ((oldPrice - price) / oldPrice) * 100,
  );
}

function obterDescontoProduto(
  product: ProductImport,
): number | null {
  const calculado = calcularDesconto(
    product.oldPrice,
    product.price,
  );

  if (calculado !== null) {
    return calculado;
  }

  const informado = product.discount;

  if (
    informado === null ||
    !Number.isFinite(informado) ||
    informado <= 0 ||
    informado >= 100
  ) {
    return null;
  }

  return Math.round(informado);
}

function precoMudou(
  precoAnterior: number | null | undefined,
  precoAtual: number,
): boolean {
  if (
    precoAnterior === null ||
    precoAnterior === undefined
  ) {
    return true;
  }

  return (
    Math.abs(precoAnterior - precoAtual) >
    0.009
  );
}

function unirImagens(
  atuais: string[],
  novas: string[],
  imagemPrincipal: string,
): string[] {
  return Array.from(
    new Set(
      [
        ...atuais,
        imagemPrincipal,
        ...novas,
      ]
        .map((imagem) => imagem.trim())
        .filter(Boolean),
    ),
  );
}

export async function saveProduct(
  product: ProductImport,
  affiliateLinkOverride?: string | null,
  options: SaveProductOptions = {},
) {
  const externalId =
    product.externalId.trim();

  if (!externalId) {
    throw new Error(
      "O produto nÃ£o possui identificador externo.",
    );
  }

  if (
    !Number.isFinite(product.price) ||
    product.price <= 0
  ) {
    throw new Error(
      "O produto nÃ£o possui um preÃ§o vÃ¡lido.",
    );
  }

  const marketplace = converterMarketplace(
    product.marketplace,
  );

  const sourceUrl = product.url.trim();

  if (!sourceUrl) {
    throw new Error(
      "O produto nÃ£o possui uma URL de origem.",
    );
  }

  const linkInformado =
    affiliateLinkOverride?.trim()
      ? normalizarLinkAfiliado(
          affiliateLinkOverride,
        )
      : null;

  const identificadores =
    extrairIdentificadores(product);

  const canonicalKey = criarCanonicalKey(
    product,
    identificadores,
  );

  const slug = criarSlug(
    product.title,
    marketplace,
    externalId,
  );

  const discoverySource =
    options.discoverySource ?? "MANUAL";

  const agora = new Date();

  return prisma.$transaction(async (tx) => {
    const ofertaPeloCodigo =
      await tx.marketplaceOffer.findUnique({
        where: {
          marketplace_externalId: {
            marketplace,
            externalId,
          },
        },
        include: {
          product: true,
        },
      });

    const produtoPeloCanonicalKey =
      canonicalKey
        ? await tx.product.findUnique({
            where: {
              canonicalKey,
            },
          })
        : null;

    const marcaOriginalParaMatching =
      product.brand?.trim() || null;

    const marcaNormalizadaParaMatching =
      normalizarMarcaCanonical(product.brand);

    const marcasParaBusca = Array.from(
      new Set(
        [
          marcaOriginalParaMatching,
          marcaNormalizadaParaMatching,
        ].filter(
          (valor): valor is string =>
            Boolean(valor),
        ),
      ),
    );

    const codigoModeloParaBusca =
      identificadores.modelNumber ||
      identificadores.mpn;

    const candidatosPorIdentidade =
      !produtoPeloCanonicalKey &&
      (identificadores.mpn ||
        identificadores.modelNumber ||
        identificadores.ean ||
        identificadores.gtin)
        ? await tx.product.findMany({
            where: {
              active: true,
              OR: [
                ...marcasParaBusca.map(
                  (marca) => ({
                    brand: {
                      equals: marca,
                      mode: "insensitive" as const,
                    },
                  }),
                ),
                ...(codigoModeloParaBusca
                  ? [
                      {
                        modelNumber: {
                          equals:
                            codigoModeloParaBusca,
                          mode: "insensitive" as const,
                        },
                      },
                      {
                        mpn: {
                          equals:
                            codigoModeloParaBusca,
                          mode: "insensitive" as const,
                        },
                      },
                      {
                        name: {
                          contains:
                            codigoModeloParaBusca,
                          mode: "insensitive" as const,
                        },
                      },
                      {
                        canonicalName: {
                          contains:
                            codigoModeloParaBusca,
                          mode: "insensitive" as const,
                        },
                      },
                    ]
                  : []),
                ...(identificadores.ean
                  ? [
                      {
                        ean: identificadores.ean,
                      },
                      {
                        gtin: identificadores.ean,
                      },
                    ]
                  : []),
                ...(identificadores.gtin
                  ? [
                      {
                        gtin: identificadores.gtin,
                      },
                      {
                        ean: identificadores.gtin,
                      },
                    ]
                  : []),
              ],
            },
            take: 30,
          })
        : [];

    const candidatosExatos =
      candidatosPorIdentidade
        .map((candidato) => ({
          candidato,
          score: calcularCompatibilidadeExata(
            candidato,
            product,
            identificadores,
          ),
        }))
        .filter(
          (
            item,
          ): item is {
            candidato: typeof candidatosPorIdentidade[number];
            score: number;
          } => item.score !== null,
        );

    const produtoCompativelPorIdentidade =
      candidatosExatos.length === 1
        ? candidatosExatos[0]
        : null;

    let saved =
      ofertaPeloCodigo?.product ?? null;

    let produtoCriadoAgora = false;

    if (
      !saved &&
      marketplace === "MERCADO_LIVRE"
    ) {
      saved = await tx.product.findUnique({
        where: {
          mlId: externalId,
        },
      });
    }

    if (
      !saved &&
      options.targetProductId
    ) {
      saved = await tx.product.findUnique({
        where: {
          id: options.targetProductId,
        },
      });
    }

    if (
      !saved &&
      produtoPeloCanonicalKey
    ) {
      saved = produtoPeloCanonicalKey;
    }

    if (
      !saved &&
      produtoCompativelPorIdentidade
    ) {
      saved =
        produtoCompativelPorIdentidade.candidato;
    }

    if (!saved) {
      produtoCriadoAgora = true;

      saved = await tx.product.create({
        data: {
          mlId:
            marketplace ===
            "MERCADO_LIVRE"
              ? externalId
              : null,

          name: product.title,
          slug,

          canonicalName: product.title,
          canonicalKey,

          modelNumber:
            identificadores.modelNumber,
          ean: identificadores.ean,
          gtin: identificadores.gtin,
          mpn: identificadores.mpn,

          color: identificadores.color,
          voltage: identificadores.voltage,
          size: identificadores.size,

          image: product.image,
          images: unirImagens(
            [],
            product.images,
            product.image,
          ),

          video: null,
          brand: product.brand,
          description:
            product.description,

          specifications:
            product.attributes,

          category:
            product.category ?? "Ofertas",

          store: nomeMarketplace(
            marketplace,
          ),

          affiliateLink:
            linkInformado ?? "",

          price: product.price,
          oldPrice: product.oldPrice,
          installments:
            product.installments,
          discount:
            obterDescontoProduto(product),

          rating: product.rating,
          reviews: product.reviews,
          sales: product.sales,
          stock: product.stock,

          publicationStatus:
            linkInformado
              ? "LIVE_COMPLETE"
              : "LIVE_PARTIAL",

          autoCreated:
            options.autoCreated ?? false,

          sourceQuery:
            options.sourceQuery?.trim() ||
            null,

          lastSearchedAt:
            discoverySource ===
            "ON_DEMAND_SEARCH"
              ? agora
              : null,

          active: true,
          featured: false,
        },
      });
    } else {
      const mesmaOferta =
        ofertaPeloCodigo?.productId ===
          saved.id ||
        (marketplace ===
          "MERCADO_LIVRE" &&
          saved.mlId === externalId);

      const atualizarDadosPrincipais =
        mesmaOferta || saved.autoCreated;

      const canonicalKeyPermitida =
        !canonicalKey
          ? saved.canonicalKey
          : !produtoPeloCanonicalKey ||
              produtoPeloCanonicalKey.id ===
                saved.id
            ? canonicalKey
            : saved.canonicalKey;

      saved = await tx.product.update({
        where: {
          id: saved.id,
        },
        data: {
          mlId:
            marketplace ===
            "MERCADO_LIVRE"
              ? externalId
              : saved.mlId,

          name: atualizarDadosPrincipais
            ? product.title
            : saved.name,

          slug: saved.slug ?? slug,

          canonicalName:
            saved.canonicalName ??
            product.title,

          canonicalKey:
            canonicalKeyPermitida,

          modelNumber:
            saved.modelNumber ??
            identificadores.modelNumber,

          ean:
            saved.ean ??
            identificadores.ean,

          gtin:
            saved.gtin ??
            identificadores.gtin,

          mpn:
            saved.mpn ??
            identificadores.mpn,

          color:
            saved.color ??
            identificadores.color,

          voltage:
            saved.voltage ??
            identificadores.voltage,

          size:
            saved.size ??
            identificadores.size,

          image: atualizarDadosPrincipais
            ? product.image
            : saved.image,

          images: unirImagens(
            saved.images,
            product.images,
            product.image,
          ),

          brand:
            saved.brand ?? product.brand,

          description:
            atualizarDadosPrincipais
              ? product.description
              : saved.description ??
                product.description,

          specifications:
            atualizarDadosPrincipais
              ? product.attributes
              : undefined,

          category:
            saved.category === "Ofertas"
              ? product.category ??
                saved.category
              : saved.category,

          rating:
            atualizarDadosPrincipais
              ? product.rating
              : saved.rating,

          reviews:
            atualizarDadosPrincipais
              ? product.reviews
              : saved.reviews,

          sales:
            atualizarDadosPrincipais
              ? product.sales
              : saved.sales,

          sourceQuery:
            options.sourceQuery?.trim() ||
            saved.sourceQuery,

          lastSearchedAt:
            discoverySource ===
            "ON_DEMAND_SEARCH"
              ? agora
              : saved.lastSearchedAt,

          autoCreated:
            saved.autoCreated ||
            Boolean(options.autoCreated),

          active: true,
        },
      });
    }

    const ofertaAtual =
      ofertaPeloCodigo?.productId ===
      saved.id
        ? ofertaPeloCodigo
        : await tx.marketplaceOffer.findUnique({
            where: {
              productId_marketplace: {
                productId: saved.id,
                marketplace,
              },
            },
          });

    const linkExistente =
      ofertaAtual?.affiliateLink?.trim() ||
      null;

    const affiliateLink =
      linkInformado ?? linkExistente;

    const disponivel =
      product.stock === null ||
      product.stock > 0;

    const status =
      !disponivel
        ? "UNAVAILABLE"
        : affiliateLink
          ? "ACTIVE"
          : ofertaAtual?.status ===
              "UNDER_REVIEW"
            ? "UNDER_REVIEW"
            : "PENDING_AFFILIATE";

    const mudouPreco = precoMudou(
      ofertaAtual?.price,
      product.price,
    );

    const matchScoreExato =
      ofertaPeloCodigo
        ? 1
        : produtoCriadoAgora
          ? 1
          : produtoPeloCanonicalKey?.id ===
                saved.id
            ? 1
            : produtoCompativelPorIdentidade
                  ?.candidato.id === saved.id
              ? produtoCompativelPorIdentidade.score
              : null;

    const oferta =
      await tx.marketplaceOffer.upsert({
        where: {
          productId_marketplace: {
            productId: saved.id,
            marketplace,
          },
        },

        update: {
          externalId,
          sourceUrl,

          affiliateLink,

          title: product.title,
          image: product.image,
          seller: product.seller,

          price: product.price,
          oldPrice: product.oldPrice,
          installments:
            product.installments,
          stock: product.stock,

          status,

          matchStatus:
            matchScoreExato !== null
              ? "EXACT"
              : "HIGH",

          matchScore: matchScoreExato,

          discoverySource,

          active: true,
          available: disponivel,

          reviewReason: affiliateLink
            ? null
            : ofertaAtual?.reviewReason ??
              "Aguardando link individual de afiliado.",

          errorMessage: null,

          affiliateValidatedAt:
            linkInformado
              ? agora
              : ofertaAtual
                  ?.affiliateValidatedAt ??
                null,

          reviewedAt:
            linkInformado
              ? agora
              : ofertaAtual?.reviewedAt ??
                null,

          lastCheckedAt: agora,

          lastPriceChangeAt:
            mudouPreco
              ? agora
              : ofertaAtual
                  ?.lastPriceChangeAt ??
                null,

          consecutiveErrors: 0,
        },

        create: {
          productId: saved.id,
          marketplace,

          externalId,
          sourceUrl,

          affiliateLink,

          title: product.title,
          image: product.image,
          seller: product.seller,

          price: product.price,
          oldPrice: product.oldPrice,
          installments:
            product.installments,
          stock: product.stock,

          status,

          matchStatus:
            matchScoreExato !== null
              ? "EXACT"
              : "HIGH",

          matchScore: matchScoreExato,

          discoverySource,

          active: true,
          available: disponivel,
          isBest: false,

          reviewReason: affiliateLink
            ? null
            : "Aguardando link individual de afiliado.",

          errorMessage: null,

          affiliateValidatedAt:
            linkInformado ? agora : null,

          reviewedAt:
            linkInformado ? agora : null,

          lastCheckedAt: agora,

          lastPriceChangeAt: agora,

          consecutiveErrors: 0,
        },
      });

    const ultimoHistorico =
      await tx.priceHistory.findFirst({
        where: {
          offerId: oferta.id,
        },
        orderBy: {
          recordedAt: "desc",
        },
      });

    if (
      !ultimoHistorico ||
      precoMudou(
        ultimoHistorico.price,
        product.price,
      )
    ) {
      await tx.priceHistory.create({
        data: {
          productId: saved.id,
          offerId: oferta.id,
          marketplace,

          price: product.price,
          oldPrice: product.oldPrice,

          source: discoverySource,
        },
      });
    }

    const ofertasDoProduto =
      await tx.marketplaceOffer.findMany({
        where: {
          productId: saved.id,
          active: true,
        },
        orderBy: {
          price: "asc",
        },
      });

    const melhorOfertaEncontrada =
      ofertasDoProduto.find(
        (item) =>
          item.available &&
          item.status !== "UNAVAILABLE" &&
          item.status !== "ERROR",
      ) ?? ofertasDoProduto[0];

    /*
     * A oferta principal precisa ser comprável.
     *
     * Assim, uma oferta mais barata ainda sem link de afiliado
     * continua aparecendo no comparador como menor preço encontrado,
     * mas não substitui preço/botão principal por uma combinação
     * inconsistente.
     */
    const melhorOfertaCompravel =
      ofertasDoProduto.find(
        (item) =>
          item.available &&
          item.status === "ACTIVE" &&
          Boolean(item.affiliateLink?.trim()),
      ) ?? null;

    const melhorOfertaPrincipal =
      melhorOfertaCompravel ??
      melhorOfertaEncontrada;

    await tx.marketplaceOffer.updateMany({
      where: {
        productId: saved.id,
        isBest: true,
      },
      data: {
        isBest: false,
      },
    });

    if (melhorOfertaPrincipal) {
      await tx.marketplaceOffer.update({
        where: {
          id: melhorOfertaPrincipal.id,
        },
        data: {
          isBest: true,
        },
      });
    }

    const possuiOfertaAtiva =
      ofertasDoProduto.some(
        (item) =>
          item.status === "ACTIVE" &&
          Boolean(
            item.affiliateLink?.trim(),
          ),
      );

    const possuiOfertaPendente =
      ofertasDoProduto.some((item) =>
        [
          "DISCOVERED",
          "PENDING_AFFILIATE",
          "UNDER_REVIEW",
        ].includes(item.status),
      );

    const publicationStatus =
      possuiOfertaPendente ||
      !possuiOfertaAtiva
        ? "LIVE_PARTIAL"
        : "LIVE_COMPLETE";

    if (!melhorOfertaPrincipal) {
      return tx.product.update({
        where: {
          id: saved.id,
        },
        data: {
          publicationStatus,
          active: true,
        },
      });
    }

    return tx.product.update({
      where: {
        id: saved.id,
      },
      data: {
        store: nomeMarketplace(
          melhorOfertaPrincipal.marketplace as MarketplaceDatabase,
        ),

        affiliateLink:
          melhorOfertaPrincipal.affiliateLink?.trim() ||
          "",

        price: melhorOfertaPrincipal.price,
        oldPrice: melhorOfertaPrincipal.oldPrice,

        installments:
          melhorOfertaPrincipal.installments,

        stock: melhorOfertaPrincipal.stock,

        discount:
          melhorOfertaPrincipal.id === oferta.id
            ? obterDescontoProduto(product)
            : calcularDesconto(
                melhorOfertaPrincipal.oldPrice,
                melhorOfertaPrincipal.price,
              ),

        publicationStatus,
        active: true,
      },
    });
  });
}