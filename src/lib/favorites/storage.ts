import {
  FAVORITES_ACCOUNT_KEY,
  FAVORITES_GUEST_KEY,
  FAVORITES_STORAGE_KEY,
} from "./constants";
import { normalizeFavoriteIds } from "./ids";
import type { FavoritesPersistedState } from "./session";

export type SyncStorage = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

function parseIds(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    return normalizeFavoriteIds(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function createMemoryStorage(
  initial: Record<string, string> = {},
): SyncStorage {
  const map = new Map(Object.entries(initial));

  return {
    get(key) {
      return map.get(key) ?? null;
    },
    set(key, value) {
      map.set(key, value);
    },
    remove(key) {
      map.delete(key);
    },
  };
}

export function createBrowserStorage(): SyncStorage {
  return {
    get(key) {
      if (typeof window === "undefined") {
        return null;
      }

      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      if (typeof window === "undefined") {
        return;
      }

      try {
        window.localStorage.setItem(key, value);
      } catch {
        // quota / private mode
      }
    },
    remove(key) {
      if (typeof window === "undefined") {
        return;
      }

      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}

export function readPersistedState(
  storage: SyncStorage,
): FavoritesPersistedState {
  const activeIds = parseIds(storage.get(FAVORITES_STORAGE_KEY));
  const accountRaw = storage.get(FAVORITES_ACCOUNT_KEY);
  const accountId = accountRaw?.trim() ? accountRaw.trim() : null;
  const guestRaw = storage.get(FAVORITES_GUEST_KEY);

  if (guestRaw == null) {
    return {
      activeIds,
      accountId,
      guestIds: accountId ? [] : activeIds,
    };
  }

  return {
    activeIds,
    accountId,
    guestIds: parseIds(guestRaw),
  };
}

export function writePersistedState(
  storage: SyncStorage,
  state: FavoritesPersistedState,
): void {
  storage.set(FAVORITES_STORAGE_KEY, JSON.stringify(state.activeIds));
  storage.set(FAVORITES_GUEST_KEY, JSON.stringify(state.guestIds));

  if (state.accountId) {
    storage.set(FAVORITES_ACCOUNT_KEY, state.accountId);
  } else {
    storage.remove(FAVORITES_ACCOUNT_KEY);
  }
}
