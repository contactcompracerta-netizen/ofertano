import { mergeFavoriteIds, normalizeFavoriteIds } from "./ids";

export type FavoritesPersistedState = {
  activeIds: string[];
  guestIds: string[];
  accountId: string | null;
};

export type AuthSyncPlan = {
  kind: "hydrate" | "merge";
  mergeIds: string[];
  nextGuestIds: string[];
  nextAccountId: string;
  previewActiveIds: string[];
};

export function emptyFavoritesState(): FavoritesPersistedState {
  return {
    activeIds: [],
    guestIds: [],
    accountId: null,
  };
}

export function planAnonymousWrite(
  state: FavoritesPersistedState,
  ids: unknown,
): FavoritesPersistedState {
  const nextIds = normalizeFavoriteIds(ids);

  if (state.accountId) {
    return {
      ...state,
      activeIds: nextIds,
    };
  }

  return {
    accountId: null,
    activeIds: nextIds,
    guestIds: nextIds,
  };
}

export function planAccountCacheWrite(
  state: FavoritesPersistedState,
  ids: unknown,
): FavoritesPersistedState {
  return {
    ...state,
    activeIds: normalizeFavoriteIds(ids),
  };
}

export function planLogout(
  state: FavoritesPersistedState,
): FavoritesPersistedState {
  const guestIds = normalizeFavoriteIds(state.guestIds);

  return {
    accountId: null,
    guestIds,
    activeIds: guestIds,
  };
}

export function planLiveSignIn(
  state: FavoritesPersistedState,
  userId: string,
  serverIds: unknown,
): AuthSyncPlan {
  const server = normalizeFavoriteIds(serverIds);
  const switchingAccount =
    state.accountId !== null && state.accountId !== userId;

  const guestSnapshot = switchingAccount
    ? normalizeFavoriteIds(state.guestIds)
    : normalizeFavoriteIds(state.activeIds);

  const merged = mergeFavoriteIds(guestSnapshot, server);

  return {
    kind: "merge",
    mergeIds: guestSnapshot,
    nextGuestIds: guestSnapshot,
    nextAccountId: userId,
    previewActiveIds: merged,
  };
}

export function planExistingSession(
  state: FavoritesPersistedState,
  userId: string,
  serverIds: unknown,
  pendingMerge: boolean,
): AuthSyncPlan {
  const server = normalizeFavoriteIds(serverIds);

  if (pendingMerge) {
    return planLiveSignIn(state, userId, server);
  }

  if (state.accountId === userId) {
    return {
      kind: "hydrate",
      mergeIds: [],
      nextGuestIds: normalizeFavoriteIds(state.guestIds),
      nextAccountId: userId,
      previewActiveIds: server,
    };
  }

  if (state.accountId && state.accountId !== userId) {
    return planLiveSignIn(state, userId, server);
  }

  return {
    kind: "merge",
    mergeIds: normalizeFavoriteIds(state.activeIds),
    nextGuestIds: [],
    nextAccountId: userId,
    previewActiveIds: mergeFavoriteIds(state.activeIds, server),
  };
}

export function applyAuthPlan(
  plan: AuthSyncPlan,
  confirmedIds: unknown,
): FavoritesPersistedState {
  return {
    accountId: plan.nextAccountId,
    guestIds: plan.nextGuestIds,
    activeIds: normalizeFavoriteIds(confirmedIds),
  };
}
