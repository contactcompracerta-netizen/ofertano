import { mercadoLivreFetch } from "@/lib/mercadolivre";

import type {
  MercadoLivreCatalogItems,
  MercadoLivreCatalogProduct,
  MercadoLivreCategory,
  MercadoLivreDescription,
  MercadoLivreItem,
  MercadoLivreReviews,
  MercadoLivreUserProduct,
  MercadoLivreUserProductItemSearch,
} from "./types";

type MercadoLivreMultigetItem = {
  code?: number;
  body?: MercadoLivreItem & {
    message?: string;
    error?: string;
    status?: number;
  };
};

export async function getItem(
  itemId: string
): Promise<MercadoLivreItem> {
  /*
   * Alguns anúncios públicos podem responder 403
   * na consulta individual:
   *
   * /items/{ITEM_ID}
   *
   * Nesses casos tentamos o Multiget oficial:
   *
   * /items?ids={ITEM_ID}
   *
   * O Multiget retorna uma lista no formato:
   *
   * [
   *   {
   *     code: 200,
   *     body: { ...item }
   *   }
   * ]
   */
  let erroConsultaIndividual: unknown = null;

  try {
    return await mercadoLivreFetch(
      `/items/${encodeURIComponent(itemId)}`
    ) as MercadoLivreItem;
  } catch (error) {
    erroConsultaIndividual = error;
  }

  try {
    const resposta = await mercadoLivreFetch(
      `/items?ids=${encodeURIComponent(itemId)}`
    ) as MercadoLivreMultigetItem[];

    if (
      !Array.isArray(resposta) ||
      resposta.length === 0
    ) {
      throw new Error(
        `Mercado Livre Multiget não retornou o item ${itemId}.`
      );
    }

    const resultado = resposta.find(
      (entrada) =>
        entrada.body?.id === itemId
    ) ?? resposta[0];

    if (
      resultado?.code === 200 &&
      resultado.body?.id
    ) {
      return resultado.body;
    }

    const detalhes =
      resultado?.body
        ? JSON.stringify(resultado.body)
        : "sem detalhes";

    throw new Error(
      `Mercado Livre Multiget para ${itemId} retornou ` +
        `${resultado?.code ?? "código desconhecido"}: ${detalhes}`
    );
  } catch (erroMultiget) {
    /*
     * Se o próprio Multiget informou uma resposta
     * estruturada, ela é mais útil para diagnóstico.
     */
    if (
      erroMultiget instanceof Error &&
      erroMultiget.message.includes(
        "Mercado Livre Multiget"
      )
    ) {
      throw erroMultiget;
    }

    /*
     * Caso o fallback nem consiga ser executado,
     * preservamos o erro original da consulta
     * individual.
     */
    if (erroConsultaIndividual instanceof Error) {
      throw erroConsultaIndividual;
    }

    throw erroMultiget;
  }
}

export async function getCatalogProduct(
  productId: string
): Promise<MercadoLivreCatalogProduct> {
  return mercadoLivreFetch(
    `/products/${productId}`
  ) as Promise<MercadoLivreCatalogProduct>;
}

export async function getCatalogItems(
  productId: string
): Promise<MercadoLivreCatalogItems> {
  return mercadoLivreFetch(
    `/products/${productId}/items`
  ) as Promise<MercadoLivreCatalogItems>;
}

export async function getUserProduct(
  userProductId: string
): Promise<MercadoLivreUserProduct> {
  return mercadoLivreFetch(
    `/user-products/${userProductId}`
  ) as Promise<MercadoLivreUserProduct>;
}

export async function searchUserProductItems(
  userId: number,
  userProductId: string
): Promise<MercadoLivreUserProductItemSearch> {
  return mercadoLivreFetch(
    `/users/${userId}/items/search?user_product_id=${encodeURIComponent(
      userProductId
    )}`
  ) as Promise<MercadoLivreUserProductItemSearch>;
}

export async function getCategory(
  categoryId: string
): Promise<MercadoLivreCategory> {
  return mercadoLivreFetch(
    `/categories/${categoryId}`
  ) as Promise<MercadoLivreCategory>;
}

export async function getDescription(
  itemId: string
): Promise<MercadoLivreDescription> {
  return mercadoLivreFetch(
    `/items/${itemId}/description`
  ) as Promise<MercadoLivreDescription>;
}

export async function getReviews(
  itemId: string
): Promise<MercadoLivreReviews> {
  return mercadoLivreFetch(
    `/reviews/item/${itemId}`
  ) as Promise<MercadoLivreReviews>;
}