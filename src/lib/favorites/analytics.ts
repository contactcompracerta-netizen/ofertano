export type FavoriteAnalyticsSource =
  | "user"
  | "hydrate"
  | "merge"
  | "sync"
  | "remote";

export type FavoriteAnalyticsEvent = "FAVORITE_ADD" | "FAVORITE_REMOVE";

export function eventForFavoriteMutation(
  source: FavoriteAnalyticsSource,
  wasFavorite: boolean,
  isFavorite: boolean,
): FavoriteAnalyticsEvent | null {
  if (source !== "user") {
    return null;
  }

  if (!wasFavorite && isFavorite) {
    return "FAVORITE_ADD";
  }

  if (wasFavorite && !isFavorite) {
    return "FAVORITE_REMOVE";
  }

  return null;
}
