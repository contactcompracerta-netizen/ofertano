import { favoriteIdsEqual, isFavoriteProductId, normalizeFavoriteIds } from "./ids";
import {
  applyAuthPlan,
  planAccountCacheWrite,
  planAnonymousWrite,
  planExistingSession,
  planLiveSignIn,
  planLogout,
  type FavoritesPersistedState,
} from "./session";
import {
  readPersistedState,
  writePersistedState,
  type SyncStorage,
} from "./storage";

export type FavoritesAccountApi = {
  getIds(accessToken: string): Promise<string[]>;
  add(accessToken: string, productId: string): Promise<string[]>;
  remove(accessToken: string, productId: string): Promise<string[]>;
  merge(accessToken: string, ids: string[]): Promise<string[]>;
};

export type FavoriteMutationResult = {
  changed: boolean;
  favorited: boolean;
  ids: string[];
};

export type FavoritesController = {
  getState(): FavoritesPersistedState;
  getIds(): string[];
  subscribe(listener: () => void): () => void;
  add(productId: string): Promise<FavoriteMutationResult>;
  remove(productId: string): Promise<FavoriteMutationResult>;
  toggle(productId: string): Promise<FavoriteMutationResult>;
  replaceActiveIds(ids: string[]): void;
  applyRemoteState(state: FavoritesPersistedState, persist?: boolean): void;
  reloadFromStorage(): void;
  onLiveSignIn(userId: string): Promise<void>;
  onExistingSession(userId: string, pendingMerge: boolean): Promise<void>;
  onSignedOut(): void;
};

