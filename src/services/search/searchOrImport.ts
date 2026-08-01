import { importarProduto } from "@/services/importers";
import { saveProduct } from "@/services/database/saveProduct";
import { findProduct } from "./findProduct";

export async function searchOrImport(
  url: string,
  externalId: string
) {

  const existente =
    await findProduct(externalId);

  if (existente) {

    console.log("Produto encontrado no banco.");

    return existente;

  }

  console.log("Importando produto...");

  const produto =
    await importarProduto(url);

  return saveProduct(produto);

}