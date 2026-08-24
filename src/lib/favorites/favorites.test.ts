import assert from "node:assert/strict";

import { eventForFavoriteMutation } from "./analytics";
import { createFavoritesController } from "./controller";
import {
  mergeFavoriteIds,
  normalizeFavoriteIds,
} from "./ids";
import {
  applyAuthPlan,
  emptyFavoritesState,
  planAnonymousWrite,
  planExistingSession,
  planLiveSignIn,
  planLogout,
} from "./session";
import { createMemoryStorage, readPersistedState } from "./storage";
import { FAVORITES_STORAGE_KEY } from "./constants";
import { readBearerToken } from "./http";
import {
  addAccountFavorite,
  createMemoryFavoritesRepository,
  listAccountFavorites,
  mergeAccountFavorites,
  removeAccountFavorite,
} from "../../services/favorites/account";
import { loadFavoriteProducts } from "../../services/favorites/products";

function sameMembers(actual: string[], expected: string[]) {
  assert.deepEqual([...actual].sort(), [...expected].sort());
}

function createAccountApi(store: Map<string, string[]>, token = "token") {
  let getCalls = 0;
  let mergeCalls = 0;
  let addCalls = 0;
  let removeCalls = 0;

  return {
    getCalls: () => getCalls,
    mergeCalls: () => mergeCalls,
    addCalls: () => addCalls,
    removeCalls: () => removeCalls,
    api: {
      async getIds(accessToken: string) {
        assert.equal(accessToken, token);
        getCalls += 1;
        return [...(store.get("server") ?? [])];
      },
      async add(accessToken: string, productId: string) {
        assert.equal(accessToken, token);
        addCalls += 1;
        const current = store.get("server") ?? [];
        if (!current.includes(productId)) {
          current.push(productId);
        }
        store.set("server", current);
        return [...current];
      },
      async remove(accessToken: string, productId: string) {
        assert.equal(accessToken, token);
        removeCalls += 1;
        const current = (store.get("server") ?? []).filter(
          (id) => id !== productId,
        );
        store.set("server", current);
        return [...current];
      },
      async merge(accessToken: string, ids: string[]) {
        assert.equal(accessToken, token);
        mergeCalls += 1;
        const current = store.get("server") ?? [];
        store.set("server", mergeFavoriteIds(ids, current));
        return [...(store.get("server") ?? [])];
      },
    },
  };
}

