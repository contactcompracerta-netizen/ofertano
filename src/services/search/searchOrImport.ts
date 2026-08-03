import { saveProduct } from "@/services/database/saveProduct";
import { detectarMarketplace } from "@/services/importers/core/detector";
import { importarProduto } from "@/services/importers";

import { findProduct } from "./findProduct";

export async function searchOrImport(
  url: string,
  externalId?: string | null,
  sourceQuery?: string | null,
) {
  const marketplace =
    detectarMarketplace(url);

  const codigoRecebido =
    externalId?.trim() || null;

  if (codigoRecebido) {
    const existente = await findProduct(
      marketplace,
      codigoRecebido,
    );

    if (existente) {
      console.log(
        "Produto encontrado no catálogo do Ofertano.",
      );

      return existente;
    }
  }

  console.log(
    "Produto não encontrado. Iniciando importação sob demanda.",
  );

  const produto =
    await importarProduto(url);

  /*
   * Verifica novamente usando o código retornado
   * pelo próprio marketplace. Isso evita duplicidade
   * caso o externalId recebido estivesse incorreto.
   */
  const existenteAposImportacao =
    await findProduct(
      marketplace,
      produto.externalId,
    );

  if (existenteAposImportacao) {
    return existenteAposImportacao;
  }

  /*
   * O null explícito impede que a URL comum da loja
   * seja tratada como link de afiliado.
   *
   * A oferta será publicada como PENDING_AFFILIATE
   * e aparecerá futuramente na aba Revisão.
   */
  return saveProduct(
    produto,
    null,
    {
      discoverySource:
        "ON_DEMAND_SEARCH",
      autoCreated: true,
      sourceQuery:
        sourceQuery?.trim() || null,
    },
  );
}