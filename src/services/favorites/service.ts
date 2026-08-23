import {
  FavoriteError,
  FAVORITE_ERROR_CODES,
  isUniqueConstraintError,
} from "./errors";
import { normalizarId, normalizarIds } from "./ids";
import type {
  AddFavoriteResult,
  FavoriteStore,
  MergeFavoritesResult,
  RemoveFavoriteResult,
} from "./types";

function exigirUserId(userId: string): string {
  const id = normalizarId(userId);

  if (!id) {
    throw new FavoriteError(
      FAVORITE_ERROR_CODES.INVALID_USER,
      "Usuário inválido."
    );
  }

  return id;
}

function exigirProductId(productId: unknown): string {
  const id = normalizarId(productId);

  if (!id) {
    throw new FavoriteError(
      FAVORITE_ERROR_CODES.INVALID_PRODUCT_ID,
      "Produto inválido."
    );
  }

  return id;
}

export function criarServicoFavoritos(store: FavoriteStore) {
  async function adicionarFavorito(
    userId: string,
    productId: unknown
  ): Promise<AddFavoriteResult> {
    const usuario = exigirUserId(userId);
    const produto = exigirProductId(productId);

    const existe = await store.productExists(produto);

    if (!existe) {
      throw new FavoriteError(
        FAVORITE_ERROR_CODES.PRODUCT_NOT_FOUND,
        "Produto não encontrado."
      );
    }

    const atual = await store.findByUserAndProduct(
      usuario,
      produto
    );

    if (atual) {
      return {
        favorite: atual,
        created: false,
      };
    }

    try {
      const favorite = await store.create(usuario, produto);

      return {
        favorite,
        created: true,
      };
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const existente = await store.findByUserAndProduct(
        usuario,
        produto
      );

      if (!existente) {
        throw error;
      }

      return {
        favorite: existente,
        created: false,
      };
    }
  }

  async function removerFavorito(
    userId: string,
    productId: unknown
  ): Promise<RemoveFavoriteResult> {
    const usuario = exigirUserId(userId);
    const produto = exigirProductId(productId);

    const removed = await store.deleteByUserAndProduct(
      usuario,
      produto
    );

    return {
      productId: produto,
      removed,
    };
  }

  async function produtoEstaFavoritado(
    userId: string,
    productId: unknown
  ): Promise<boolean> {
    const usuario = exigirUserId(userId);
    const produto = exigirProductId(productId);
    const atual = await store.findByUserAndProduct(
      usuario,
      produto
    );

    return Boolean(atual);
  }

  async function listarFavoritos(userId: string) {
    const usuario = exigirUserId(userId);
    return store.listByUser(usuario);
  }

  async function unirFavoritosLocais(
    userId: string,
    idsLocais: unknown
  ): Promise<MergeFavoritesResult> {
    const usuario = exigirUserId(userId);
    const candidatos = normalizarIds(idsLocais);

    const added: string[] = [];
    const alreadyPresent: string[] = [];
    const skippedInvalid: string[] = [];

    for (const productId of candidatos) {
      try {
        const resultado = await adicionarFavorito(
          usuario,
          productId
        );

        if (resultado.created) {
          added.push(productId);
        } else {
          alreadyPresent.push(productId);
        }
      } catch (error) {
        if (
          error instanceof FavoriteError &&
          error.code === FAVORITE_ERROR_CODES.PRODUCT_NOT_FOUND
        ) {
          skippedInvalid.push(productId);
          continue;
        }

        throw error;
      }
    }

    const atuais = await store.listByUser(usuario);

    return {
      productIds: atuais.map((item) => item.productId),
      added,
      alreadyPresent,
      skippedInvalid,
    };
  }

  return {
    adicionarFavorito,
    removerFavorito,
    produtoEstaFavoritado,
    listarFavoritos,
    unirFavoritosLocais,
  };
}

export type FavoritesService = ReturnType<
  typeof criarServicoFavoritos
>;
