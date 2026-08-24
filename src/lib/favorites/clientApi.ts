import { normalizeFavoriteIds } from "./ids";

const ACCOUNT_ENDPOINT = "/api/favorites";

async function parseIdsResponse(response: Response): Promise<string[]> {
  const data = (await response.json()) as {
    success?: boolean;
    error?: string;
    ids?: unknown;
  };

  if (!response.ok || !data.success) {
    throw new Error(data.error || "Não foi possível sincronizar seus favoritos.");
  }

  return normalizeFavoriteIds(data.ids);
}

export function createBrowserFavoritesApi(getAccessToken: () => Promise<string | null>) {
  async function authorized(init: RequestInit) {
    const token = await getAccessToken();

    if (!token) {
      throw new Error("Não autenticado.");
    }

    return fetch(ACCOUNT_ENDPOINT, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
      credentials: "same-origin",
      cache: "no-store",
    });
  }

  return {
    async getIds() {
      const response = await authorized({ method: "GET" });
      return parseIdsResponse(response);
    },
    async add(_accessToken: string, productId: string) {
      const response = await authorized({
        method: "POST",
        body: JSON.stringify({ action: "add", productId }),
      });
      return parseIdsResponse(response);
    },
    async remove(_accessToken: string, productId: string) {
      const response = await authorized({
        method: "DELETE",
        body: JSON.stringify({ productId }),
      });
      return parseIdsResponse(response);
    },
    async merge(_accessToken: string, ids: string[]) {
      const response = await authorized({
        method: "POST",
        body: JSON.stringify({ action: "merge", ids }),
      });
      return parseIdsResponse(response);
    },
  };
}

export async function fetchFavoriteProducts(ids: string[]) {
  if (ids.length === 0) {
    return [];
  }

  const response = await fetch("/api/favorites/products", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids }),
    credentials: "same-origin",
  });

  const data = (await response.json()) as {
    success?: boolean;
    error?: string;
    products?: unknown;
  };

  if (!response.ok || !data.success) {
    throw new Error(data.error || "Não foi possível carregar seus favoritos.");
  }

  return Array.isArray(data.products) ? data.products : [];
}
