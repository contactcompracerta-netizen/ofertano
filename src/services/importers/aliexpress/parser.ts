import type {
    AliExpressOffer,
    PaginaAliExpress,
  } from "./types";
  
  type JsonRecord =
    Record<string, unknown>;
  
  function isRecord(
    value: unknown,
  ): value is JsonRecord {
    return (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    );
  }
  
  function asString(
    value: unknown,
  ): string | null {
    if (typeof value !== "string") {
      return null;
    }
  
    const texto = value.trim();
  
    return texto || null;
  }
  
  function decodeHtml(
    value: string,
  ): string {
    return value
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(
        /&#(\d+);/g,
        (_, numero: string) =>
          String.fromCharCode(
            Number(numero),
          ),
      );
  }
  
  function limparTexto(
    value: string,
  ): string {
    return decodeHtml(
      value
        .replace(
          /<script[\s\S]*?<\/script>/gi,
          " ",
        )
        .replace(
          /<style[\s\S]*?<\/style>/gi,
          " ",
        )
        .replace(
          /<[^>]+>/g,
          " ",
        ),
    )
      .replace(/\s+/g, " ")
      .trim();
  }
  
  function converterNumero(
    value: unknown,
  ): number | null {
    if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      return value;
    }
  
    if (typeof value !== "string") {
      return null;
    }
  
    let texto = value
      .trim()
      .replace(/\s/g, "")
      .replace(/R\$/gi, "")
      .replace(/[^\d,.\-]/g, "");
  
    if (!texto) {
      return null;
    }
  
    if (texto.includes(",")) {
      texto = texto
        .replace(/\./g, "")
        .replace(",", ".");
    }
  
    const numero =
      Number(texto);
  
    return Number.isFinite(numero)
      ? numero
      : null;
  }
  
  function extrairMeta(
    html: string,
    chave: string,
  ): string | null {
    const metas =
      html.match(
        /<meta\b[^>]*>/gi,
      ) ?? [];
  
    for (const meta of metas) {
      const propriedade =
        meta.match(
          /\b(?:property|name|itemprop)=["']([^"']+)["']/i,
        )?.[1];
  
      if (
        propriedade?.toLowerCase() !==
        chave.toLowerCase()
      ) {
        continue;
      }
  
      const content =
        meta.match(
          /\bcontent=["']([^"']*)["']/i,
        )?.[1];
  
      if (content) {
        return decodeHtml(
          content,
        ).trim();
      }
    }
  
    return null;
  }
  
  function extrairCanonical(
    html: string,
  ): string | null {
    const links =
      html.match(
        /<link\b[^>]*>/gi,
      ) ?? [];
  
    for (const link of links) {
      const rel =
        link.match(
          /\brel=["']([^"']+)["']/i,
        )?.[1];
  
      if (
        !rel
          ?.toLowerCase()
          .split(/\s+/)
          .includes("canonical")
      ) {
        continue;
      }
  
      const href =
        link.match(
          /\bhref=["']([^"']+)["']/i,
        )?.[1];
  
      if (href) {
        return decodeHtml(
          href,
        ).trim();
      }
    }
  
    return null;
  }
  
  function escaparRegex(
    value: string,
  ): string {
    return value.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
  }
  
  function extrairStringJson(
    html: string,
    chaves: readonly string[],
  ): string | null {
    for (const chave of chaves) {
      const regex =
        new RegExp(
          `"${escaparRegex(
            chave,
          )}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
          "i",
        );
  
      const encontrado =
        html.match(regex)?.[1];
  
      if (!encontrado) {
        continue;
      }
  
      try {
        const valor =
          JSON.parse(
            `"${encontrado}"`,
          );
  
        if (
          typeof valor === "string" &&
          valor.trim()
        ) {
          return decodeHtml(
            valor,
          ).trim();
        }
      } catch {
        const valor =
          encontrado
            .replace(/\\\//g, "/")
            .replace(
              /\\u002F/gi,
              "/",
            )
            .trim();
  
        if (valor) {
          return decodeHtml(
            valor,
          );
        }
      }
    }
  
    return null;
  }
  
  function extrairNumeroJson(
    html: string,
    chaves: readonly string[],
  ): number | null {
    for (const chave of chaves) {
      const regexNumero =
        new RegExp(
          `"${escaparRegex(
            chave,
          )}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`,
          "i",
        );
  
      const numeroDireto =
        html.match(
          regexNumero,
        )?.[1];
  
      if (numeroDireto) {
        const convertido =
          converterNumero(
            numeroDireto,
          );
  
        if (convertido !== null) {
          return convertido;
        }
      }
  
      const string =
        extrairStringJson(
          html,
          [chave],
        );
  
      const convertido =
        converterNumero(
          string,
        );
  
      if (convertido !== null) {
        return convertido;
      }
    }
  
    return null;
  }
  
  function encontrarProdutoJsonLd(
    value: unknown,
  ): JsonRecord | null {
    if (Array.isArray(value)) {
      for (const item of value) {
        const produto =
          encontrarProdutoJsonLd(
            item,
          );
  
        if (produto) {
          return produto;
        }
      }
  
      return null;
    }
  
    if (!isRecord(value)) {
      return null;
    }
  
    const tipo =
      value["@type"];
  
    if (
      tipo === "Product" ||
      (
        Array.isArray(tipo) &&
        tipo.includes("Product")
      )
    ) {
      return value;
    }
  
    if (value["@graph"]) {
      const produto =
        encontrarProdutoJsonLd(
          value["@graph"],
        );
  
      if (produto) {
        return produto;
      }
    }
  
    for (
      const filho of
        Object.values(value)
    ) {
      if (
        typeof filho !== "object" ||
        filho === null
      ) {
        continue;
      }
  
      const produto =
        encontrarProdutoJsonLd(
          filho,
        );
  
      if (produto) {
        return produto;
      }
    }
  
    return null;
  }
  
  function extrairProdutoJsonLd(
    html: string,
  ): JsonRecord | null {
    const regex =
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  
    let match:
      RegExpExecArray | null;
  
    while (
      (match =
        regex.exec(html)) !== null
    ) {
      const conteudo =
        match[1]?.trim();
  
      if (!conteudo) {
        continue;
      }
  
      try {
        const json: unknown =
          JSON.parse(conteudo);
  
        const produto =
          encontrarProdutoJsonLd(
            json,
          );
  
        if (produto) {
          return produto;
        }
      } catch {
        // Continua procurando outro JSON-LD.
      }
    }
  
    return null;
  }
  
  function extrairOferta(
    produto: JsonRecord | null,
  ): JsonRecord | null {
    if (!produto) {
      return null;
    }
  
    const offers =
      produto.offers;
  
    if (Array.isArray(offers)) {
      const primeira =
        offers.find(isRecord);
  
      return primeira ?? null;
    }
  
    return isRecord(offers)
      ? offers
      : null;
  }
  
  function normalizarUrlImagem(
    rawUrl: string,
    baseUrl: string,
  ): string | null {
    let valor =
      decodeHtml(
        rawUrl.trim(),
      )
        .replace(
          /\\u002F/gi,
          "/",
        )
        .replace(
          /\\\//g,
          "/",
        );
  
    if (!valor) {
      return null;
    }
  
    if (
      valor.startsWith("//")
    ) {
      valor =
        `https:${valor}`;
    }
  
    try {
      return new URL(
        valor,
        baseUrl,
      ).toString();
    } catch {
      return null;
    }
  }
  
  function extrairImagens(
    produto: JsonRecord | null,
    html: string,
    baseUrl: string,
  ): string[] {
    const candidatas: string[] =
      [];
  
    if (produto) {
      const image =
        produto.image;
  
      if (
        typeof image === "string"
      ) {
        candidatas.push(image);
      }
  
      if (Array.isArray(image)) {
        for (const item of image) {
          if (
            typeof item === "string"
          ) {
            candidatas.push(
              item,
            );
          } else if (
            isRecord(item)
          ) {
            const url =
              asString(
                item.url,
              ) ??
              asString(
                item.contentUrl,
              );
  
            if (url) {
              candidatas.push(
                url,
              );
            }
          }
        }
      }
  
      if (isRecord(image)) {
        const url =
          asString(
            image.url,
          ) ??
          asString(
            image.contentUrl,
          );
  
        if (url) {
          candidatas.push(
            url,
          );
        }
      }
    }
  
    const ogImage =
      extrairMeta(
        html,
        "og:image",
      );
  
    if (ogImage) {
      candidatas.unshift(
        ogImage,
      );
    }
  
    const imagemPrincipal =
      extrairStringJson(
        html,
        [
          "imageUrl",
          "imagePath",
          "mainImage",
        ],
      );
  
    if (imagemPrincipal) {
      candidatas.push(
        imagemPrincipal,
      );
    }
  
    const regexLista =
      /"imagePathList"\s*:\s*\[([\s\S]*?)\]/i;
  
    const lista =
      html.match(
        regexLista,
      )?.[1];
  
    if (lista) {
      const regexImagem =
        /"((?:\\.|[^"\\])+)"/g;
  
      let match:
        RegExpExecArray | null;
  
      while (
        (match =
          regexImagem.exec(
            lista,
          )) !== null
      ) {
        if (match[1]) {
          candidatas.push(
            match[1],
          );
        }
      }
    }
  
    const normalizadas =
      candidatas.map(
        (imagem) =>
          normalizarUrlImagem(
            imagem,
            baseUrl,
          ),
      );
  
    return Array.from(
      new Set(
        normalizadas.filter(
          (
            imagem,
          ): imagem is string =>
            typeof imagem ===
              "string" &&
            /^https?:\/\//i.test(
              imagem,
            ),
        ),
      ),
    );
  }
  
  function extrairProdutoId(
    urls: readonly string[],
    produto: JsonRecord | null,
    html: string,
  ): string | null {
    for (const rawUrl of urls) {
      if (!rawUrl) {
        continue;
      }
  
      try {
        const url =
          new URL(rawUrl);
  
        const item =
          url.pathname.match(
            /\/item\/(\d+)(?:\.html)?(?:\/|$)/i,
          )?.[1];
  
        if (item) {
          return item;
        }
  
        const query =
          url.searchParams.get(
            "productId",
          );
  
        if (
          query &&
          /^\d+$/.test(query)
        ) {
          return query;
        }
      } catch {
        // Tenta a próxima URL.
      }
    }
  
    const idString =
      extrairStringJson(
        html,
        [
          "productId",
          "productIdLong",
        ],
      );
  
    if (
      idString &&
      /^\d+$/.test(idString)
    ) {
      return idString;
    }
  
    const idNumero =
      extrairNumeroJson(
        html,
        [
          "productId",
          "productIdLong",
        ],
      );
  
    if (
      idNumero !== null &&
      idNumero > 0
    ) {
      return String(
        Math.trunc(idNumero),
      );
    }
  
    if (produto) {
      const sku =
        asString(
          produto.productID,
        ) ??
        asString(
          produto.sku,
        );
  
      if (sku) {
        return sku;
      }
    }
  
    return null;
  }
  
  function extrairMoeda(
    oferta: JsonRecord | null,
    html: string,
  ): string | null {
    if (oferta) {
      const direta =
        asString(
          oferta.priceCurrency,
        );
  
      if (direta) {
        return direta
          .toUpperCase();
      }
  
      if (
        isRecord(
          oferta.priceSpecification,
        )
      ) {
        const moeda =
          asString(
            oferta
              .priceSpecification
              .priceCurrency,
          );
  
        if (moeda) {
          return moeda
            .toUpperCase();
        }
      }
    }
  
    const meta =
      extrairMeta(
        html,
        "product:price:currency",
      );
  
    if (meta) {
      return meta
        .toUpperCase();
    }
  
    const json =
      extrairStringJson(
        html,
        [
          "currencyCode",
          "currency",
        ],
      );
  
    return json
      ? json.toUpperCase()
      : null;
  }
  
  function extrairPreco(
    produto: JsonRecord | null,
    oferta: JsonRecord | null,
    html: string,
    textoPagina: string,
  ): number | null {
    const candidatos:
      unknown[] = [];
  
    if (oferta) {
      candidatos.push(
        oferta.price,
        oferta.lowPrice,
      );
  
      if (
        isRecord(
          oferta.priceSpecification,
        )
      ) {
        candidatos.push(
          oferta
            .priceSpecification
            .price,
        );
      }
    }
  
    if (produto) {
      candidatos.push(
        produto.price,
      );
    }
  
    candidatos.push(
      extrairMeta(
        html,
        "product:price:amount",
      ),
    );
  
    for (
      const candidato of
        candidatos
    ) {
      const numero =
        converterNumero(
          candidato,
        );
  
      if (
        numero !== null &&
        numero > 0
      ) {
        return numero;
      }
    }
  
    const precoFormatado =
      extrairStringJson(
        html,
        [
          "formattedActivityPrice",
          "formattedSalePrice",
          "formattedPrice",
          "salePriceString",
        ],
      );
  
    const precoString =
      converterNumero(
        precoFormatado,
      );
  
    if (
      precoString !== null &&
      precoString > 0
    ) {
      return precoString;
    }
  
    const precoNumero =
      extrairNumeroJson(
        html,
        [
          "minActivityAmount",
          "activityAmount",
          "salePrice",
          "minPrice",
        ],
      );
  
    if (
      precoNumero !== null &&
      precoNumero > 0
    ) {
      return precoNumero;
    }
  
    const precoReal =
      textoPagina.match(
        /R\$\s*([\d.]+,\d{2})/i,
      )?.[1];
  
    return converterNumero(
      precoReal,
    );
  }
  
  function extrairPrecoAnterior(
    oferta: JsonRecord | null,
    html: string,
    price: number,
  ): number | null {
    const candidatos:
      unknown[] = [];
  
    if (oferta) {
      candidatos.push(
        oferta.highPrice,
      );
    }
  
    const formatado =
      extrairStringJson(
        html,
        [
          "formattedOriginalPrice",
          "formattedMarketPrice",
          "originalPriceString",
        ],
      );
  
    candidatos.push(
      formatado,
    );
  
    const numerico =
      extrairNumeroJson(
        html,
        [
          "originalPrice",
          "marketPrice",
          "minAmount",
        ],
      );
  
    candidatos.push(
      numerico,
    );
  
    for (
      const candidato of
        candidatos
    ) {
      const numero =
        converterNumero(
          candidato,
        );
  
      if (
        numero !== null &&
        numero > price
      ) {
        return numero;
      }
    }
  
    return null;
  }
  
  function calcularDesconto(
    oldPrice: number | null,
    price: number,
    html: string,
  ): number | null {
    if (
      oldPrice !== null &&
      oldPrice > price
    ) {
      return Math.round(
        (
          (oldPrice - price) /
          oldPrice
        ) * 100,
      );
    }
  
    const descontoTexto =
      extrairStringJson(
        html,
        [
          "discount",
          "discountRate",
        ],
      );
  
    const numero =
      descontoTexto?.match(
        /(\d{1,2})/,
      )?.[1];
  
    if (!numero) {
      return null;
    }
  
    const desconto =
      Number(numero);
  
    return (
      desconto > 0 &&
      desconto < 100
    )
      ? desconto
      : null;
  }
  
  function extrairMarca(
    produto: JsonRecord | null,
    html: string,
  ): string | null {
    if (produto) {
      const brand =
        produto.brand;
  
      if (
        typeof brand === "string"
      ) {
        return (
          brand.trim() ||
          null
        );
      }
  
      if (isRecord(brand)) {
        const nome =
          asString(
            brand.name,
          );
  
        if (nome) {
          return nome;
        }
      }
    }
  
    return extrairStringJson(
      html,
      [
        "brandName",
      ],
    );
  }
  
  function extrairVendedor(
    oferta: JsonRecord | null,
    html: string,
  ): string | null {
    if (oferta) {
      const seller =
        oferta.seller;
  
      if (
        typeof seller === "string"
      ) {
        return (
          seller.trim() ||
          null
        );
      }
  
      if (isRecord(seller)) {
        const nome =
          asString(
            seller.name,
          );
  
        if (nome) {
          return nome;
        }
      }
    }
  
    return extrairStringJson(
      html,
      [
        "storeName",
        "sellerName",
        "shopName",
      ],
    );
  }
  
  function extrairAvaliacao(
    produto: JsonRecord | null,
    html: string,
  ): {
    rating: number | null;
    reviews: number | null;
  } {
    let rating: number | null =
      null;
  
    let reviews: number | null =
      null;
  
    if (
      produto &&
      isRecord(
        produto.aggregateRating,
      )
    ) {
      rating =
        converterNumero(
          produto
            .aggregateRating
            .ratingValue,
        );
  
      reviews =
        converterNumero(
          produto
            .aggregateRating
            .reviewCount ??
          produto
            .aggregateRating
            .ratingCount,
        );
    }
  
    rating ??=
      extrairNumeroJson(
        html,
        [
          "averageStar",
          "evaluationStar",
          "starRating",
        ],
      );
  
    reviews ??=
      extrairNumeroJson(
        html,
        [
          "reviewCount",
          "totalValidNum",
          "evaluationCount",
        ],
      );
  
    return {
      rating:
        rating !== null &&
        rating > 0 &&
        rating <= 5
          ? rating
          : null,
  
      reviews:
        reviews !== null &&
        reviews >= 0
          ? Math.round(
              reviews,
            )
          : null,
    };
  }
  
  function extrairVendas(
    html: string,
  ): number | null {
    const valor =
      extrairNumeroJson(
        html,
        [
          "tradeCount",
          "orders",
          "sales",
        ],
      );
  
    if (
      valor === null ||
      valor < 0
    ) {
      return null;
    }
  
    return Math.round(
      valor,
    );
  }
  
  function extrairEstoque(
    oferta: JsonRecord | null,
  ): number | null {
    if (!oferta) {
      return null;
    }
  
    const availability =
      asString(
        oferta.availability,
      );
  
    if (!availability) {
      return null;
    }
  
    if (
      /OutOfStock|SoldOut|Discontinued/i.test(
        availability,
      )
    ) {
      return 0;
    }
  
    if (
      /InStock|LimitedAvailability/i.test(
        availability,
      )
    ) {
      return 1;
    }
  
    return null;
  }
  
  function ehLinkAfiliado(
    rawUrl: string,
  ): boolean {
    try {
      const hostname =
        new URL(rawUrl)
          .hostname
          .toLowerCase()
          .replace(
            /^www\./,
            "",
          );
  
      return (
        hostname ===
          "s.click.aliexpress.com" ||
        hostname.endsWith(
          ".s.click.aliexpress.com",
        )
      );
    } catch {
      return false;
    }
  }
  
  function adicionarAtributo(
    atributos:
      Record<string, string>,
    chave: string,
    valor: string | null,
  ): void {
    if (valor?.trim()) {
      atributos[chave] =
        valor.trim();
    }
  }
  
  export function parseAliExpress(
    pagina: PaginaAliExpress,
    rawUrl: string,
  ): AliExpressOffer {
    const {
      html,
      finalUrl,
      requestedUrl,
    } = pagina;
  
    const textoPagina =
      limparTexto(
        html,
      );
  
    const produto =
      extrairProdutoJsonLd(
        html,
      );
  
    const oferta =
      extrairOferta(
        produto,
      );
  
    const canonical =
      extrairCanonical(
        html,
      );
  
    const sourceUrl =
      canonical?.trim() ||
      finalUrl.trim() ||
      requestedUrl.trim();
  
    const externalId =
      extrairProdutoId(
        [
          sourceUrl,
          finalUrl,
          requestedUrl,
          rawUrl,
        ],
        produto,
        html,
      );
  
    if (!externalId) {
      throw new Error(
        "Não foi possível identificar o código do produto do AliExpress.",
      );
    }
  
    const title =
      asString(
        produto?.name,
      ) ??
      extrairMeta(
        html,
        "og:title",
      ) ??
      extrairMeta(
        html,
        "twitter:title",
      ) ??
      extrairStringJson(
        html,
        [
          "subject",
          "productTitle",
        ],
      );
  
    if (!title) {
      throw new Error(
        "Não foi possível identificar o título do produto do AliExpress.",
      );
    }
  
    const images =
      extrairImagens(
        produto,
        html,
        sourceUrl,
      );
  
    if (!images[0]) {
      throw new Error(
        "Não foi possível identificar a imagem do produto do AliExpress.",
      );
    }
  
    const moeda =
      extrairMoeda(
        oferta,
        html,
      );
  
    if (
      moeda &&
      moeda !== "BRL"
    ) {
      throw new Error(
        `O AliExpress retornou o preço em ${moeda}, e não em BRL. A importação foi interrompida para não salvar um preço incorreto no Ofertano.`,
      );
    }
  
    const price =
      extrairPreco(
        produto,
        oferta,
        html,
        textoPagina,
      );
  
    if (
      price === null ||
      price <= 0
    ) {
      throw new Error(
        "Não foi possível identificar o preço atual do produto do AliExpress.",
      );
    }
  
    const oldPrice =
      extrairPrecoAnterior(
        oferta,
        html,
        price,
      );
  
    const discount =
      calcularDesconto(
        oldPrice,
        price,
        html,
      );
  
    const descriptionRaw =
      asString(
        produto?.description,
      ) ??
      extrairMeta(
        html,
        "og:description",
      );
  
    const description =
      descriptionRaw
        ? limparTexto(
            descriptionRaw,
          )
        : null;
  
    const brand =
      extrairMarca(
        produto,
        html,
      );
  
    const category =
      asString(
        produto?.category,
      ) ??
      extrairStringJson(
        html,
        [
          "categoryName",
        ],
      );
  
    const seller =
      extrairVendedor(
        oferta,
        html,
      );
  
    const {
      rating,
      reviews,
    } = extrairAvaliacao(
      produto,
      html,
    );
  
    const affiliateLink =
      pagina.affiliateLink ??
      (
        ehLinkAfiliado(
          rawUrl,
        )
          ? rawUrl.trim()
          : null
      );
  
    const attributes:
      Record<string, string> = {
        "AliExpress Product ID":
          externalId,
  
        "Link do produto":
          sourceUrl,
    };
  
    if (affiliateLink) {
      attributes[
        "Link de afiliado"
      ] = affiliateLink;
    }
  
    adicionarAtributo(
      attributes,
      "Marca",
      brand,
    );
  
    adicionarAtributo(
      attributes,
      "Vendedor",
      seller,
    );
  
    adicionarAtributo(
      attributes,
      "Moeda",
      moeda,
    );
  
    if (produto) {
      adicionarAtributo(
        attributes,
        "SKU",
        asString(
          produto.sku,
        ),
      );
  
      adicionarAtributo(
        attributes,
        "GTIN",
        asString(
          produto.gtin13 ??
          produto.gtin ??
          produto.gtin14,
        ),
      );
  
      adicionarAtributo(
        attributes,
        "MPN",
        asString(
          produto.mpn,
        ),
      );
    }
  
    return {
      externalId,
  
      sourceUrl,
  
      affiliateLink,
  
      title:
        title.trim(),
  
      description,
  
      brand,
  
      category,
  
      image:
        images[0],
  
      images,
  
      price,
  
      oldPrice,
  
      discount,
  
      installments: null,
  
      rating,
  
      reviews,
  
      sales:
        extrairVendas(
          html,
        ),
  
      stock:
        extrairEstoque(
          oferta,
        ),
  
      seller,
  
      attributes,
    };
  }