import { detectarMarketplace } from "./core/detector";
import { obterMarketplaceAdapter } from "./core/registry";

import type { ProductImport } from "./core/types";

export async function importarProduto(
  url: string,
): Promise<ProductImport> {
  const marketplace = detectarMarketplace(url);

  const adapter =
    obterMarketplaceAdapter(marketplace);

  if (!adapter.importer) {
    throw new Error(
      `O importador da ${adapter.name} ainda não foi implementado.`,
    );
  }

  return adapter.importer(url);
}