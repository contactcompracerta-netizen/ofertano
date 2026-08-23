import { randomUUID } from "node:crypto";

import { criarErroDuplicado } from "./errors";
import type { FavoriteRecord, FavoriteStore } from "./types";

type MemoryState = {
  products: Set<string>;
  favorites: FavoriteRecord[];
};

export function criarMemoryFavoriteStore(
  productIds: string[] = []
): FavoriteStore & { state: MemoryState } {
  const state: MemoryState = {
    products: new Set(productIds),
    favorites: [],
  };

  const store: FavoriteStore & { state: MemoryState } = {
    state,

    async productExists(productId) {
      return state.products.has(productId);
    },

    async findByUserAndProduct(userId, productId) {
      return (
        state.favorites.find(
          (item) =>
            item.userId === userId && item.productId === productId
        ) ?? null
      );
    },

    async listByUser(userId) {
      return state.favorites
        .filter((item) => item.userId === userId)
        .slice()
        .sort(
          (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
        );
    },

    async create(userId, productId) {
      const existing = await store.findByUserAndProduct(
        userId,
        productId
      );

      if (existing) {
        throw criarErroDuplicado();
      }

      const record: FavoriteRecord = {
        id: randomUUID(),
        userId,
        productId,
        createdAt: new Date(),
      };

      state.favorites.push(record);
      return record;
    },

    async deleteByUserAndProduct(userId, productId) {
      const index = state.favorites.findIndex(
        (item) =>
          item.userId === userId && item.productId === productId
      );

      if (index < 0) {
        return false;
      }

      state.favorites.splice(index, 1);
      return true;
    },
  };

  return store;
}
