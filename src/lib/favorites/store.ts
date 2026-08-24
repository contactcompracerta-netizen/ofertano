"use client";

import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabaseClient";

import { createBrowserFavoritesApi } from "./clientApi";
import {
  FAVORITES_ACCOUNT_KEY,
  FAVORITES_CHANNEL,
  FAVORITES_EVENT,
  FAVORITES_GUEST_KEY,
  FAVORITES_PENDING_MERGE_KEY,
  FAVORITES_STORAGE_KEY,
} from "./constants";
import {
  createFavoritesController,
  type FavoritesController,
} from "./controller";
import type { FavoritesPersistedState } from "./session";
import { createBrowserStorage } from "./storage";

function readSessionFlag(key: string) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeSessionFlag(key: string, value: boolean) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (value) {
      window.sessionStorage.setItem(key, "1");
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export function markFavoritesMergePending() {
  writeSessionFlag(FAVORITES_PENDING_MERGE_KEY, true);
}

export function consumeFavoritesMergePending() {
  const pending = readSessionFlag(FAVORITES_PENDING_MERGE_KEY);
  if (pending) {
    writeSessionFlag(FAVORITES_PENDING_MERGE_KEY, false);
  }
  return pending;
}

async function getAccessToken() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

const accountApi = createBrowserFavoritesApi(getAccessToken);

function dispatchFavoritesChanged() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(FAVORITES_EVENT));
}

let channel: BroadcastChannel | null = null;

function getChannel() {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return null;
  }

  if (!channel) {
    channel = new BroadcastChannel(FAVORITES_CHANNEL);
  }

  return channel;
}

function broadcastState(state: FavoritesPersistedState) {
  dispatchFavoritesChanged();
  getChannel()?.postMessage(state);
}

export const favoritesController: FavoritesController = createFavoritesController({
  storage: createBrowserStorage(),
  accountApi,
  getAccessToken,
  notify: broadcastState,
});

let idsSnapshot = favoritesController.getIds();

favoritesController.subscribe(() => {
  idsSnapshot = favoritesController.getIds();
});

export function subscribeFavorites(listener: () => void) {
  return favoritesController.subscribe(listener);
}

export function getFavoriteIds() {
  return idsSnapshot;
}

export function getFavoriteCount() {
  return idsSnapshot.length;
}

export function isProductFavorite(productId: string) {
  return idsSnapshot.includes(productId);
}

function isFavoritesStorageKey(key: string | null) {
  return (
    key === FAVORITES_STORAGE_KEY ||
    key === FAVORITES_GUEST_KEY ||
    key === FAVORITES_ACCOUNT_KEY
  );
}

let browserBound = false;

function bindBrowserSync() {
  if (browserBound || typeof window === "undefined") {
    return;
  }

  browserBound = true;

  window.addEventListener("storage", (event) => {
    if (!isFavoritesStorageKey(event.key)) {
      return;
    }

    favoritesController.reloadFromStorage();
  });

  const favoritesChannel = getChannel();

  favoritesChannel?.addEventListener("message", (event) => {
    const data = event.data as FavoritesPersistedState | null;

    if (!data || !Array.isArray(data.activeIds)) {
      return;
    }

    favoritesController.applyRemoteState({
      activeIds: data.activeIds,
      guestIds: Array.isArray(data.guestIds) ? data.guestIds : [],
      accountId:
        typeof data.accountId === "string" && data.accountId.trim()
          ? data.accountId
          : null,
    });
  });
}

bindBrowserSync();

export async function syncFavoritesAfterAuthentication() {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;

  if (!userId) {
    return;
  }

  markFavoritesMergePending();
  await favoritesController.onLiveSignIn(userId);
  consumeFavoritesMergePending();
}

export function bindFavoritesAuthAndSync(
  client: SupabaseClient,
): () => void {
  bindBrowserSync();

  const {
    data: { subscription },
  } = client.auth.onAuthStateChange(
    (event: AuthChangeEvent, session: Session | null) => {
      if (event === "SIGNED_OUT") {
        favoritesController.onSignedOut();
        return;
      }

      const userId = session?.user?.id;

      if (!userId) {
        return;
      }

      if (event === "SIGNED_IN") {
        const scopedToUser =
          favoritesController.getState().accountId === userId;
        const pending = consumeFavoritesMergePending();

        if (scopedToUser && !pending) {
          void favoritesController.onExistingSession(userId, false);
          return;
        }

        void favoritesController.onLiveSignIn(userId);
        return;
      }

      if (event === "INITIAL_SESSION") {
        const pending = consumeFavoritesMergePending();
        void favoritesController.onExistingSession(userId, pending);
      }
    },
  );

  return () => {
    subscription.unsubscribe();
  };
}
