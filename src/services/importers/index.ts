import { detectarMarketplace } from "./core/detector";

import { importarMercadoLivre } from "./mercadolivre";
import { importarAmazon } from "./amazon";

import type { ProductImport } from "./core/types";

export async function importarProduto(
  url: string
): Promise<ProductImport> {
  const marketplace = detectarMarketplace(url);

  switch (marketplace) {
    case "mercadolivre":
      return importarMercadoLivre(url);

    case "amazon":
      return importarAmazon(url);

    case "shopee":
      throw new Error(
        "O importador da Shopee ainda não foi implementado."
      );

    default:
      throw new Error(
        "Marketplace não suportado."
      );
  }
}