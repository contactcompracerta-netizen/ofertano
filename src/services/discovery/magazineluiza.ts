import type {
    DiscoveryCandidate,
    DiscoveryQuery,
    MarketplaceDiscoveryResult,
  } from "./core/types";
  import { ehAcessorioNaoSolicitadoPelaConsulta } from "@/services/identity";
  import { abortableFetch } from "@/lib/searchAbort";
  import {
    classificarMensagemAquisicao,
    montarDiscoveryResult,
    type AcquisitionStatus,
  } from "./acquisitionOutcome";
  
  const MARKETPLACE = "MAGAZINE_LUIZA" as const;
  const MARKETPLACE_NAME = "Magazine Luiza" as const;
  
  const MAGAZINE_VOCE_HOST =
    "www.magazinevoce.com.br";
  
  const MAGAZINE_VOCE_STORE =
    "magazineofertanobr";
  
  const TIMEOUT_MS = 25_000;
  
  const TERMOS_ACESSORIOS = [
    "capa",
    "capas",
    "capinha",
    "capinhas",
    "case",
    "cases",
    "pelicula",
    "peliculas",
    "vidro",
    "cabo",
    "cabos",
    "carregador",
    "carregadores",
    "fonte",
    "fontes",
    "adaptador",
    "adaptadores",
    "suporte",
    "suportes",
    "base",
    "bases",
    "stand",
    "stands",
    "pedestal",
    "pedestais",
    "protetor",
    "protetores",
    "bumper",
    "skin",
    "adesivo",
    "adesivos",
    "borracha",
    "borrachas",
    "vedacao",
    "vedacoes",
    "anel de vedacao",
    "aneis de vedacao",
    "anel",
    "aneis",
    "pino",
    "pinos",
    "peso",
    "pesos",
    "peso regulador",
    "pesos reguladores",
    "regulador",
    "reguladores",
    "valvula",
    "valvulas",
    "gaxeta",
    "gaxetas",
    "guarnicao",
    "guarnicoes",
    "reparo",
    "reparos",
    "kit reparo",
    "kit de reparo",
    "reposicao",
    "reposicoes",
    "peca de reposicao",
    "pecas de reposicao",
    "tampa",
    "tampas",
    "alca",
    "alcas",
    "antena",
    "antenas",
    "controle remoto",
    "controles remotos",
    "remote control",
    "remote controls",
    "soundbar",
    "sound bar",
    "barra de som",
  ];
  
  const TERMOS_CONDICAO_NAO_NOVA = [
    "usado",
    "usada",
    "usados",
    "usadas",
    "seminovo",
    "seminova",
    "seminovos",
    "seminovas",
    "recondicionado",
    "recondicionada",
    "recondicionados",
    "recondicionadas",
    "refurbished",
    "renewed",
    "open box",
  ];
  
  const TERMOS_BUNDLE = [
    "kit",
    "combo",
    "bundle",
    "conjunto",
  ];
  
  const FAMILIAS_VARIANTE_ESTRITA = [
    "iphone",
    "galaxy",
    "redmi",
    "poco",
    "moto g",
    "moto e",
    "moto edge",
    "macbook",
    "ipad",
    "echo dot",
    "echo show",
    "echo pop",
  ];
  
  const QUALIFICADORES_MODELO = [
    "pro max",
    "pro",
    "max",
    "plus",
    "mini",
    "air",
    "ultra",
    "lite",
    "fe",
  ];
  
  const MARCAS_CONHECIDAS = [
    "samsung",
    "lg",
    "apple",
    "motorola",
    "xiaomi",
    "redmi",
    "poco",
    "sony",
    "philips",
    "tcl",
    "hisense",
    "panasonic",
    "jbl",
    "lenovo",
    "asus",
    "acer",
    "dell",
    "hp",
    "electrolux",
    "brastemp",
    "consul",
    "mondial",
    "philco",
  ];
  
  type MagazineVoceBrand = {
    label?: string;
    slug?: string;
  };
  
  type MagazineVoceCategory = {
    id?: string;
    name?: string;
  };
  
  type MagazineVocePrice = {
    bestPrice?: string | number;
    fullPrice?: string | number;
    price?: string | number;
    currency?: string;
    discount?: string | number;
    paymentMethodDescription?: string;
  };
  
  type MagazineVoceSeller = {
    id?: string;
    sku?: string;
    description?: string;
  
    details?: {
      totalSales?: string | number;
    };
  };
  
  type MagazineVoceAttribute = {
    label?: string;
    type?: string;
    current?: string;
    value?: string;
  };

  type MagazineVoceProduct = {
    id?: string | number;
    variationId?: string | number;
    title?: string;
    url?: string;
    path?: string;
    image?: string;
    available?: boolean;

    brand?:
      | MagazineVoceBrand
      | string;

    category?:
      | MagazineVoceCategory
      | string;

    price?: MagazineVocePrice;
    seller?: MagazineVoceSeller;
    attributes?: MagazineVoceAttribute[];
  };
  
  type MagazineVoceResponse = {
    pageProps?: {
      data?: {
        search?: {
          products?: MagazineVoceProduct[];
        };
      };
    };

    props?: {
      pageProps?: {
        data?: {
          search?: {
            products?: MagazineVoceProduct[];
          };
        };
      };
    };
  
    __N_SSP?: boolean;
  };
  
  function limitarQuantidade(
    valor: number,
  ): number {
    if (!Number.isFinite(valor)) {
      return 5;
    }
  
    return Math.min(
      Math.max(
        Math.trunc(valor),
        1,
      ),
      20,
    );
  }
  
  function normalizarTexto(
    valor: string,
  ): string {
    return valor
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        "",
      )
      .toLowerCase()
      .replace(
        /([a-z])(\d)/g,
        "$1 $2",
      )
      .replace(
        /(\d)([a-z])/g,
        "$1 $2",
      )
      .replace(
        /[^a-z0-9]+/g,
        " ",
      )
      .trim()
      .replace(/\s+/g, " ");
  }
  
  function contemExpressao(
    textoNormalizado: string,
    expressao: string,
  ): boolean {
    return (
      ` ${textoNormalizado} `
    ).includes(
      ` ${normalizarTexto(
        expressao,
      )} `,
    );
  }
  
  function calcularRelevancia(
    titulo: string,
    consulta: string,
  ): number {
    const tituloNormalizado =
      normalizarTexto(titulo);
  
    const termos =
      Array.from(
        new Set(
          normalizarTexto(consulta)
            .split(" ")
            .filter(
              (termo) =>
                termo.length >= 2 ||
                /^\d+$/.test(
                  termo,
                ),
            ),
        ),
      );
  
    if (termos.length === 0) {
      return 0;
    }
  
    const tokensTitulo =
      new Set(
        tituloNormalizado.split(" "),
      );
  
    const encontrados =
      termos.filter(
        (termo) =>
          tokensTitulo.has(
            termo,
          ),
      ).length;
  
    return (
      encontrados /
      termos.length
    );
  }
  
  function possuiAcessorioNaoSolicitado(
    titulo: string,
    consulta: string,
  ): boolean {
    if (ehAcessorioNaoSolicitadoPelaConsulta(consulta, titulo)) {
      return true;
    }

    const tituloNormalizado =
      normalizarTexto(titulo);
  
    const consultaNormalizada =
      normalizarTexto(consulta);
  
    return TERMOS_ACESSORIOS.some(
      (termo) =>
        contemExpressao(
          tituloNormalizado,
          termo,
        ) &&
        !contemExpressao(
          consultaNormalizada,
          termo,
        ),
    );
  }
  
  function possuiCondicaoNaoNova(
    titulo: string,
  ): boolean {
    const normalizado =
      normalizarTexto(titulo);
  
    return TERMOS_CONDICAO_NAO_NOVA.some(
      (termo) =>
        contemExpressao(
          normalizado,
          termo,
        ),
    );
  }
  
  function possuiBundleNaoSolicitado(
    titulo: string,
    consulta: string,
  ): boolean {
    const tituloNormalizado =
      normalizarTexto(titulo);
  
    const consultaNormalizada =
      normalizarTexto(consulta);
  
    return TERMOS_BUNDLE.some(
      (termo) =>
        contemExpressao(
          tituloNormalizado,
          termo,
        ) &&
        !contemExpressao(
          consultaNormalizada,
          termo,
        ),
    );
  }
  
  function marcaCompativel(
    titulo: string,
    consulta: string,
  ): boolean {
    const consultaNormalizada =
      normalizarTexto(consulta);
  
    const tituloNormalizado =
      normalizarTexto(titulo);
  
    const marcasSolicitadas =
      MARCAS_CONHECIDAS.filter(
        (marca) =>
          contemExpressao(
            consultaNormalizada,
            marca,
          ),
      );
  
    if (
      marcasSolicitadas.length === 0
    ) {
      return true;
    }
  
    return marcasSolicitadas.every(
      (marca) =>
        contemExpressao(
          tituloNormalizado,
          marca,
        ),
    );
  }
  
  function usaFamiliaComVarianteEstrita(
    consulta: string,
  ): boolean {
    const normalizado =
      normalizarTexto(consulta);
  
    return FAMILIAS_VARIANTE_ESTRITA.some(
      (familia) =>
        normalizado.includes(
          normalizarTexto(
            familia,
          ),
        ),
    );
  }
  
  function extrairQualificadoresModelo(
    valor: string,
  ): Set<string> {
    const texto =
      ` ${normalizarTexto(valor)} `;
  
    const encontrados =
      new Set<string>();
  
    if (
      texto.includes(
        " pro max ",
      )
    ) {
      encontrados.add(
        "pro max",
      );
    } else {
      if (
        texto.includes(
          " pro ",
        )
      ) {
        encontrados.add(
          "pro",
        );
      }
  
      if (
        texto.includes(
          " max ",
        )
      ) {
        encontrados.add(
          "max",
        );
      }
    }
  
    for (
      const qualificador of
      QUALIFICADORES_MODELO
    ) {
      if (
        qualificador ===
          "pro max" ||
        qualificador ===
          "pro" ||
        qualificador ===
          "max"
      ) {
        continue;
      }
  
      if (
        texto.includes(
          ` ${qualificador} `,
        )
      ) {
        encontrados.add(
          qualificador,
        );
      }
    }
  
    return encontrados;
  }
  
  function conjuntosIguais(
    primeiro: Set<string>,
    segundo: Set<string>,
  ): boolean {
    if (
      primeiro.size !==
      segundo.size
    ) {
      return false;
    }
  
    for (
      const valor of primeiro
    ) {
      if (
        !segundo.has(valor)
      ) {
        return false;
      }
    }
  
    return true;
  }
  
  function varianteCompativel(
    titulo: string,
    consulta: string,
  ): boolean {
    if (
      !usaFamiliaComVarianteEstrita(
        consulta,
      )
    ) {
      return true;
    }
  
    return conjuntosIguais(
      extrairQualificadoresModelo(
        consulta,
      ),
      extrairQualificadoresModelo(
        titulo,
      ),
    );
  }
  
  function extrairCodigosModelo(
    valor: string,
  ): Set<string> {
    const texto =
      valor
        .normalize("NFD")
        .replace(
          /[\u0300-\u036f]/g,
          "",
        )
        .toLowerCase();
  
    const encontrados =
      new Set<string>();
  
    const prefixosIgnorados =
      new Set([
        "ram",
        "rom",
        "tela",
        "display",
        "camera",
        "bateria",
        "memoria",
      ]);
  
    const regex =
      /\b([a-z]{1,12})\s*[-]?\s*(\d{1,4}[a-z]?)(\s*\+|\s+plus\b)?/gi;
  
    for (
      const match of texto.matchAll(
        regex,
      )
    ) {
      const prefixo =
        match[1]
          ?.trim()
          .toLowerCase();
  
      const numero =
        match[2]
          ?.trim()
          .toLowerCase();
  
      if (
        !prefixo ||
        !numero ||
        prefixosIgnorados.has(
          prefixo,
        )
      ) {
        continue;
      }
  
      const sufixoPlus =
        Boolean(
          match[3]?.trim(),
        );
  
      encontrados.add(
        `${prefixo}${numero}${
          sufixoPlus
            ? "+"
            : ""
        }`,
      );
    }
  
    return encontrados;
  }
  
  function modeloCompativel(
    titulo: string,
    consulta: string,
  ): boolean {
    const referencia =
      extrairCodigosModelo(
        consulta,
      );
  
    if (
      referencia.size === 0
    ) {
      return true;
    }
  
    const candidato =
      extrairCodigosModelo(
        titulo,
      );
  
    for (
      const codigo of referencia
    ) {
      if (
        !candidato.has(
          codigo,
        )
      ) {
        return false;
      }
    }
  
    return true;
  }
  
  function extrairCapacidades(
    valor: string,
  ): Set<string> {
    const normalizado =
      normalizarTexto(valor);
  
    const encontrados =
      new Set<string>();
  
    const regex =
      /\b(\d+(?:[.,]\d+)?)\s*(gb|tb)\b/gi;
  
    for (
      const match of normalizado.matchAll(
        regex,
      )
    ) {
      const numero =
        match[1]
          ?.replace(",", ".")
          .trim();
  
      const unidade =
        match[2]
          ?.toLowerCase()
          .trim();
  
      if (
        numero &&
        unidade
      ) {
        encontrados.add(
          `${numero}${unidade}`,
        );
      }
    }
  
    return encontrados;
  }
  
  function extrairCapacidadesRam(
    valor: string,
  ): Set<string> {
    const normalizado =
      normalizarTexto(valor);
  
    const encontrados =
      new Set<string>();
  
    const regex =
      /\b(\d+(?:[.,]\d+)?)\s*(gb|tb)\b/gi;
  
    for (
      const match of normalizado.matchAll(
        regex,
      )
    ) {
      const inicio =
        match.index ?? 0;
  
      const fim =
        inicio +
        match[0].length;
  
      const antes =
        normalizado.slice(
          Math.max(
            0,
            inicio - 24,
          ),
          inicio,
        );
  
      const depois =
        normalizado.slice(
          fim,
          Math.min(
            normalizado.length,
            fim + 24,
          ),
        );
  
      const ramAntes =
        /(?:^|\s)(?:memoria\s+)?ram(?:\s+de)?\s*$/.test(
          antes,
        );
  
      const ramDepois =
        /^\s*(?:de\s+)?ram(?:\s|$)/.test(
          depois,
        );
  
      if (
        !ramAntes &&
        !ramDepois
      ) {
        continue;
      }
  
      const numero =
        match[1]
          ?.replace(",", ".")
          .trim();
  
      const unidade =
        match[2]
          ?.toLowerCase()
          .trim();
  
      if (
        numero &&
        unidade
      ) {
        encontrados.add(
          `${numero}${unidade}`,
        );
      }
    }
  
    return encontrados;
  }
  
  function capacidadeCompativel(
    titulo: string,
    consulta: string,
  ): boolean {
    const referencia =
      extrairCapacidades(
        consulta,
      );
  
    if (
      referencia.size === 0
    ) {
      return true;
    }
  
    const candidato =
      extrairCapacidades(
        titulo,
      );
  
    if (
      candidato.size === 0
    ) {
      return false;
    }
  
    if (
      conjuntosIguais(
        referencia,
        candidato,
      )
    ) {
      return true;
    }
  
    for (
      const capacidade of referencia
    ) {
      if (
        !candidato.has(
          capacidade,
        )
      ) {
        return false;
      }
    }
  
    const capacidadesRam =
      extrairCapacidadesRam(
        titulo,
      );
  
    for (
      const capacidade of candidato
    ) {
      if (
        referencia.has(
          capacidade,
        )
      ) {
        continue;
      }
  
      if (
        !capacidadesRam.has(
          capacidade,
        )
      ) {
        return false;
      }
    }
  
    return true;
  }
  
  function converterPreco(
    valor:
      | string
      | number
      | null
      | undefined,
  ): number | null {
    if (
      typeof valor === "number"
    ) {
      return (
        Number.isFinite(valor) &&
        valor > 0
      )
        ? valor
        : null;
    }
  
    if (
      typeof valor !== "string"
    ) {
      return null;
    }
  
    let texto =
      valor
        .trim()
        .replace(
          /[^\d,.-]/g,
          "",
        );
  
    if (!texto) {
      return null;
    }
  
    const ultimaVirgula =
      texto.lastIndexOf(",");
  
    const ultimoPonto =
      texto.lastIndexOf(".");
  
    if (
      ultimaVirgula >= 0 &&
      ultimoPonto >= 0
    ) {
      if (
        ultimaVirgula >
        ultimoPonto
      ) {
        texto =
          texto
            .replace(/\./g, "")
            .replace(",", ".");
      } else {
        texto =
          texto.replace(/,/g, "");
      }
    } else if (
      ultimaVirgula >= 0
    ) {
      texto =
        texto.replace(",", ".");
    }
  
    const numero =
      Number(texto);
  
    return (
      Number.isFinite(numero) &&
      numero > 0
    )
      ? numero
      : null;
  }
  
  function obterPreco(
    produto: MagazineVoceProduct,
  ): number | null {
    const preco =
      produto.price;
  
    if (!preco) {
      return null;
    }
  
    return (
      converterPreco(
        preco.bestPrice,
      ) ??
      converterPreco(
        preco.fullPrice,
      ) ??
      converterPreco(
        preco.price,
      )
    );
  }
  
  function obterPrecoAnterior(
    produto: MagazineVoceProduct,
    precoAtual: number,
  ): number | null {
    const fullPrice =
      converterPreco(
        produto.price?.fullPrice,
      );
  
    if (
      fullPrice &&
      fullPrice > precoAtual
    ) {
      return fullPrice;
    }
  
    const price =
      converterPreco(
        produto.price?.price,
      );
  
    if (
      price &&
      price > precoAtual
    ) {
      return price;
    }
  
    return null;
  }
  
  function obterMarca(
    produto: MagazineVoceProduct,
  ): string | null {
    if (
      typeof produto.brand ===
      "string"
    ) {
      return (
        produto.brand.trim() ||
        null
      );
    }
  
    return (
      produto.brand
        ?.label
        ?.trim() ||
      null
    );
  }
  
  function obterCategoria(
    produto: MagazineVoceProduct,
  ): string | null {
    if (
      typeof produto.category ===
      "string"
    ) {
      return (
        produto.category.trim() ||
        null
      );
    }
  
    return (
      produto.category
        ?.name
        ?.trim() ||
      null
    );
  }

  export function obterAtributosMagazineLuiza(
    produto: MagazineVoceProduct,
  ): Record<string, string> {
    const atributos: Record<string, string> = {};

    if (!Array.isArray(produto.attributes)) {
      return atributos;
    }

    for (const item of produto.attributes) {
      const chave = item.label?.trim() || item.type?.trim();
      const valor = item.current?.trim() || item.value?.trim();

      if (chave && valor) {
        atributos[chave] = valor;
      }
    }

    return atributos;
  }
  
  function normalizarImagem(
    rawUrl:
      | string
      | null
      | undefined,
  ): string | null {
    const valor =
      rawUrl?.trim();
  
    if (!valor) {
      return null;
    }
  
    const url =
      valor
        .replace(
          "{w}",
          "600",
        )
        .replace(
          "{h}",
          "600",
        );
  
    try {
      const parsed =
        new URL(url);
  
      if (
        parsed.protocol !==
          "https:" &&
        parsed.protocol !==
          "http:"
      ) {
        return null;
      }
  
      return url;
    } catch {
      return null;
    }
  }
  
  function caminhoProdutoSemLoja(
    pathname: string,
  ): string {
    const tinhaBarraFinal =
      pathname.endsWith("/") && pathname !== "/";
    const partes = pathname
      .split("/")
      .filter(Boolean);

    if (
      partes[0]?.toLowerCase() ===
      MAGAZINE_VOCE_STORE
    ) {
      partes.shift();
    }

    const caminho = `/${partes.join("/")}`;
    return tinhaBarraFinal && caminho !== "/"
      ? `${caminho}/`
      : caminho;
  }

  export function criarUrlPublicaMagazineLuiza(
    rawUrl: string | null | undefined,
  ): string | null {
    const valor = rawUrl?.trim();

    if (!valor) {
      return null;
    }

    try {
      const url = /^https?:\/\//i.test(valor)
        ? new URL(valor)
        : new URL(
            valor.startsWith("/")
              ? `https://${MAGAZINE_VOCE_HOST}${valor}`
              : `https://${MAGAZINE_VOCE_HOST}/${valor}`,
          );

      const caminho = caminhoProdutoSemLoja(url.pathname);

      if (caminho === "/") {
        return null;
      }

      return `https://www.magazineluiza.com.br${caminho}${url.search}`;
    } catch {
      return null;
    }
  }

  export function criarUrlAfiliadaMagazineLuiza(
    rawUrl: string | null | undefined,
  ): string | null {
    const valor = rawUrl?.trim();

    if (!valor) {
      return null;
    }

    try {
      const url = /^https?:\/\//i.test(valor)
        ? new URL(valor)
        : new URL(
            valor.startsWith("/")
              ? `https://${MAGAZINE_VOCE_HOST}${valor}`
              : `https://${MAGAZINE_VOCE_HOST}/${valor}`,
          );

      const caminho = caminhoProdutoSemLoja(url.pathname);

      if (caminho === "/") {
        return null;
      }

      return `https://${MAGAZINE_VOCE_HOST}/${MAGAZINE_VOCE_STORE}${caminho}${url.search}`;
    } catch {
      return null;
    }
  }
  
  function extrairCodigoDaUrl(
    rawUrl:
      | string
      | null,
  ): string | null {
    if (!rawUrl) {
      return null;
    }
  
    try {
      const url =
        new URL(rawUrl);
  
      return (
        url.pathname.match(
          /\/p\/([^/?#]+)(?:\/|$)/i,
        )?.[1]?.trim() ||
        null
      );
    } catch {
      return null;
    }
  }
  
  function obterExternalId(
    produto: MagazineVoceProduct,
    sourceUrl: string | null,
    affiliateLink: string | null,
  ): string | null {
    const variationId =
      String(
        produto.variationId ??
          "",
      ).trim();
  
    if (variationId) {
      return variationId;
    }
  
    const codigoUrl =
      extrairCodigoDaUrl(affiliateLink) ||
      extrairCodigoDaUrl(sourceUrl);
  
    if (codigoUrl) {
      return codigoUrl;
    }
  
    const id =
      String(
        produto.id ??
          "",
      ).trim();
  
    return id || null;
  }
  
  function obterVendas(
    produto: MagazineVoceProduct,
  ): number {
    const valor =
      Number(
        produto.seller
          ?.details
          ?.totalSales ??
        0,
      );
  
    return (
      Number.isFinite(valor) &&
      valor > 0
    )
      ? valor
      : 0;
  }
  
  
let magazineLuizaBuildIdCache:
  string | null = null;

function validarBuildId(
  valor:
    string |
    null |
    undefined,
): string | null {
  const buildId =
    valor?.trim() ?? "";

  if (
    !buildId ||
    !/^[A-Za-z0-9_-]+$/.test(
      buildId,
    )
  ) {
    return null;
  }

  return buildId;
}

function obterBuildIdInicial():
  string | null {
  if (
    magazineLuizaBuildIdCache
  ) {
    return magazineLuizaBuildIdCache;
  }

  const buildId =
    validarBuildId(
      process.env
        .MAGAZINE_LUIZA_BUILD_ID,
    );

  if (buildId) {
    magazineLuizaBuildIdCache =
      buildId;
  }

  return buildId;
}

async function descobrirBuildIdAtual():
  Promise<string> {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      TIMEOUT_MS,
    );

  try {
    const url =
      `https://${MAGAZINE_VOCE_HOST}/${MAGAZINE_VOCE_STORE}/`;

    const response =
      await abortableFetch(
        url,
        {
          method: "GET",

          cache:
            "no-store",

          redirect:
            "follow",

          headers: {
            Accept:
              "text/html,application/xhtml+xml",

            "Accept-Language":
              "pt-BR,pt;q=0.9,en;q=0.8",

            "Cache-Control":
              "no-cache",

            Pragma:
              "no-cache",

            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
          },

          signal:
            controller.signal,
        },
      );

    if (!response.ok) {
      throw new Error(
        `Magazine Luiza: n?o foi poss?vel descobrir o buildId atual. HTTP ${response.status}.`,
      );
    }

    const html =
      await response.text();

    /*
     * Fonte principal:
     * __NEXT_DATA__ da aplica??o Next.js.
     */
    const nextDataMatch =
      html.match(
        /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
      );

    if (
      nextDataMatch?.[1]
    ) {
      try {
        const nextData =
          JSON.parse(
            nextDataMatch[1],
          ) as {
            buildId?:
              string;
          };

        const buildId =
          validarBuildId(
            nextData.buildId,
          );

        if (buildId) {
          magazineLuizaBuildIdCache =
            buildId;

          return buildId;
        }
      } catch {
        /*
         * Se o JSON mudar, tentamos os manifests
         * est?ticos abaixo.
         */
      }
    }

    /*
     * Fallback:
     * o buildId tamb?m costuma aparecer nas URLs
     * dos manifests est?ticos do Next.js.
     */
    const manifestMatch =
      html.match(
        /\/_next\/static\/([^/"']+)\/(?:_buildManifest|_ssgManifest)\.js/i,
      );

    const buildId =
      validarBuildId(
        manifestMatch?.[1],
      );

    if (buildId) {
      magazineLuizaBuildIdCache =
        buildId;

      return buildId;
    }

    throw new Error(
      "Magazine Luiza: n?o foi poss?vel identificar automaticamente o buildId atual.",
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.name ===
        "AbortError"
    ) {
      throw new Error(
        "A descoberta do buildId do Magazine Luiza ultrapassou 25 segundos.",
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function criarUrlBusca(
    query: string,
    buildId: string,
  ): URL {
    const termo =
      query.trim();
  
    const segmento =
      encodeURIComponent(
        termo,
      );
  
    const url =
      new URL(
        `https://${MAGAZINE_VOCE_HOST}/_next/data/${encodeURIComponent(
          buildId,
        )}/${MAGAZINE_VOCE_STORE}/busca/${segmento}.json`,
      );
  
    url.searchParams.set(
      "path0",
      MAGAZINE_VOCE_STORE,
    );
  
    url.searchParams.set(
      "path2",
      termo,
    );
  
    return url;
  }

export function extrairProdutosMagazineLuiza(
  payload: unknown,
): MagazineVoceProduct[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const root = payload as MagazineVoceResponse;
  const candidates = [
    root.pageProps?.data?.search?.products,
    root.props?.pageProps?.data?.search?.products,
  ];

  for (const produtos of candidates) {
    if (Array.isArray(produtos)) {
      return produtos;
    }
  }

  return null;
}

export function classificarPaginaMagazineLuiza(
  html: string,
  httpStatus: number,
): AcquisitionStatus {
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
    return "BLOCKED";
  }

  const probe = html.slice(0, 80_000).toLowerCase();

  if (
    /captcha|challenge|access denied|unusual traffic|digite os caracteres|cf-browser-verification/.test(
      probe,
    )
  ) {
    return "BLOCKED";
  }

  if (httpStatus >= 500) {
    return "ERROR";
  }

  return "SUCCESS";
}

async function consultarMagazineLuizaHtml(
  query: string,
): Promise<MagazineVoceProduct[]> {
  const termo = encodeURIComponent(query.trim());
  const url =
    `https://${MAGAZINE_VOCE_HOST}/${MAGAZINE_VOCE_STORE}/busca/${termo}/`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await abortableFetch(url, {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
      },
      signal: controller.signal,
    });

    const html = await response.text();
    const pageStatus = classificarPaginaMagazineLuiza(html, response.status);

    if (pageStatus === "BLOCKED") {
      throw new Error(
        `Magazine Luiza bloqueou a busca HTML. HTTP ${response.status}.`,
      );
    }

    if (!response.ok) {
      throw new Error(
        `Magazine Luiza HTML respondeu HTTP ${response.status}.`,
      );
    }

    const nextDataMatch = html.match(
      /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
    );

    if (nextDataMatch?.[1]) {
      const nextData = JSON.parse(nextDataMatch[1]) as {
        buildId?: string;
      } & MagazineVoceResponse;
      const buildId = validarBuildId(nextData.buildId);
      if (buildId) {
        magazineLuizaBuildIdCache = buildId;
      }

      const produtos = extrairProdutosMagazineLuiza(nextData);
      if (produtos) {
        return produtos;
      }
    }

    throw new Error(
      "Magazine Luiza HTML sem estrutura de produtos interpretavel.",
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        "TIMEOUT: a busca HTML do Magazine Luiza ultrapassou 25 segundos.",
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

  
async function consultarMagazineLuizaComBuildId(
  query: string,
  buildId: string,
): Promise<
  MagazineVoceProduct[] |
  null
> {
  const url =
    criarUrlBusca(
      query,
      buildId,
    );

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      TIMEOUT_MS,
    );

  try {
    const response =
      await abortableFetch(
        url.toString(),
        {
          method:
            "GET",

          cache:
            "no-store",

          redirect:
            "follow",

          headers: {
            Accept:
              "application/json",

            "Accept-Language":
              "pt-BR,pt;q=0.9,en;q=0.8",

            "Cache-Control":
              "no-cache",

            Pragma:
              "no-cache",

            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
          },

          signal:
            controller.signal,
        },
      );

    /*
     * 404 neste endpoint normalmente significa
     * que o buildId usado j? n?o ? o build atual.
     */
    if (
      response.status === 404
    ) {
      return null;
    }

    if (!response.ok) {
      throw new Error(
        `Magazine Luiza respondeu HTTP ${response.status}.`,
      );
    }

    const contentType =
      response.headers.get(
        "content-type",
      ) ?? "";

    if (
      !contentType
        .toLowerCase()
        .includes(
          "application/json",
        )
    ) {
      const body = await response.text();
      const pageStatus = classificarPaginaMagazineLuiza(
        body,
        response.status,
      );

      if (pageStatus === "BLOCKED") {
        throw new Error(
          `Magazine Luiza bloqueou a busca JSON. HTTP ${response.status}.`,
        );
      }

      throw new Error(
        "Magazine Luiza nao retornou JSON na busca.",
      );
    }

    const resposta =
      await response.json() as
        MagazineVoceResponse;

    const produtos =
      extrairProdutosMagazineLuiza(
        resposta,
      );

    if (!produtos) {
      throw new Error(
        "Magazine Luiza retornou JSON sem a lista de produtos esperada.",
      );
    }

    return produtos;
  } catch (error) {
    if (
      error instanceof Error &&
      error.name ===
        "AbortError"
    ) {
      throw new Error(
        "A busca do Magazine Luiza ultrapassou 25 segundos.",
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function consultarMagazineLuiza(
  query: string,
): Promise<MagazineVoceProduct[]> {
  const tentarJson = async (): Promise<MagazineVoceProduct[] | null> => {
    const buildIdInicial = obterBuildIdInicial();

    if (buildIdInicial) {
      const produtos = await consultarMagazineLuizaComBuildId(
        query,
        buildIdInicial,
      );

      if (produtos) {
        return produtos;
      }
    }

    magazineLuizaBuildIdCache = null;
    const buildIdAtual = await descobrirBuildIdAtual();
    return consultarMagazineLuizaComBuildId(query, buildIdAtual);
  };

  try {
    const produtos = await tentarJson();

    if (produtos) {
      return produtos;
    }
  } catch (jsonError) {
    try {
      return await consultarMagazineLuizaHtml(query);
    } catch (htmlError) {
      const jsonMessage =
        jsonError instanceof Error ? jsonError.message : String(jsonError);
      const htmlMessage =
        htmlError instanceof Error ? htmlError.message : String(htmlError);
      throw new Error(`${jsonMessage} | ${htmlMessage}`.slice(0, 1000));
    }
  }

  magazineLuizaBuildIdCache = null;
  return consultarMagazineLuizaHtml(query);
}

export async function buscarMagazineLuiza(
    request: DiscoveryQuery,
  ): Promise<MarketplaceDiscoveryResult> {

  const modoMultiloja =
    request.mode === "MULTILOJA";

    const query =
      request.query.trim();
  
    const limit =
      limitarQuantidade(
        request.limit,
      );
  
    if (!query) {
      return montarDiscoveryResult({
        marketplace: MARKETPLACE,
        query,
        candidates: [],
        scanned: 0,
        status: "ERROR",
        error: "Consulta vazia.",
      });
    }
  
    try {
      const produtos =
        await consultarMagazineLuiza(
          query,
        );
  
      const encontrados: Array<{
        candidate:
          DiscoveryCandidate;
        relevance:
          number;
        sales:
          number;
      }> = [];
  
      const ids =
        new Set<string>();
  
      for (
        const produto of produtos
      ) {
        if (
          produto.available ===
          false
        ) {
          continue;
        }
  
        const titulo =
          produto.title
            ?.trim() ??
          "";
  
        if (!titulo) {
          continue;
        }
  
        if (
          possuiCondicaoNaoNova(
            titulo,
          )
        ) {
          continue;
        }
  
        if (
        !modoMultiloja &&
          possuiAcessorioNaoSolicitado(
            titulo,
            query,
          )
        ) {
          continue;
        }
  
        if (
        !modoMultiloja && (
          possuiBundleNaoSolicitado(
            titulo,
            query,
          )
        
        )) {
          continue;
        }
  
        if (
        !modoMultiloja && (
          !marcaCompativel(
            titulo,
            query,
          )
        
        )) {
          continue;
        }
  
        if (
        !modoMultiloja && (
          !varianteCompativel(
            titulo,
            query,
          )
        
        )) {
          continue;
        }
  
        if (
        !modoMultiloja && (
          !modeloCompativel(
            titulo,
            query,
          )
        
        )) {
          continue;
        }
  
        if (
        !modoMultiloja && (
          !capacidadeCompativel(
            titulo,
            query,
          )
        
        )) {
          continue;
        }
  
        const relevancia =
          calcularRelevancia(
            titulo,
            query,
          );
  
        if (
        !modoMultiloja && (
          relevancia < 0.65
        
        )) {
          continue;
        }
  
        const caminho =
          produto.url?.trim() ||
          produto.path?.trim() ||
          (produto.variationId || produto.id
            ? `/p/${produto.variationId || produto.id}/`
            : "");

        const sourceUrl = criarUrlPublicaMagazineLuiza(caminho);
        const affiliateLink = criarUrlAfiliadaMagazineLuiza(caminho);
  
        const externalId =
          obterExternalId(
            produto,
            sourceUrl,
            affiliateLink,
          );
  
        if (
          !externalId ||
          !sourceUrl ||
          ids.has(
            externalId,
          )
        ) {
          continue;
        }
  
        const preco =
          obterPreco(
            produto,
          );
  
        if (!preco) {
          continue;
        }
  
        ids.add(
          externalId,
        );
  
        encontrados.push({
          relevance:
            relevancia,
  
          sales:
            obterVendas(
              produto,
            ),
  
          candidate: {
            marketplace:
              MARKETPLACE,
  
            marketplaceName:
              MARKETPLACE_NAME,
  
            externalId,
  
            sourceUrl,
  
            affiliateLink,
  
            title:
              titulo,
  
            image:
              normalizarImagem(
                produto.image,
              ),
  
            price:
              preco,
  
            oldPrice:
              obterPrecoAnterior(
                produto,
                preco,
              ),
  
            category:
              obterCategoria(
                produto,
              ),
  
            brand:
              obterMarca(
                produto,
              ),

            attributes:
              obterAtributosMagazineLuiza(
                produto,
              ),
  
            seller:
              produto.seller
                ?.description
                ?.trim() ||
              "Magazine Luiza",
  
            status:
              "FOUND",
  
            error:
              null,
          },
        });
      }
  
      const candidateLimit =
        modoMultiloja
          ? Math.min(
              Math.max(
                limit * 3,
                12,
              ),
              20,
            )
          : limit;

      const candidates =
        encontrados
          .sort(
            (a, b) => {
              if (
                b.relevance !==
                a.relevance
              ) {
                return (
                  b.relevance -
                  a.relevance
                );
              }
  
              if (
                b.sales !==
                a.sales
              ) {
                return (
                  b.sales -
                  a.sales
                );
              }
  
              return (
                (
                  a.candidate
                    .price ??
                  Number
                    .POSITIVE_INFINITY
                ) -
                (
                  b.candidate
                    .price ??
                  Number
                    .POSITIVE_INFINITY
                )
              );
            },
          )
          .slice(
            0,
            candidateLimit,
          )
          .map(
            (resultado) =>
              resultado.candidate,
          );
  
      return montarDiscoveryResult({
        marketplace: MARKETPLACE,
        query,
        candidates,
        scanned: produtos.length,
        status: candidates.length > 0 ? "SUCCESS" : "EMPTY",
        sourcesTried: ["magazinevoce-json", "magazinevoce-html"],
      });
    } catch (error) {
      const mensagem =
        error instanceof Error
          ? error.message
          : "Erro desconhecido.";
      const status = classificarMensagemAquisicao(mensagem);

      return montarDiscoveryResult({
        marketplace: MARKETPLACE,
        query,
        candidates: [],
        scanned: 0,
        status,
        error: mensagem.slice(0, 1000),
        sourcesTried: ["magazinevoce-json", "magazinevoce-html"],
        blockedSources:
          status === "BLOCKED"
            ? ["magazinevoce-json", "magazinevoce-html"]
            : [],
        unusableSources:
          status === "UNUSABLE"
            ? ["magazinevoce-json"]
            : [],
      });
    }
  }