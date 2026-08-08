import type {
    MagazineLuizaOffer,
    PaginaMagazineLuiza,
  } from "./types";
  
  type JsonRecord = Record<string, unknown>;
  
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
      .replace(/&#(\d+);/g, (_, numero: string) =>
        String.fromCharCode(Number(numero)),
      );
  }
  
  function limparTexto(
    value: string,
  ): string {
    return decodeHtml(
      value
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
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
      .replace(/R\$/gi, "");
  
    if (!texto) {
      return null;
    }
  
    if (texto.includes(",")) {
      texto = texto
        .replace(/\./g, "")
        .replace(",", ".");
    } else {
      texto = texto.replace(
        /[^\d.-]/g,
        "",
      );
    }
  
    const numero = Number(texto);
  
    return Number.isFinite(numero)
      ? numero
      : null;
  }
  
  function extrairMeta(
    html: string,
    chave: string,
  ): string | null {
    const metas =
      html.match(/<meta\b[^>]*>/gi) ?? [];
  
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
      html.match(/<link\b[^>]*>/gi) ?? [];
  
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
        return decodeHtml(href).trim();
      }
    }
  
    return null;
  }
  
  function encontrarProdutoJsonLd(
    value: unknown,
  ): JsonRecord | null {
    if (Array.isArray(value)) {
      for (const item of value) {
        const encontrado =
          encontrarProdutoJsonLd(item);
  
        if (encontrado) {
          return encontrado;
        }
      }
  
      return null;
    }
  
    if (!isRecord(value)) {
      return null;
    }
  
    const tipo = value["@type"];
  
    if (
      tipo === "Product" ||
      (
        Array.isArray(tipo) &&
        tipo.some(
          (item) =>
            item === "Product",
        )
      )
    ) {
      return value;
    }
  
    const graph = value["@graph"];
  
    if (graph) {
      const encontrado =
        encontrarProdutoJsonLd(graph);
  
      if (encontrado) {
        return encontrado;
      }
    }
  
    for (
      const filho of Object.values(value)
    ) {
      if (
        typeof filho !== "object" ||
        filho === null
      ) {
        continue;
      }
  
      const encontrado =
        encontrarProdutoJsonLd(filho);
  
      if (encontrado) {
        return encontrado;
      }
    }
  
    return null;
  }
  
  function extrairProdutoJsonLd(
    html: string,
  ): JsonRecord | null {
    const regex =
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  
    let match: RegExpExecArray | null;
  
    while (
      (match = regex.exec(html)) !== null
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
          encontrarProdutoJsonLd(json);
  
        if (produto) {
          return produto;
        }
      } catch {
        // Continua procurando outro JSON-LD válido.
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
  
    const offers = produto.offers;
  
    if (Array.isArray(offers)) {
      const primeira = offers.find(
        isRecord,
      );
  
      return primeira ?? null;
    }
  
    return isRecord(offers)
      ? offers
      : null;
  }
  
  function extrairMarca(
    produto: JsonRecord | null,
  ): string | null {
    if (!produto) {
      return null;
    }
  
    const brand = produto.brand;
  
    if (typeof brand === "string") {
      return brand.trim() || null;
    }
  
    if (isRecord(brand)) {
      return asString(brand.name);
    }
  
    return null;
  }
  
  function extrairVendedor(
    oferta: JsonRecord | null,
    textoPagina: string,
  ): string | null {
    if (oferta) {
      const seller = oferta.seller;
  
      if (typeof seller === "string") {
        return seller.trim() || null;
      }
  
      if (isRecord(seller)) {
        const nome =
          asString(seller.name);
  
        if (nome) {
          return nome;
        }
      }
    }
  
    return (
      textoPagina.match(
        /Vendido por\s+(.+?)(?:\s+Entregue por|\s+Informações da loja|\s+Lojista Magalu)/i,
      )?.[1]?.trim() ??
      null
    );
  }
  
  function extrairImagens(
    produto: JsonRecord | null,
    html: string,
  ): string[] {
    const imagens: string[] = [];
  
    if (produto) {
      const image = produto.image;
  
      if (typeof image === "string") {
        imagens.push(image);
      }
  
      if (Array.isArray(image)) {
        for (const item of image) {
          if (typeof item === "string") {
            imagens.push(item);
            continue;
          }
  
          if (isRecord(item)) {
            const url =
              asString(item.url) ??
              asString(
                item.contentUrl,
              );
  
            if (url) {
              imagens.push(url);
            }
          }
        }
      }
  
      if (isRecord(image)) {
        const url =
          asString(image.url) ??
          asString(
            image.contentUrl,
          );
  
        if (url) {
          imagens.push(url);
        }
      }
    }
  
    const ogImage =
      extrairMeta(
        html,
        "og:image",
      );
  
    if (ogImage) {
      imagens.unshift(ogImage);
    }
  
    return Array.from(
      new Set(
        imagens
          .map((imagem) =>
            imagem.trim(),
          )
          .filter(
            (imagem) =>
              /^https?:\/\//i.test(
                imagem,
              ),
          ),
      ),
    );
  }
  
  function extrairCodigoProduto(
    urls: string[],
    produto: JsonRecord | null,
  ): string | null {
    for (const rawUrl of urls) {
      try {
        const url = new URL(rawUrl);
  
        const match =
          url.pathname.match(
            /\/p\/([^/?#]+)(?:\/|$)/i,
          );
  
        if (match?.[1]) {
          return decodeURIComponent(
            match[1],
          ).trim();
        }
      } catch {
        // Tenta a próxima URL.
      }
    }
  
    if (produto) {
      return (
        asString(produto.sku) ??
        asString(
          produto.productID,
        ) ??
        asString(produto.mpn)
      );
    }
  
    return null;
  }
  
  function extrairPreco(
    produto: JsonRecord | null,
    oferta: JsonRecord | null,
    html: string,
    textoPagina: string,
  ): number | null {
    const valores: unknown[] = [];
  
    if (oferta) {
      valores.push(
        oferta.price,
        oferta.lowPrice,
      );
  
      if (
        isRecord(
          oferta.priceSpecification,
        )
      ) {
        valores.push(
          oferta.priceSpecification.price,
        );
      }
    }
  
    if (produto) {
      valores.push(
        produto.price,
      );
    }
  
    valores.push(
      extrairMeta(
        html,
        "product:price:amount",
      ),
    );
  
    for (const valor of valores) {
      const numero =
        converterNumero(valor);
  
      if (
        numero !== null &&
        numero > 0
      ) {
        return numero;
      }
    }
  
    const precoPix =
      textoPagina.match(
        /R\$\s*([\d.]+,\d{2})\s*(?:no\s+Pix|Pix)/i,
      )?.[1];
  
    if (precoPix) {
      return converterNumero(
        precoPix,
      );
    }
  
    return null;
  }
  
  function extrairDesconto(
    textoPagina: string,
  ): number | null {
    const match =
      textoPagina.match(
        /(\d{1,2})%\s+de\s+desconto/i,
      );
  
    if (!match?.[1]) {
      return null;
    }
  
    const desconto =
      Number(match[1]);
  
    if (
      !Number.isFinite(desconto) ||
      desconto <= 0 ||
      desconto >= 100
    ) {
      return null;
    }
  
    return desconto;
  }
  
  function extrairParcelamento(
    textoPagina: string,
  ): string | null {
    const match =
      textoPagina.match(
        /(\d{1,2})x\s+de\s+R\$\s*([\d.]+,\d{2})\s*(sem juros)?/i,
      );
  
    if (
      !match?.[1] ||
      !match?.[2]
    ) {
      return null;
    }
  
    const semJuros =
      match[3]
        ? " sem juros"
        : "";
  
    return `${match[1]}x de R$ ${match[2]}${semJuros}`;
  }
  
  function extrairAvaliacao(
    produto: JsonRecord | null,
  ): {
    rating: number | null;
    reviews: number | null;
  } {
    if (!produto) {
      return {
        rating: null,
        reviews: null,
      };
    }
  
    const aggregateRating =
      produto.aggregateRating;
  
    if (!isRecord(aggregateRating)) {
      return {
        rating: null,
        reviews: null,
      };
    }
  
    const rating =
      converterNumero(
        aggregateRating.ratingValue,
      );
  
    const reviews =
      converterNumero(
        aggregateRating.reviewCount ??
          aggregateRating.ratingCount,
      );
  
    return {
      rating:
        rating !== null &&
        rating > 0
          ? rating
          : null,
  
      reviews:
        reviews !== null &&
        reviews >= 0
          ? Math.round(reviews)
          : null,
    };
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
        new URL(rawUrl).hostname
          .toLowerCase()
          .replace(/^www\./, "");
  
      return (
        hostname ===
          "magazinevoce.com.br" ||
        hostname.endsWith(
          ".magazinevoce.com.br",
        )
      );
    } catch {
      return false;
    }
  }
  
  function adicionarAtributo(
    atributos: Record<string, string>,
    chave: string,
    valor: unknown,
  ): void {
    if (
      typeof valor !== "string"
    ) {
      return;
    }
  
    const texto = valor.trim();
  
    if (texto) {
      atributos[chave] = texto;
    }
  }
  
  export function parseMagazineLuiza(
    pagina: PaginaMagazineLuiza,
    rawUrl: string,
  ): MagazineLuizaOffer {
    const {
      html,
      finalUrl,
      requestedUrl,
    } = pagina;
  
    const textoPagina =
      limparTexto(html);
  
    const produto =
      extrairProdutoJsonLd(html);
  
    const oferta =
      extrairOferta(produto);
  
    const canonical =
      extrairCanonical(html);
  
    const externalId =
      extrairCodigoProduto(
        [
          finalUrl,
          canonical ?? "",
          requestedUrl,
          rawUrl,
        ],
        produto,
      );
  
    if (!externalId) {
      throw new Error(
        "Não foi possível identificar o código do produto do Magazine Luiza.",
      );
    }
  
    const title =
      asString(produto?.name) ??
      extrairMeta(
        html,
        "og:title",
      ) ??
      extrairMeta(
        html,
        "twitter:title",
      );
  
    if (!title) {
      throw new Error(
        "Não foi possível identificar o título do produto do Magazine Luiza.",
      );
    }
  
    const images =
      extrairImagens(
        produto,
        html,
      );
  
    if (!images[0]) {
      throw new Error(
        "Não foi possível identificar a imagem do produto do Magazine Luiza.",
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
        "Não foi possível identificar o preço atual do produto do Magazine Luiza.",
      );
    }
  
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
      extrairMarca(produto);
  
    const category =
      asString(
        produto?.category,
      );
  
    const seller =
      extrairVendedor(
        oferta,
        textoPagina,
      );
  
    const {
      rating,
      reviews,
    } = extrairAvaliacao(
      produto,
    );
  
    const discount =
      extrairDesconto(
        textoPagina,
      );
  
    const installments =
      extrairParcelamento(
        textoPagina,
      );
  
    const affiliateLink =
      ehLinkAfiliado(rawUrl)
        ? rawUrl.trim()
        : ehLinkAfiliado(
              requestedUrl,
            )
          ? requestedUrl.trim()
          : null;
  
    const sourceUrl =
      canonical?.trim() ||
      finalUrl.trim() ||
      requestedUrl.trim();
  
    const attributes: Record<
      string,
      string
    > = {
      "Código Magazine Luiza":
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
  
    if (produto) {
      adicionarAtributo(
        attributes,
        "SKU",
        asString(produto.sku),
      );
  
      adicionarAtributo(
        attributes,
        "GTIN",
        asString(
          produto.gtin13 ??
            produto.gtin ??
            produto.gtin14 ??
            produto.gtin12 ??
            produto.gtin8,
        ),
      );
  
      adicionarAtributo(
        attributes,
        "MPN",
        asString(produto.mpn),
      );
  
      adicionarAtributo(
        attributes,
        "Modelo",
        asString(produto.model),
      );
    }
  
    return {
      externalId,
  
      sourceUrl,
  
      affiliateLink,
  
      title: title.trim(),
  
      description,
  
      brand,
  
      category,
  
      image: images[0],
  
      images,
  
      price,
  
      oldPrice: null,
  
      discount,
  
      installments,
  
      rating,
  
      reviews,
  
      stock:
        extrairEstoque(
          oferta,
        ),
  
      seller,
  
      attributes,
    };
  }