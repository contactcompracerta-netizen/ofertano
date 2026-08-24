"use client";

import { useSyncExternalStore } from "react";

import {
  getFavoriteCount,
  getFavoriteIds,
  isProductFavorite,
  subscribeFavorites,
} from "./store";

export function useFavoriteIds() {
  return useSyncExternalStore(
    subscribeFavorites,
    getFavoriteIds,
    (): string[] => [],
  );
}

export function useFavoriteCount() {
  return useSyncExternalStore(
    subscribeFavorites,
    getFavoriteCount,
    () => 0,
  );
}

export function useIsFavorite(productId: string) {
  return useSyncExternalStore(
    subscribeFavorites,
    () => isProductFavorite(productId),
    () => false,
  );
}
