import type { PrismaClient } from "@prisma/client";

import { MAX_FAVORITE_IDS } from "@/lib/favorites/constants";
import {
  isFavoriteProductId,
  normalizeFavoriteIds,
} from "@/lib/favorites/ids";

export type FavoriteRow = {
  product_id: string;
};

export type FavoritesRepository = {
  list(userId: string): Promise<FavoriteRow[]>;
  upsertMany(userId: string, productIds: string[]): Promise<void>;
  deleteOne(userId: string, productId: string): Promise<void>;
  deleteMany(userId: string, productIds: string[]): Promise<void>;
};

export type ProductIdValidator = {
  filterActiveIds(ids: string[]): Promise<string[]>;
};

export type AccountFavoriteResult =
  | { ok: true; ids: string[] }
  | { ok: false; status: number; error: string };

type UserFavoritesTable = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      order: (
        column: string,
        options: { ascending: boolean },
      ) => PromiseLike<{
        data: FavoriteRow[] | null;
        error: { message: string } | null;
      }>;
    };
  };
  upsert: (
    rows: Array<{ user_id: string; product_id: string }>,
    options: { onConflict: string; ignoreDuplicates: boolean },
  ) => PromiseLike<{ error: { message: string } | null }>;
  delete: () => {
    eq: (column: string, value: string) => {
      eq: (
        column: string,
        value: string,
      ) => PromiseLike<{ error: { message: string } | null }>;
      in: (
        column: string,
        values: string[],
      ) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
};

export function createSupabaseFavoritesRepository(client: {
  from: (table: string) => UserFavoritesTable;
}): FavoritesRepository {
  return {
    async list(userId) {
      const { data, error } = await client
        .from("user_favorites")
        .select("product_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) {
        throw new Error(error.message);
      }

      return data ?? [];
    },
    async upsertMany(userId, productIds) {
      if (productIds.length === 0) {
        return;
      }

      const { error } = await client.from("user_favorites").upsert(
        productIds.map((product_id) => ({
          user_id: userId,
          product_id,
        })),
        {
          onConflict: "user_id,product_id",
          ignoreDuplicates: true,
        },
      );

      if (error) {
        throw new Error(error.message);
      }
    },
    async deleteOne(userId, productId) {
      const { error } = await client
        .from("user_favorites")
        .delete()
        .eq("user_id", userId)
        .eq("product_id", productId);

      if (error) {
        throw new Error(error.message);
      }
    },
    async deleteMany(userId, productIds) {
      if (productIds.length === 0) {
        return;
      }

      const { error } = await client
        .from("user_favorites")
        .delete()
        .eq("user_id", userId)
        .in("product_id", productIds);

      if (error) {
        throw new Error(error.message);
      }
    },
  };
}

export function favoritesRepositoryFromSupabase(client: {
  from: (table: string) => unknown;
}): FavoritesRepository {
  return createSupabaseFavoritesRepository({
    from: (table) => client.from(table) as unknown as UserFavoritesTable,
  });
}

export function createPrismaProductValidator(
  prisma: Pick<PrismaClient, "product">,
): ProductIdValidator {
  return {
    async filterActiveIds(ids: string[]) {
      const unique = normalizeFavoriteIds(ids);

      if (unique.length === 0) {
        return [];
      }

      const rows = await prisma.product.findMany({
        where: {
          id: {
            in: unique,
          },
          active: true,
        },
        select: {
          id: true,
        },
      });

      const existing = new Set(rows.map((row) => row.id));
      return unique.filter((id) => existing.has(id));
    },
  };
}

export function createMemoryFavoritesRepository(): FavoritesRepository & {
  dump(userId: string): string[];
} {
  const rows = new Map<string, string[]>();

  function listIds(userId: string) {
    return [...(rows.get(userId) ?? [])];
  }

  return {
    dump: listIds,
    async list(userId) {
      return listIds(userId).map((product_id) => ({ product_id }));
    },
    async upsertMany(userId, productIds) {
      const current = listIds(userId);
      const seen = new Set(current);

      for (const id of productIds) {
        if (seen.has(id)) {
          continue;
        }

        seen.add(id);
        current.push(id);
      }

      rows.set(userId, current.slice(0, MAX_FAVORITE_IDS));
    },
    async deleteOne(userId, productId) {
      rows.set(
        userId,
        listIds(userId).filter((id) => id !== productId),
      );
    },
    async deleteMany(userId, productIds) {
      const remove = new Set(productIds);
      rows.set(
        userId,
        listIds(userId).filter((id) => !remove.has(id)),
      );
    },
  };
}

async function listValidIds(
  userId: string,
  repository: FavoritesRepository,
  products: ProductIdValidator,
): Promise<string[]> {
  const rows = await repository.list(userId);
  const raw = normalizeFavoriteIds(rows.map((row) => row.product_id));
  const valid = await products.filterActiveIds(raw);
  const validSet = new Set(valid);
  const orphans = raw.filter((id) => !validSet.has(id));

  if (orphans.length > 0) {
    await repository.deleteMany(userId, orphans);
  }

  return valid;
}

export async function listAccountFavorites(
  userId: string,
  repository: FavoritesRepository,
  products: ProductIdValidator,
): Promise<AccountFavoriteResult> {
  try {
    const ids = await listValidIds(userId, repository, products);
    return { ok: true, ids };
  } catch (error) {
    console.error("Erro ao listar favoritos da conta:", error);
    return {
      ok: false,
      status: 500,
      error: "Não foi possível carregar seus favoritos.",
    };
  }
}

export async function addAccountFavorite(
  userId: string,
  productId: unknown,
  repository: FavoritesRepository,
  products: ProductIdValidator,
): Promise<AccountFavoriteResult> {
  if (!isFavoriteProductId(productId)) {
    return {
      ok: false,
      status: 400,
      error: "Produto inválido.",
    };
  }

  const id = productId.trim();

  try {
    const valid = await products.filterActiveIds([id]);

    if (valid.length === 0) {
      return {
        ok: false,
        status: 400,
        error: "Produto inválido.",
      };
    }

    await repository.upsertMany(userId, valid);
    const ids = await listValidIds(userId, repository, products);
    return { ok: true, ids };
  } catch (error) {
    console.error("Erro ao adicionar favorito:", error);
    return {
      ok: false,
      status: 500,
      error: "Não foi possível salvar o favorito.",
    };
  }
}

export async function removeAccountFavorite(
  userId: string,
  productId: unknown,
  repository: FavoritesRepository,
  products: ProductIdValidator,
): Promise<AccountFavoriteResult> {
  if (!isFavoriteProductId(productId)) {
    return {
      ok: false,
      status: 400,
      error: "Produto inválido.",
    };
  }

  try {
    await repository.deleteOne(userId, productId.trim());
    const ids = await listValidIds(userId, repository, products);
    return { ok: true, ids };
  } catch (error) {
    console.error("Erro ao remover favorito:", error);
    return {
      ok: false,
      status: 500,
      error: "Não foi possível remover o favorito.",
    };
  }
}

export async function mergeAccountFavorites(
  userId: string,
  incoming: unknown,
  repository: FavoritesRepository,
  products: ProductIdValidator,
): Promise<AccountFavoriteResult> {
  if (!Array.isArray(incoming)) {
    return {
      ok: false,
      status: 400,
      error: "Lista de favoritos inválida.",
    };
  }

  try {
    const requested = normalizeFavoriteIds(incoming);
    const validIncoming = await products.filterActiveIds(requested);
    await repository.upsertMany(userId, validIncoming);
    const ids = await listValidIds(userId, repository, products);
    return {
      ok: true,
      ids,
    };
  } catch (error) {
    console.error("Erro ao sincronizar favoritos:", error);
    return {
      ok: false,
      status: 500,
      error: "Não foi possível sincronizar seus favoritos.",
    };
  }
}