async function main() {
// 1. Visitante adiciona A → fica local.
{
  const storage = createMemoryStorage();
  const controller = createFavoritesController({ storage });
  const result = await controller.add("A");
  assert.equal(result.changed, true);
  assert.deepEqual(controller.getIds(), ["A"]);
  assert.equal(JSON.parse(storage.get(FAVORITES_STORAGE_KEY) ?? "[]")[0], "A");
  assert.equal(controller.getState().accountId, null);
}

// 2. Visitante remove A → desaparece.
{
  const storage = createMemoryStorage({
    [FAVORITES_STORAGE_KEY]: JSON.stringify(["A"]),
  });
  const controller = createFavoritesController({ storage });
  const result = await controller.remove("A");
  assert.equal(result.changed, true);
  assert.deepEqual(controller.getIds(), []);
  assert.deepEqual(JSON.parse(storage.get(FAVORITES_STORAGE_KEY) ?? "[]"), []);
}

// 3. Refresh → favoritos locais permanecem.
{
  const storage = createMemoryStorage();
  const first = createFavoritesController({ storage });
  await first.add("A");
  await first.add("B");
  const afterReload = createFavoritesController({ storage });
  sameMembers(afterReload.getIds(), ["A", "B"]);
}

// 4. local [A,B] + servidor [B,C] → login resulta [A,B,C].
{
  const merged = mergeFavoriteIds(["A", "B"], ["B", "C"]);
  sameMembers(merged, ["A", "B", "C"]);

  const storage = createMemoryStorage();
  const server = new Map<string, string[]>([["server", ["B", "C"]]]);
  const account = createAccountApi(server);
  const controller = createFavoritesController({
    storage,
    accountApi: account.api,
    getAccessToken: async () => "token",
  });
  await controller.add("A");
  await controller.add("B");
  await controller.onLiveSignIn("user-x");
  sameMembers(controller.getIds(), ["A", "B", "C"]);
  sameMembers(server.get("server") ?? [], ["A", "B", "C"]);
  assert.equal(controller.getState().accountId, "user-x");
}

// 5. Merge executado novamente → continua [A,B,C].
{
  const storage = createMemoryStorage();
  const server = new Map<string, string[]>([["server", ["B", "C"]]]);
  const account = createAccountApi(server);
  const controller = createFavoritesController({
    storage,
    accountApi: account.api,
    getAccessToken: async () => "token",
  });
  await controller.add("A");
  await controller.add("B");
  await controller.onLiveSignIn("user-x");
  await controller.onLiveSignIn("user-x");
  sameMembers(controller.getIds(), ["A", "B", "C"]);
  sameMembers(server.get("server") ?? [], ["A", "B", "C"]);
}

// 6. Conta X e conta Y no mesmo navegador → não vazam.
{
  const storage = createMemoryStorage();
  const serverX = new Map<string, string[]>([["server", ["X1"]]]);
  const accountX = createAccountApi(serverX);
  const controller = createFavoritesController({
    storage,
    accountApi: accountX.api,
    getAccessToken: async () => "token",
  });

  await controller.add("A");
  await controller.onLiveSignIn("user-x");
  await controller.add("X-ONLY");
  sameMembers(controller.getIds(), ["A", "X1", "X-ONLY"]);

  controller.onSignedOut();
  assert.equal(controller.getState().accountId, null);
  sameMembers(controller.getIds(), ["A"]);
  assert.equal(controller.getIds().includes("X-ONLY"), false);
  assert.equal(controller.getIds().includes("X1"), false);

  const serverY = new Map<string, string[]>([["server", ["Y1"]]]);
  const accountY = createAccountApi(serverY);
  const next = createFavoritesController({
    storage,
    accountApi: accountY.api,
    getAccessToken: async () => "token",
  });
  await next.onLiveSignIn("user-y");
  sameMembers(next.getIds(), ["A", "Y1"]);
  assert.equal(next.getIds().includes("X-ONLY"), false);
  assert.equal(next.getIds().includes("X1"), false);
  sameMembers(serverY.get("server") ?? [], ["A", "Y1"]);
}

// 6b. Troca de conta sem logout também não vaza o cache autenticado.
{
  const state = planAnonymousWrite(emptyFavoritesState(), ["guest"]);
  const signedX = applyAuthPlan(
    planLiveSignIn(state, "user-x", ["X1"]),
    ["guest", "X1", "X-ONLY"],
  );
  const switched = planLiveSignIn(signedX, "user-y", ["Y1"]);
  sameMembers(switched.mergeIds, ["guest"]);
  assert.equal(switched.mergeIds.includes("X-ONLY"), false);
}

// 7. Servidor com Product inexistente → sistema não quebra.
{
  const repository = createMemoryFavoritesRepository();
  await repository.upsertMany("user-x", ["alive", "missing"]);
  const products = {
    async filterActiveIds(ids: string[]) {
      return ids.filter((id) => id === "alive");
    },
  };
  const listed = await listAccountFavorites("user-x", repository, products);
  assert.equal(listed.ok, true);
  if (listed.ok) {
    assert.deepEqual(listed.ids, ["alive"]);
  }
  assert.deepEqual(repository.dump("user-x"), ["alive"]);
}

{
  let findManyCalls = 0;
  const prisma = {
    product: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        findManyCalls += 1;
        return where.id.in
          .filter((id) => id !== "missing")
          .map((id) => ({
            id,
            name: id,
            image: "",
            price: 1,
            oldPrice: null,
            discount: null,
            store: "loja",
            brand: null,
            installments: null,
            rating: null,
            reviews: null,
            stock: null,
          }));
      },
    },
  };
  const products = await loadFavoriteProducts(prisma as never, [
    "alive",
    "missing",
  ]);
  assert.equal(findManyCalls, 1);
  assert.deepEqual(
    products.map((product) => product.id),
    ["alive"],
  );
}

// 8. POST duplicado → não duplica.
{
  const repository = createMemoryFavoritesRepository();
  const products = {
    async filterActiveIds(ids: string[]) {
      return ids;
    },
  };
  const first = await addAccountFavorite("user-x", "A", repository, products);
  const second = await addAccountFavorite("user-x", "A", repository, products);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) {
    assert.deepEqual(first.ids, ["A"]);
    assert.deepEqual(second.ids, ["A"]);
  }
  assert.deepEqual(repository.dump("user-x"), ["A"]);
}

// 9. DELETE duplicado → resposta segura.
{
  const repository = createMemoryFavoritesRepository();
  const products = {
    async filterActiveIds(ids: string[]) {
      return ids;
    },
  };
  await addAccountFavorite("user-x", "A", repository, products);
  const first = await removeAccountFavorite("user-x", "A", repository, products);
  const second = await removeAccountFavorite(
    "user-x",
    "A",
    repository,
    products,
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) {
    assert.deepEqual(first.ids, []);
    assert.deepEqual(second.ids, []);
  }
}

// 10. FAVORITE_ADD/REMOVE só em ação real do usuário.
{
  assert.equal(
    eventForFavoriteMutation("user", false, true),
    "FAVORITE_ADD",
  );
  assert.equal(
    eventForFavoriteMutation("user", true, false),
    "FAVORITE_REMOVE",
  );
  assert.equal(eventForFavoriteMutation("user", true, true), null);
  assert.equal(eventForFavoriteMutation("user", false, false), null);
  assert.equal(eventForFavoriteMutation("hydrate", false, true), null);
  assert.equal(eventForFavoriteMutation("merge", false, true), null);
  assert.equal(eventForFavoriteMutation("sync", true, false), null);
  assert.equal(eventForFavoriteMutation("remote", false, true), null);

  const storage = createMemoryStorage();
  const controller = createFavoritesController({ storage });
  const first = await controller.add("A");
  const duplicate = await controller.add("A");
  assert.equal(first.changed, true);
  assert.equal(duplicate.changed, false);
  assert.equal(
    eventForFavoriteMutation("user", false, first.favorited),
    "FAVORITE_ADD",
  );
  assert.equal(
    eventForFavoriteMutation("user", true, duplicate.favorited),
    null,
  );
}

