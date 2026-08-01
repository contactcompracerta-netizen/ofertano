import { detectarMarketplace } from "./core/detector";
import { importarMercadoLivre } from "./mercadolivre";
import type { ProductImport } from "./core/types";

export async function importarProduto(
  url: string
): Promise<ProductImport> {
  const marketplace = detectarMarketplace(url);

  switch (marketplace) {
    case "mercadolivre":
      return importarMercadoLivre(url);

    case "amazon":
      throw new Error(
        "O importador da Amazon ainda não foi implementado."
      );

    case "shopee":
      throw new Error(
        "O importador da Shopee ainda não foi implementado."
      );
  }
}
