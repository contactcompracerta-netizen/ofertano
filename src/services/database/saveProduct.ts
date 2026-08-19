import type { Prisma } from "@prisma/client";

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

function extrairAsinAmazon(
  externalId: string,
  sourceUrl: string,
): string | null {
  const codigo = externalId
    .trim()
    .toUpperCase();

  if (/^[A-Z0-9]{10}$/.test(codigo)) {
    return codigo;
  }

  try {
    const url = new URL(sourceUrl);
    const match = url.pathname.match(
      /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i,
    );

    return match?.[1]?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

function criarLinkAfiliadoAmazon(
  externalId: string,
  sourceUrl: string,
): string | null {
  const asin = extrairAsinAmazon(
    externalId,
    sourceUrl,
  );

  if (!asin) {
    return null;
  }

  const associateTag =
    process.env.AMAZON_ASSOCIATE_TAG?.trim() ||
    "ofertano-20";

  return (
    `https://www.amazon.com.br/dp/${asin}` +
    `/ref=nosim?tag=${encodeURIComponent(associateTag)}`
  );
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

  /*
   * Smartwatches normalmente trazem o tamanho da
   * caixa diretamente no título: 40mm, 44mm, 46mm.
   */
  const tamanhoMm = texto.match(
    /\b(\d{2})\s*MM\b/,
  );

  if (tamanhoMm?.[1]) {
    return normalizarValorVariante(
      `${tamanhoMm[1]}MM`,
    );
  }

  return null;
}

function extrairConectividadeDoTitulo(
  titulo: string,
): string | null {
  const texto = normalizarTextoIdentificador(
    titulo,
  );

  /*
   * A conectividade é uma variante crítica em
   * smartwatches. Watch Bluetooth e Watch LTE
   * podem ter o mesmo modelo, tamanho, cor e memória,
   * mas são produtos diferentes.
   */
  const pareceSmartwatch =
    /\b(?:SMARTWATCH|WATCH|RELOGIO)\b/.test(
      texto,
    );

  if (!pareceSmartwatch) {
    return null;
  }

  if (/\b(?:LTE|4G)\b/.test(texto)) {
    return "LTE";
  }

  if (/\b(?:BLUETOOTH|BT)\b/.test(texto)) {
    return "BLUETOOTH";
  }

  return null;
}

function extrairCorDoTitulo(
  titulo: string,
): string | null {
  const texto = normalizarTextoIdentificador(
    titulo,
  );

  const cores: Array<{
    padrao: RegExp;
    valor: string;
  }> = [
    {
      padrao: /\b(?:PRETO|PRETA|BLACK)\b/,
      valor: "PRETO",
    },
    {
      padrao: /\b(?:BRANCO|BRANCA|WHITE)\b/,
      valor: "BRANCO",
    },
    {
      padrao: /\b(?:CINZA|GRAY|GREY)\b/,
      valor: "CINZA",
    },
    {
      padrao: /\b(?:GRAFITE|GRAPHITE)\b/,
      valor: "GRAFITE",
    },
    {
      padrao: /\b(?:PRATA|PRATEADO|PRATEADA|SILVER)\b/,
      valor: "PRATA",
    },
    {
      padrao: /\b(?:AZUL|BLUE)\b/,
      valor: "AZUL",
    },
    {
      padrao: /\b(?:VERDE|GREEN)\b/,
      valor: "VERDE",
    },
    {
      padrao: /\b(?:VERMELHO|VERMELHA|RED)\b/,
      valor: "VERMELHO",
    },
    {
      padrao: /\b(?:ROSA|PINK)\b/,
      valor: "ROSA",
    },
    {
      padrao: /\b(?:ROXO|ROXA|PURPLE)\b/,
      valor: "ROXO",
    },
    {
      padrao: /\b(?:VIOLETA|VIOLET)\b/,
      valor: "VIOLETA",
    },
    {
      padrao: /\b(?:BEGE|BEIGE)\b/,
      valor: "BEGE",
    },
    {
      padrao: /\b(?:MARROM|BROWN)\b/,
      valor: "MARROM",
    },
    {
      padrao: /\b(?:DOURADO|DOURADA|GOLD)\b/,
      valor: "DOURADO",
    },
    {
      padrao: /\b(?:AMARELO|AMARELA|YELLOW)\b/,
      valor: "AMARELO",
    },
    {
      padrao: /\b(?:LARANJA|ORANGE)\b/,
      valor: "LARANJA",
    },
    {
      padrao: /\b(?:CREME|CREAM)\b/,
      valor: "CREME",
    },
  ];

  for (const cor of cores) {
    if (cor.padrao.test(texto)) {
      return cor.valor;
    }
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

  /*
   * Primeiro preservamos os padrões explícitos de
   * armazenamento usados em notebooks e computadores.
   */
  const numeroAntes = texto.match(
    /\b(\d{1,4})\s*(GB|TB)\s*(?:SSD|NVME|HDD)\b/,
  );

  if (numeroAntes?.[1] && numeroAntes[2]) {
    return normalizarValorVariante(
      `${numeroAntes[1]}${numeroAntes[2]}`,
    );
  }

  const tipoAntes = texto.match(
    /\b(?:SSD|NVME|HDD)\s*(?:DE\s*)?(\d{1,4})\s*(GB|TB)\b/,
  );

  if (tipoAntes?.[1] && tipoAntes[2]) {
    return normalizarValorVariante(
      `${tipoAntes[1]}${tipoAntes[2]}`,
    );
  }

  /*
   * Celulares, tablets, smartwatches e outros produtos
   * normalmente anunciam o armazenamento apenas como
   * "128GB", "256 GB", "1TB" etc.
   *
   * Ignoramos capacidades identificadas como RAM/DDR/VRAM
   * e, quando houver mais de uma capacidade genérica,
   * escolhemos a maior. Isso cobre títulos como:
   *
   * - "Galaxy S24 256GB 8GB RAM";
   * - "12GB RAM + 256GB";
   * - "Smartwatch ... 32GB".
   */
  const capacidades = Array.from(
    texto.matchAll(
      /\b(\d{1,4})\s*(GB|TB)\b/g,
    ),
  )
    .filter((encontrada) => {
      const indice = encontrada.index ?? 0;

      const antes = texto.slice(
        Math.max(0, indice - 24),
        indice,
      );

      const depois = texto.slice(
        indice + encontrada[0].length,
        indice + encontrada[0].length + 24,
      );

      const memoriaAntes =
        /(?:RAM|VRAM|DDR[345]?|LPDDR[345X]?|GDDR[3456X]?)\s*(?:DE\s*)?$/.test(
          antes,
        );

      const memoriaDepois =
        /^\s*(?:DE\s*)?(?:RAM|VRAM|DDR[345]?|LPDDR[345X]?|GDDR[3456X]?)\b/.test(
          depois,
        );

      return !memoriaAntes && !memoriaDepois;
    })
    .map((encontrada) => {
      const numero = Number(encontrada[1]);
      const unidade = encontrada[2];

      return {
        valor: `${encontrada[1]}${unidade}`,
        comparavel:
          unidade === "TB"
            ? numero * 1024
            : numero,
      };
    })
    .filter(
      (item) =>
        Number.isFinite(item.comparavel) &&
        item.comparavel > 0,
    )
    .sort(
      (primeiro, segundo) =>
        segundo.comparavel - primeiro.comparavel,
    );

  return capacidades[0]?.valor
    ? normalizarValorVariante(
        capacidades[0].valor,
      )
    : null;
}

function extrairModeloDoTitulo(
  titulo: string,
): string | null {
  const texto = normalizarTextoIdentificador(
    titulo,
  );

  const normalizarModelo = (
    valor: string,
  ): string | null =>
    normalizarCodigoProduto(
      valor
        .replace(/\+/g, "PLUS")
        .replace(/\s+/g, ""),
    );

  /*
   * Famílias populares em que o "modelo comercial"
   * não possui hífen e precisa ser preservado para
   * comparar o mesmo produto entre marketplaces.
   *
   * Os sufixos fazem parte da identidade:
   * S24, S24+, S24 Ultra e S24 FE NÃO são o mesmo modelo.
   */
  const iphone = texto.match(
    /\bIPHONE\s*(\d{1,2})(?:\s+(PRO\s+MAX|PRO|PLUS|MINI|AIR|E))?\b/,
  );

  if (iphone?.[1]) {
    return normalizarModelo(
      `IPHONE${iphone[1]}${iphone[2] ?? ""}`,
    );
  }

  const galaxyDobrav = texto.match(
    /\bGALAXY\s+Z\s+(FOLD|FLIP)\s*(\d{1,2})(?:\s+(ULTRA|FE))?\b/,
  );

  if (
    galaxyDobrav?.[1] &&
    galaxyDobrav[2]
  ) {
    return normalizarModelo(
      `Z${galaxyDobrav[1]}${galaxyDobrav[2]}${galaxyDobrav[3] ?? ""}`,
    );
  }

  const galaxyWatch = texto.match(
    /\bGALAXY\s+WATCH\s*(\d{1,2})(?:\s+(CLASSIC|ULTRA|FE))?\b/,
  );

  if (galaxyWatch?.[1]) {
    return normalizarModelo(
      `WATCH${galaxyWatch[1]}${galaxyWatch[2] ?? ""}`,
    );
  }

  const galaxy = texto.match(
    /\bGALAXY\s+([ASMZF]\d{1,3})(?:\s*(\+|PLUS|ULTRA|FE))?(?=\s|$|[,.;:/()[\]{}-])/,
  );

  if (galaxy?.[1]) {
    return normalizarModelo(
      `${galaxy[1]}${galaxy[2] ?? ""}`,
    );
  }

  const pixel = texto.match(
    /\bPIXEL\s*(\d{1,2})(?:\s+(PRO\s+XL|PRO|XL|A))?\b/,
  );

  if (pixel?.[1]) {
    return normalizarModelo(
      `PIXEL${pixel[1]}${pixel[2] ?? ""}`,
    );
  }

  const redmiNote = texto.match(
    /\bREDMI\s+NOTE\s*(\d{1,2})(?:\s+(PRO\s*\+|PRO|PLUS))?\b/,
  );

  if (redmiNote?.[1]) {
    return normalizarModelo(
      `REDMINOTE${redmiNote[1]}${redmiNote[2] ?? ""}`,
    );
  }

  const poco = texto.match(
    /\bPOCO\s+([A-Z]\d{1,2})(?:\s+(PRO|ULTRA))?\b/,
  );

  if (poco?.[1]) {
    return normalizarModelo(
      `POCO${poco[1]}${poco[2] ?? ""}`,
    );
  }

  const moto = texto.match(
    /\b(?:MOTO|MOTOROLA)\s+([GE]\d{1,3})(?:\s+(PLUS|POWER|PLAY|STYLUS))?\b/,
  );

  if (moto?.[1]) {
    return normalizarModelo(
      `${moto[1]}${moto[2] ?? ""}`,
    );
  }

  const echoDot = texto.match(
    /\bECHO\s+DOT\s+(\d{1,2})(?:\s*(?:A|ª)?\s*GERACAO)?\b/,
  );

  if (echoDot?.[1]) {
    return normalizarModelo(
      `ECHODOT${echoDot[1]}`,
    );
  }

  /*
   * Mantemos o fallback já existente para códigos
   * alfanuméricos com hífen, como E-02,
   * ANV15-52-77BG, SM-S921B etc.
   */
  const candidatosComHifen =
    texto.match(
      /\b[A-Z][A-Z0-9]{0,11}-[A-Z0-9][A-Z0-9-]{0,24}\b/g,
    ) ?? [];

  const bloqueadosComHifen = new Set([
    "WI-FI",
    "USB-C",
    "TYPE-C",
  ]);

  for (
    const candidato of candidatosComHifen
  ) {
    const codigo =
      normalizarCodigoProduto(candidato);

    if (
      codigo &&
      !bloqueadosComHifen.has(codigo) &&
      !/^\d/.test(codigo)
    ) {
      return codigo;
    }
  }

  /*
   * Último fallback: códigos curtos formados por letras
   * + números, como S24, A17, A55, G84, PS5, Watch8.
   *
   * Bloqueamos padrões técnicos que aparecem com
   * frequência em títulos mas não identificam o produto.
   */
  const candidatosSimples =
    texto.match(
      /\b[A-Z]{1,10}\d{1,5}[A-Z0-9]*\+?(?=\b|\s|$|[,.;:/()[\]{}-])/g,
    ) ?? [];

  for (
    const candidato of candidatosSimples
  ) {
    const codigo =
      normalizarModelo(candidato);

    if (!codigo) {
      continue;
    }

    const tecnico =
      /^(?:RTX|GTX|RX|ARC)\d/.test(codigo) ||
      /^(?:DDR|LPDDR|GDDR)\d/.test(codigo) ||
      /^(?:USB|HDMI|WIFI|BT|HDR|IP)\d/.test(codigo) ||
      /^(?:OLED|QLED|AMOLED)\d/.test(codigo) ||
      /^(?:SSD|HDD|NVME)\d/.test(codigo) ||
      /^\d/.test(codigo) ||
      /\d+(?:GB|TB|MB|MHZ|GHZ|W|V|MP|MAH)$/.test(
        codigo,
      );

    if (!tecnico) {
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

  if (!marca) {
    return null;
  }

  /*
   * Valores genéricos enviados por alguns feeds
   * não representam uma marca real.
   *
   * Nesses casos permitimos que a marca seja
   * inferida posteriormente pelo título.
   */
  const marcasInvalidas = new Set([
    "NAO DEFINIDO",
    "NAO INFORMADO",
    "SEM MARCA",
    "GENERICO",
    "GENERICA",
    "UNKNOWN",
    "NOT DEFINED",
    "N A",
    "N/A",
  ]);

  if (marcasInvalidas.has(marca)) {
    return null;
  }

  /*
   * Alguns marketplaces retornam a linha/família
   * junto com a marca.
   *
   * Precisamos manter a mesma marca canônica entre
   * lojas para que o mesmo produto seja agrupado.
   */
  if (marca === "SAMSUNG GALAXY") {
    return "SAMSUNG";
  }

  if (marca === "APPLE IPHONE") {
    return "APPLE";
  }

  return marca;
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

function inferirMarcaDoTitulo(
  titulo: string,
): string | null {
  const marcasConhecidas = [
    ["Samsung", "SAMSUNG"],
    ["Apple", "APPLE"],
    ["iPhone", "APPLE"],
    ["Xiaomi", "XIAOMI"],
    ["Motorola", "MOTOROLA"],
    ["Lenovo", "LENOVO"],
    ["Acer", "ACER"],
    ["Asus", "ASUS"],
    ["Dell", "DELL"],
    ["HP", "HP"],
    ["LG", "LG"],
    ["Sony", "SONY"],
    ["Philips", "PHILIPS"],
    ["TCL", "TCL"],
    ["Hisense", "HISENSE"],
    ["Realme", "REALME"],
    ["Positivo", "POSITIVO"],
    ["JBL", "JBL"],
    ["Electrolux", "ELECTROLUX"],
    ["Brastemp", "BRASTEMP"],
    ["Consul", "CONSUL"],
    ["Mondial", "MONDIAL"],
    ["Philco", "PHILCO"],
    ["Midea", "MIDEA"],
  ] as const;

  for (
    const [
      termo,
      marcaCanonical,
    ] of marcasConhecidas
  ) {
    if (
      tituloContemMarca(
        titulo,
        termo,
      )
    ) {
      return marcaCanonical;
    }
  }

  return null;
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

  const color =
    normalizarValorVariante(
      corEncontrada,
    ) ??
    extrairCorDoTitulo(product.title);

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

  const connectivity =
    extrairConectividadeDoTitulo(
      product.title,
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
    connectivity,
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
      ) ??
      extrairCorDoTitulo(titulo),
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
    connectivity:
      extrairConectividadeDoTitulo(
        titulo,
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
    [identificadores.connectivity, existente.connectivity],
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

  /*
   * Cor é uma variante forte.
   *
   * Se apenas um dos lados informa a cor,
   * não assumimos que sejam a mesma variante.
   *
   * Isso evita, por exemplo, que um iPhone sem
   * cor identificada contamine posteriormente
   * um Product Azul, Preto ou Rosa.
   */
  if (
    Boolean(identificadores.color) !==
    Boolean(existente.color)
  ) {
    return null;
  }

  if (
    identificadores.color &&
    existente.color &&
    identificadores.color !== existente.color
  ) {
    return null;
  }

  /*
   * Para smartwatch, se apenas um lado informa a
   * conectividade, não assumimos equivalência.
   */
  if (
    Boolean(identificadores.connectivity) !==
    Boolean(existente.connectivity)
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
    identificadores.connectivity,
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
    identificadores.connectivity
      ? `connectivity=${identificadores.connectivity}`
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


type SincronizarMelhorOfertaOptions = {
  ofertaIdComDesconto?: string | null;
  descontoDaOferta?: number | null;
};

/**
 * Mantém os campos legados de Product sincronizados com a oferta
 * principal real do comparador.
 *
 * Regra central:
 * - somente ofertas EXACT podem virar oferta principal;
 * - entre as EXACT, a menor oferta ACTIVE + available + com link
 *   individual é a principal comprável;
 * - se ainda não houver oferta comprável, mantemos como referência
 *   a menor EXACT encontrada e deixamos o produto LIVE_PARTIAL;
 * - ofertas HIGH/REVIEW/REJECTED nunca recebem isBest nem assumem
 *   store, price ou affiliateLink do Product.
 *
 * Esta função também deve ser usada por fluxos que alterem uma
 * MarketplaceOffer sem passar pelo saveProduct.
 */
export async function sincronizarMelhorOfertaDoProduto(
  tx: Prisma.TransactionClient,
  productId: string,
  options: SincronizarMelhorOfertaOptions = {},
) {
  const ofertasExatas =
    await tx.marketplaceOffer.findMany({
      where: {
        productId,
        active: true,
        matchStatus: "EXACT",
      },
      orderBy: {
        price: "asc",
      },
    });

  const melhorOfertaEncontrada =
    ofertasExatas.find(
      (item) =>
        item.available &&
        item.status !== "UNAVAILABLE" &&
        item.status !== "ERROR" &&
        Number.isFinite(item.price) &&
        item.price > 0,
    ) ?? null;

  const melhorOfertaCompravel =
    ofertasExatas.find(
      (item) =>
        item.available &&
        item.status === "ACTIVE" &&
        Number.isFinite(item.price) &&
        item.price > 0 &&
        Boolean(item.affiliateLink?.trim()),
    ) ?? null;

  const melhorOfertaPrincipal =
    melhorOfertaCompravel ??
    melhorOfertaEncontrada;

  await tx.marketplaceOffer.updateMany({
    where: {
      productId,
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
    ofertasExatas.some(
      (item) =>
        item.available &&
        item.status === "ACTIVE" &&
        Number.isFinite(item.price) &&
        item.price > 0 &&
        Boolean(item.affiliateLink?.trim()),
    );

  const possuiOfertaPendente =
    ofertasExatas.some((item) =>
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
        id: productId,
      },
      data: {
        publicationStatus,
        active: true,
      },
    });
  }

  const descontoCalculado =
    melhorOfertaPrincipal.id ===
      options.ofertaIdComDesconto &&
    options.descontoDaOferta !== undefined
      ? options.descontoDaOferta
      : calcularDesconto(
          melhorOfertaPrincipal.oldPrice,
          melhorOfertaPrincipal.price,
        );

  return tx.product.update({
    where: {
      id: productId,
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

      discount: descontoCalculado,

      publicationStatus,
      active: true,
    },
  });
}

export async function corrigirLinksAmazonPendentes(
  limite = 25,
): Promise<number> {
  const quantidade = Math.min(
    Math.max(
      Math.trunc(limite),
      1,
    ),
    100,
  );

  const ofertas =
    await prisma.marketplaceOffer.findMany({
      where: {
        marketplace: "AMAZON",
        externalId: {
          not: null,
        },
        OR: [
          {
            affiliateLink: null,
          },
          {
            affiliateLink: "",
          },
        ],
      },
      orderBy: {
        updatedAt: "asc",
      },
      take: quantidade,
      select: {
        id: true,
        productId: true,
        externalId: true,
        sourceUrl: true,
        active: true,
        available: true,
      },
    });

  let corrigidos = 0;

  for (const oferta of ofertas) {
    const externalId =
      oferta.externalId?.trim();

    if (!externalId) {
      continue;
    }

    const affiliateLink =
      criarLinkAfiliadoAmazon(
        externalId,
        oferta.sourceUrl ?? "",
      );

    if (!affiliateLink) {
      continue;
    }

    const agora = new Date();

    await prisma.$transaction(
      async (tx) => {
        await tx.marketplaceOffer.update({
          where: {
            id: oferta.id,
          },
          data: {
            affiliateLink,
            status:
              oferta.active &&
              oferta.available
                ? "ACTIVE"
                : undefined,
            reviewReason: null,
            errorMessage: null,
            affiliateValidatedAt: agora,
            reviewedAt: agora,
          },
        });

        await sincronizarMelhorOfertaDoProduto(
          tx,
          oferta.productId,
        );
      },
    );

    corrigidos += 1;
  }

  return corrigidos;
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

  const linkAmazonAutomatico =
    marketplace === "AMAZON"
      ? criarLinkAfiliadoAmazon(
          externalId,
          sourceUrl,
        )
      : null;

  const linkOriginal =
    affiliateLinkOverride?.trim() ||
    product.affiliateLink?.trim() ||
    null;

  const linkInformado =
    linkAmazonAutomatico ||
    (linkOriginal
      ? normalizarLinkAfiliado(
          linkOriginal,
        )
      : null);

  /*
   * Alguns marketplaces, principalmente em resultados
   * de Discovery, podem não preencher product.brand.
   *
   * Quando isso ocorrer, usamos uma marca reconhecida
   * diretamente no título.
   *
   * Exemplo:
   * "Smartwatch Samsung Galaxy Watch8..."
   * -> brand = Samsung
   */
  const marcaEfetiva =
    normalizarMarcaCanonical(
      product.brand,
    ) ||
    inferirMarcaDoTitulo(
      product.title,
    );

  const productComMarca: ProductImport =
    marcaEfetiva
      ? {
          ...product,
          brand: marcaEfetiva,
        }
      : product;

  const identificadores =
    extrairIdentificadores(
      productComMarca,
    );

  const canonicalKey = criarCanonicalKey(
    productComMarca,
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
      productComMarca.brand?.trim() || null;

    const marcaNormalizadaParaMatching =
      normalizarMarcaCanonical(
        productComMarca.brand,
      );

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
          brand: productComMarca.brand,
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

      /*
       * Uma identidade canônica já estabelecida deve
       * permanecer estável.
       *
       * Ofertas posteriores podem trazer menos dados
       * ou atributos que não representam uma variante
       * real do produto, como tamanho de tela.
       *
       * Portanto:
       * - Product sem canonicalKey pode receber uma;
       * - Product com canonicalKey mantém a original.
       */
      const canonicalKeyPermitida =
        saved.canonicalKey ??
        (
          canonicalKey &&
          (
            !produtoPeloCanonicalKey ||
            produtoPeloCanonicalKey.id ===
              saved.id
          )
            ? canonicalKey
            : null
        );

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
            saved.brand ??
            productComMarca.brand,

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

    return sincronizarMelhorOfertaDoProduto(
      tx,
      saved.id,
      {
        ofertaIdComDesconto: oferta.id,
        descontoDaOferta:
          obterDescontoProduto(product),
      },
    );
  });
}


