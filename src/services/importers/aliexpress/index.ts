import type {
    ProductImport,
  } from "../core/types";
  
  import {
    carregarPaginaAliExpress,
  } from "./api";
  
  import {
    parseAliExpress,
  } from "./parser";
  
  export async function importarAliExpress(
    rawUrl: string,
  ): Promise<ProductImport> {
    const url =
      rawUrl.trim();
  
    if (!url) {
      throw new Error(
        "Cole o link do produto do AliExpress.",
      );
    }
  
    const pagina =
      await carregarPaginaAliExpress(
        url,
      );
  
    const oferta =
      parseAliExpress(
        pagina,
        url,
      );
  
    return {
      marketplace:
        "AliExpress",
  
      externalId:
        oferta.externalId,
  
      url:
        oferta.sourceUrl,
  
      affiliateLink:
        oferta.affiliateLink,
  
      title:
        oferta.title,
  
      description:
        oferta.description,
  
      brand:
        oferta.brand,
  
      category:
        oferta.category,
  
      image:
        oferta.image,
  
      images:
        oferta.images,
  
      price:
        oferta.price,
  
      oldPrice:
        oferta.oldPrice,
  
      discount:
        oferta.discount,
  
      installments:
        oferta.installments,
  
      rating:
        oferta.rating,
  
      reviews:
        oferta.reviews,
  
      sales:
        oferta.sales,
  
      stock:
        oferta.stock,
  
      seller:
        oferta.seller,
  
      attributes:
        oferta.attributes,
    };
  }