function enqueue(
  chains: Map<string, Promise<unknown>>,
  key: string,
  task: () => Promise<FavoriteMutationResult>,
): Promise<FavoriteMutationResult> {
  const next = (chains.get(key) ?? Promise.resolve()).then(task, task);
  chains.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export function createFavoritesController(adapters: {
  storage: SyncStorage;
  accountApi?: FavoritesAccountApi;
  getAccessToken?: () => Promise<string | null>;
  notify?: (state: FavoritesPersistedState) => void;
}): FavoritesController {
  let snapshot = readPersistedState(adapters.storage);
  const listeners = new Set<() => void>();
  const chains = new Map<string, Promise<unknown>>();
  let authChain: Promise<void> = Promise.resolve();

  function emit(next: FavoritesPersistedState, persist = true) {
    const unchanged =
      snapshot.accountId === next.accountId &&
      favoriteIdsEqual(snapshot.activeIds, next.activeIds) &&
      favoriteIdsEqual(snapshot.guestIds, next.guestIds);

    snapshot = next;

    if (persist) {
      writePersistedState(adapters.storage, next);
    }

    if (unchanged) {
      return;
    }

    if (persist) {
      adapters.notify?.(next);
    }

    listeners.forEach((listener) => listener());
  }

  function writeLocal(ids: string[]): FavoritesPersistedState {
    return snapshot.accountId
      ? planAccountCacheWrite(snapshot, ids)
      : planAnonymousWrite(snapshot, ids);
  }

  async function syncMutation(
    productId: string,
    action: "add" | "remove",
    previous: FavoritesPersistedState,
    optimistic: FavoritesPersistedState,
  ): Promise<FavoriteMutationResult> {
    if (!optimistic.accountId || !adapters.accountApi || !adapters.getAccessToken) {
      return {
        changed: true,
        favorited: action === "add",
        ids: optimistic.activeIds,
      };
    }

    const token = await adapters.getAccessToken();

    if (!token) {
      return {
        changed: true,
        favorited: action === "add",
        ids: optimistic.activeIds,
      };
    }

    try {
      const ids =
        action === "add"
          ? await adapters.accountApi.add(token, productId)
          : await adapters.accountApi.remove(token, productId);

      emit({
        ...optimistic,
        activeIds: normalizeFavoriteIds(ids),
      });

      return {
        changed: true,
        favorited: action === "add",
        ids: snapshot.activeIds,
      };
    } catch {
      emit(previous);
      return {
        changed: false,
        favorited: previous.activeIds.includes(productId),
        ids: previous.activeIds,
      };
    }
  }

  async function addInternal(productId: string): Promise<FavoriteMutationResult> {
    if (!isFavoriteProductId(productId)) {
      return {
        changed: false,
        favorited: false,
        ids: snapshot.activeIds,
      };
    }

    const id = productId.trim();

    if (snapshot.activeIds.includes(id)) {
      return {
        changed: false,
        favorited: true,
        ids: snapshot.activeIds,
      };
    }

    const previous = snapshot;
    const optimistic = writeLocal([...snapshot.activeIds, id]);
    emit(optimistic);
    return syncMutation(id, "add", previous, optimistic);
  }

  async function removeInternal(
    productId: string,
  ): Promise<FavoriteMutationResult> {
    if (!isFavoriteProductId(productId)) {
      return {
        changed: false,
        favorited: false,
        ids: snapshot.activeIds,
      };
    }

    const id = productId.trim();

    if (!snapshot.activeIds.includes(id)) {
      return {
        changed: false,
        favorited: false,
        ids: snapshot.activeIds,
      };
    }

    const previous = snapshot;
    const optimistic = writeLocal(
      snapshot.activeIds.filter((item) => item !== id),
    );
    emit(optimistic);
    return syncMutation(id, "remove", previous, optimistic);
  }

  function queueAuth(task: () => Promise<void>) {
    authChain = authChain.then(task, task);
    return authChain;
  }

  async function confirmPlan(
    plan: ReturnType<typeof planLiveSignIn>,
    serverIds: string[],
  ) {
    const token = adapters.getAccessToken
      ? await adapters.getAccessToken()
      : null;

    if (token && adapters.accountApi && plan.kind === "merge") {
      try {
        const confirmed = await adapters.accountApi.merge(token, plan.mergeIds);
        emit(applyAuthPlan(plan, confirmed));
        return;
      } catch {
        emit(applyAuthPlan(plan, plan.previewActiveIds));
        return;
      }
    }

    emit(
      applyAuthPlan(
        plan,
        plan.kind === "hydrate" ? serverIds : plan.previewActiveIds,
      ),
    );
  }

  return {
    getState() {
      return snapshot;
    },
    getIds() {
      return snapshot.activeIds;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    add(productId) {
      return enqueue(chains, productId.trim(), () => addInternal(productId));
    },
    remove(productId) {
      return enqueue(chains, productId.trim(), () =>
        removeInternal(productId),
      );
    },
    toggle(productId) {
      const id = productId.trim();
      return enqueue(chains, id, () => {
        if (snapshot.activeIds.includes(id)) {
          return removeInternal(id);
        }

        return addInternal(id);
      });
    },
    replaceActiveIds(ids) {
      emit(writeLocal(ids));
    },
    applyRemoteState(state, persist = false) {
      emit(
        {
          accountId: state.accountId,
          activeIds: normalizeFavoriteIds(state.activeIds),
          guestIds: normalizeFavoriteIds(state.guestIds),
        },
        persist,
      );
    },
    reloadFromStorage() {
      emit(readPersistedState(adapters.storage), false);
    },
    onLiveSignIn(userId) {
      return queueAuth(async () => {
        const current = snapshot;
        const token = adapters.getAccessToken
          ? await adapters.getAccessToken()
          : null;

        let serverIds: string[] = [];

        if (token && adapters.accountApi) {
          try {
            serverIds = await adapters.accountApi.getIds(token);
          } catch {
            serverIds = [];
          }
        }

        const plan =
          current.accountId === userId
            ? planExistingSession(current, userId, serverIds, false)
            : planLiveSignIn(current, userId, serverIds);

        await confirmPlan(plan, serverIds);
      });
    },
    onExistingSession(userId, pendingMerge) {
      return queueAuth(async () => {
        const current = snapshot;
        const token = adapters.getAccessToken
          ? await adapters.getAccessToken()
          : null;

        let serverIds: string[] = [];

        if (token && adapters.accountApi) {
          try {
            serverIds = await adapters.accountApi.getIds(token);
          } catch {
            serverIds = [];
          }
        }

        await confirmPlan(
          planExistingSession(current, userId, serverIds, pendingMerge),
          serverIds,
        );
      });
    },
    onSignedOut() {
      emit(planLogout(snapshot));
    },
  };
}
