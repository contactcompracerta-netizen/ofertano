import type {
    DiscoveryCandidate,
    DiscoveryQuery,
    MarketplaceDiscoveryResult,
  } from "./core/types";
  
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
    "fone",
    "fones",
    "headset",
    "earphone",
    "earphones",
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
  };
  
  type MagazineVoceResponse = {
    pageProps?: {
      data?: {
        search?: {
          products?: MagazineVoceProduct[];
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
  
  function criarUrlAfiliada(
    produto: MagazineVoceProduct,
  ): string | null {
    const caminho =
      produto.url?.trim() ||
      produto.path?.trim();
  
    if (!caminho) {
      return null;
    }
  
    try {
      if (
        /^https?:\/\//i.test(
          caminho,
        )
      ) {
        const url =
          new URL(caminho);
  
        url.protocol =
          "https:";
  
        url.hostname =
          MAGAZINE_VOCE_HOST;
  
        return url.toString();
      }
  
      const path =
        caminho.startsWith("/")
          ? caminho
          : `/${caminho}`;
  
      return (
        `https://${MAGAZINE_VOCE_HOST}${path}`
      );
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
      extrairCodigoDaUrl(
        affiliateLink,
      );
  
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
  
  function obterBuildId(): string {
    const valor =
      process.env
        .MAGAZINE_LUIZA_BUILD_ID
        ?.trim();
  
    if (!valor) {
      throw new Error(
        "A variável MAGAZINE_LUIZA_BUILD_ID não está configurada.",
      );
    }
  
    if (
      !/^[A-Za-z0-9_-]+$/.test(
        valor,
      )
    ) {
      throw new Error(
        "MAGAZINE_LUIZA_BUILD_ID possui formato inválido.",
      );
    }
  
    return valor;
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
  
  async function consultarMagazineLuiza(
    query: string,
  ): Promise<MagazineVoceProduct[]> {
    const buildId =
      obterBuildId();
  
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
        await fetch(
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
  
      if (
        response.status === 404
      ) {
        throw new Error(
          "Magazine Luiza: o buildId expirou. Atualize MAGAZINE_LUIZA_BUILD_ID.",
        );
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
        throw new Error(
          "Magazine Luiza não retornou JSON na busca.",
        );
      }
  
      const resposta =
        await response.json() as
          MagazineVoceResponse;
  
      const produtos =
        resposta
          .pageProps
          ?.data
          ?.search
          ?.products;
  
      if (
        !Array.isArray(produtos)
      ) {
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
  
  export async function buscarMagazineLuiza(
    request: DiscoveryQuery,
  ): Promise<MarketplaceDiscoveryResult> {
    const query =
      request.query.trim();
  
    const limit =
      limitarQuantidade(
        request.limit,
      );
  
    if (!query) {
      return {
        marketplace:
          MARKETPLACE,
  
        query,
  
        success:
          false,
  
        candidates:
          [],
  
        scanned:
          0,
  
        error:
          "Consulta vazia.",
      };
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
          possuiAcessorioNaoSolicitado(
            titulo,
            query,
          )
        ) {
          continue;
        }
  
        if (
          possuiBundleNaoSolicitado(
            titulo,
            query,
          )
        ) {
          continue;
        }
  
        if (
          !marcaCompativel(
            titulo,
            query,
          )
        ) {
          continue;
        }
  
        if (
          !varianteCompativel(
            titulo,
            query,
          )
        ) {
          continue;
        }
  
        if (
          !modeloCompativel(
            titulo,
            query,
          )
        ) {
          continue;
        }
  
        if (
          !capacidadeCompativel(
            titulo,
            query,
          )
        ) {
          continue;
        }
  
        const relevancia =
          calcularRelevancia(
            titulo,
            query,
          );
  
        if (
          relevancia < 0.65
        ) {
          continue;
        }
  
        const affiliateLink =
          criarUrlAfiliada(
            produto,
          );
  
        if (!affiliateLink) {
          continue;
        }
  
        const externalId =
          obterExternalId(
            produto,
            affiliateLink,
          );
  
        if (
          !externalId ||
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
  
            sourceUrl:
              affiliateLink,
  
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
            limit,
          )
          .map(
            (resultado) =>
              resultado.candidate,
          );
  
      return {
        marketplace:
          MARKETPLACE,
  
        query,
  
        success:
          true,
  
        candidates,
  
        scanned:
          produtos.length,
  
        error:
          null,
      };
    } catch (error) {
      const mensagem =
        error instanceof Error
          ? error.message
          : "Erro desconhecido.";
  
      return {
        marketplace:
          MARKETPLACE,
  
        query,
  
        success:
          false,
  
        candidates:
          [],
  
        scanned:
          0,
  
        error:
          mensagem.slice(
            0,
            1000,
          ),
      };
    }
  }