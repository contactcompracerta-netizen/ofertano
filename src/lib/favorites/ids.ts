import {
  MAX_FAVORITE_IDS,
  MAX_FAVORITE_ID_LENGTH,
} from "./constants";

export function isFavoriteProductId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= MAX_FAVORITE_ID_LENGTH
  );
}

export function normalizeFavoriteIds(
  input: unknown,
  max = MAX_FAVORITE_IDS,
): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const seen = new Set<string>();
  const ids: string[] = [];

  for (const item of input) {
    if (!isFavoriteProductId(item)) {
      continue;
    }

    const id = item.trim();

    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);

    if (ids.length >= max) {
      break;
    }
  }

  return ids;
}

export function mergeFavoriteIds(
  localIds: unknown,
  serverIds: unknown,
  max = MAX_FAVORITE_IDS,
): string[] {
  const local = normalizeFavoriteIds(localIds, max);
  const server = normalizeFavoriteIds(serverIds, max);
  const seen = new Set(local);
  const merged = [...local];

  for (const id of server) {
    if (seen.has(id)) {
      continue;
    }

    seen.add(id);
    merged.push(id);

    if (merged.length >= max) {
      break;
    }
  }

  return merged;
}

export function favoriteIdsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((id, index) => id === right[index]);
}
