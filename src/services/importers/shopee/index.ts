import type { ProductImport } from "../core/types";

import {
  buscarGaleriaShopee,
  buscarOfertaShopeePorIds,
  resolverUrlShopee,
} from "./api";

type ShopeeIds = {
  shopId: string;
  itemId: string;
};

function extrairIdsDaUrl(
  rawUrl: string,
): ShopeeIds | null {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const pathname = decodeURIComponent(
    url.pathname,
  );

  const formatoSlug = pathname.match(
    /-i\.(\d+)\.(\d+)(?:\/|$)/i,
  );

  if (
    formatoSlug?.[1] &&
    formatoSlug?.[2]
  ) {
    return {
      shopId: formatoSlug[1],
      itemId: formatoSlug[2],
    };
  }

  const formatoProduct =
    pathname.match(
      /\/product\/(\d+)\/(\d+)(?:\/|$)/i,
    );

  if (
    formatoProduct?.[1] &&
    formatoProduct?.[2]
  ) {
    return {
      shopId: formatoProduct[1],
      itemId: formatoProduct[2],
    };
  }

  const shopId =
    url.searchParams.get("shopid") ??
    url.searchParams.get("shopId");

  const itemId =
    url.searchParams.get("itemid") ??
    url.searchParams.get("itemId");

  if (
    shopId &&
    itemId &&
    /^\d+$/.test(shopId) &&
    /^\d+$/.test(itemId)
  ) {
    return {
      shopId,
      itemId,
    };
  }

  return null;
}

async function resolverProdutoShopee(
  rawUrl: string,
): Promise<ShopeeIds> {
  const url = rawUrl.trim();

  if (!url) {
    throw new Error(
      "Cole o link do produto da Shopee.",
    );
  }

  const idsDiretos =
    extrairIdsDaUrl(url);

  if (idsDiretos) {
    return idsDiretos;
  }

  const urlResolvida =
    await resolverUrlShopee(url);

  const idsResolvidos =
    extrairIdsDaUrl(urlResolvida);

  if (!idsResolvidos) {
    throw new Error(
      "Não foi possível identificar o código do produto da Shopee.",
    );
  }

  return idsResolvidos;
}

function converterNumero(
  valor:
    | string
    | number
    | null
    | undefined,
): number | null {
  if (
    valor === null ||
    valor === undefined
  ) {
    return null;
  }

  const numero =
    typeof valor === "number"
      ? valor
      : Number(valor);

  return Number.isFinite(numero)
    ? numero
    : null;
}

function normalizarDesconto(
  valor: number,
): number | null {
  if (
    !Number.isFinite(valor) ||
    valor <= 0 ||
    valor >= 100
  ) {
    return null;
  }

  return Math.round(valor);
}

export async function importarShopee(
  rawUrl: string,
): Promise<ProductImport> {
  const {
    shopId,
    itemId,
  } = await resolverProdutoShopee(
    rawUrl,
  );

  const oferta =
    await buscarOfertaShopeePorIds(
      shopId,
      itemId,
    );

  const price =
    converterNumero(
      oferta.price,
    );

  if (
    price === null ||
    price <= 0
  ) {
    throw new Error(
      "A Shopee não retornou um preço válido para este produto.",
    );
  }

  const rating =
    converterNumero(
      oferta.ratingStar,
    );

  const discount =
    normalizarDesconto(
      oferta.priceDiscountRate,
    );

  /*
   * A Affiliate Open API informa o percentual
   * de desconto, mas não fornece o preço anterior
   * exato nesse retorno. Por isso oldPrice continua
   * null e o desconto é salvo diretamente.
   */
  const oldPrice = null;

  const images =
    await buscarGaleriaShopee(
      oferta.productLink,
      oferta.imageUrl,
    );

  const imagemPrincipal =
    images[0] ||
    oferta.imageUrl.trim();

  const attributes: Record<
    string,
    string
  > = {
    "Shopee Shop ID":
      String(oferta.shopId),

    "Shopee Item ID":
      String(oferta.itemId),

    Loja:
      oferta.shopName,

    "Link do produto":
      oferta.productLink,

    "Link de afiliado":
      oferta.offerLink,
  };

  if (discount !== null) {
    attributes["Desconto Shopee"] =
      `${discount}%`;
  }

  if (
    oferta.commissionRate?.trim()
  ) {
    attributes[
      "Taxa de comissão"
    ] = oferta.commissionRate;
  }

  if (
    oferta.commission?.trim()
  ) {
    attributes[
      "Comissão estimada"
    ] = oferta.commission;
  }

  if (
    Array.isArray(
      oferta.productCatIds,
    ) &&
    oferta.productCatIds.length > 0
  ) {
    attributes[
      "Categorias Shopee"
    ] =
      oferta.productCatIds.join(
        ", ",
      );
  }

  return {
    marketplace: "Shopee",

    externalId:
      `${oferta.shopId}.${oferta.itemId}`,

    url:
      oferta.productLink.trim(),

    affiliateLink:
      oferta.offerLink.trim(),

    title:
      oferta.productName.trim(),

    description: null,

    brand: null,

    category: null,

    image:
      imagemPrincipal,

    images:
      Array.from(
        new Set(
          [
            imagemPrincipal,
            ...images,
          ]
            .map((imagem) =>
              imagem.trim(),
            )
            .filter(Boolean),
        ),
      ),

    price,

    oldPrice,

    discount,

    installments: null,

    rating:
      rating !== null &&
      rating > 0
        ? rating
        : null,

    reviews: null,

    sales:
      Number.isFinite(
        oferta.sales,
      )
        ? oferta.sales
        : null,

    stock: null,

    seller:
      oferta.shopName?.trim() ||
      "Shopee",

    attributes,
  };
}