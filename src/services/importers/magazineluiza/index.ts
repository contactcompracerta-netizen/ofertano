import type {
    ProductImport,
  } from "../core/types";
  
  import {
    carregarPaginaMagazineLuiza,
  } from "./api";
  
  import {
    parseMagazineLuiza,
  } from "./parser";
  
  export async function importarMagazineLuiza(
    rawUrl: string,
  ): Promise<ProductImport> {
    const url = rawUrl.trim();
  
    if (!url) {
      throw new Error(
        "Cole o link do produto do Magazine Luiza.",
      );
    }
  
    const pagina =
      await carregarPaginaMagazineLuiza(
        url,
      );
  
    const oferta =
      parseMagazineLuiza(
        pagina,
        url,
      );
  
    return {
      marketplace:
        "Magazine Luiza",
  
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
  
      sales: null,
  
      stock:
        oferta.stock,
  
      seller:
        oferta.seller,
  
      attributes:
        oferta.attributes,
    };
  }