// 11. Contador do header acompanha o estado.
{
  const storage = createMemoryStorage();
  const controller = createFavoritesController({ storage });
  assert.equal(controller.getIds().length, 0);
  await controller.add("A");
  assert.equal(controller.getIds().length, 1);
  await controller.add("B");
  assert.equal(controller.getIds().length, 2);
  await controller.remove("A");
  assert.equal(controller.getIds().length, 1);
}

// 12. Página /favoritos recebe produtos em lote, sem N+1.
{
  let findManyCalls = 0;
  const prisma = {
    product: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        findManyCalls += 1;
        assert.deepEqual(where.id.in, ["A", "B", "C"]);
        return where.id.in.map((id) => ({
          id,
          name: id,
          image: "",
          price: 10,
          oldPrice: null,
          discount: null,
          store: "loja",
          brand: null,
          installments: null,
          rating: null,
          reviews: null,
          stock: null,
        }));
      },
    },
  };
  const products = await loadFavoriteProducts(prisma as never, [
    "A",
    "B",
    "C",
    "A",
  ]);
  assert.equal(findManyCalls, 1);
  assert.deepEqual(
    products.map((product) => product.id),
    ["A", "B", "C"],
  );
}

// 13. Sincronização entre abas.
{
  const storage = createMemoryStorage();
  let broadcast: ReturnType<typeof readPersistedState> | null = null;
  const tabA = createFavoritesController({
    storage,
    notify: (state) => {
      broadcast = state;
    },
  });
  const tabB = createFavoritesController({
    storage: createMemoryStorage(),
  });

  await tabA.add("A");
  assert.ok(broadcast);
  tabB.applyRemoteState(broadcast!);
  assert.deepEqual(tabB.getIds(), ["A"]);

  const tabC = createFavoritesController({ storage });
  assert.deepEqual(tabC.getIds(), ["A"]);
}

// Identidade por Product.id, nunca por título/preço/URL.
{
  const ids = normalizeFavoriteIds([
    "product-1",
    " product-1 ",
    "Smartphone X",
    "",
    123,
    null,
  ]);
  assert.deepEqual(ids, ["product-1", "Smartphone X"]);
}

// Sessão existente hidrata o servidor sem reaplicar o guest.
{
  const state = applyAuthPlan(
    planLiveSignIn(planAnonymousWrite(emptyFavoritesState(), ["A"]), "user-x", [
      "B",
    ]),
    ["A", "B"],
  );
  const existing = planExistingSession(state, "user-x", ["B", "C"], false);
  assert.equal(existing.kind, "hydrate");
  assert.deepEqual(existing.mergeIds, []);
  assert.deepEqual(existing.previewActiveIds, ["B", "C"]);
}

// Logout restaura o snapshot anônimo.
{
  const loggedOut = planLogout(
    applyAuthPlan(
      planLiveSignIn(planAnonymousWrite(emptyFavoritesState(), ["A"]), "user-x", [
        "B",
      ]),
      ["A", "B"],
    ),
  );
  assert.equal(loggedOut.accountId, null);
  assert.deepEqual(loggedOut.activeIds, ["A"]);
}

// API ignora userId vindo do cliente: identidade só pelo bearer.
{
  const request = new Request("http://localhost/api/favorites", {
    headers: {
      authorization: "Bearer real-token",
    },
  });
  assert.equal(readBearerToken(request), "real-token");
  assert.equal(
    readBearerToken(new Request("http://localhost/api/favorites")),
    null,
  );
}

// Merge da conta também é idempotente no servidor.
{
  const repository = createMemoryFavoritesRepository();
  const products = {
    async filterActiveIds(ids: string[]) {
      return ids.filter((id) => id !== "missing");
    },
  };
  const first = await mergeAccountFavorites(
    "user-x",
    ["A", "B", "missing", "A"],
    repository,
    products,
  );
  const second = await mergeAccountFavorites(
    "user-x",
    ["A", "B"],
    repository,
    products,
  );
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) {
    sameMembers(first.ids, ["A", "B"]);
    sameMembers(second.ids, ["A", "B"]);
  }
}

// Produto inválido é rejeitado no add autenticado.
{
  const repository = createMemoryFavoritesRepository();
  const products = {
    async filterActiveIds() {
      return [];
    },
  };
  const result = await addAccountFavorite(
    "user-x",
    "ghost",
    repository,
    products,
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 400);
  }
  assert.deepEqual(repository.dump("user-x"), []);
}

  console.log("favorites tests: ok");
}

void main();
