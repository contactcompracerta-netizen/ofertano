import { supabase } from "@/lib/supabaseClient";

import type { MergeFavoritesResult } from "./types";

type JsonResponse<T> = {
  success: boolean;
  error?: string;
} & T;

async function obterCabecalhosAutenticados(): Promise<HeadersInit | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return null;
  }

  return {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

async function requisitar<T>(
  input: RequestInfo,
  init?: RequestInit
): Promise<JsonResponse<T>> {
  const headers = await obterCabecalhosAutenticados();

  if (!headers) {
    return {
      success: false,
      error: "Entre na sua conta para sincronizar os favoritos.",
    } as JsonResponse<T>;
  }

  const response = await fetch(input, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers ?? {}),
    },
  });

  try {
    const data = (await response.json()) as JsonResponse<T>;

    if (!response.ok && data.success !== false) {
      return {
        ...data,
        success: false,
        error:
          data.error ||
          "Não foi possível sincronizar seus favoritos agora.",
      };
    }

    if (!response.ok) {
      return {
        ...data,
        success: false,
      };
    }

    return data;
  } catch {
    return {
      success: false,
      error: "Não foi possível ler a resposta dos favoritos.",
    } as JsonResponse<T>;
  }
}

export async function adicionarFavoritoRemoto(productId: string) {
  return requisitar<{
    created: boolean;
    productId: string;
  }>("/api/favorites", {
    method: "POST",
    body: JSON.stringify({ productId }),
  });
}

export async function removerFavoritoRemoto(productId: string) {
  return requisitar<{
    removed: boolean;
    productId: string;
  }>(`/api/favorites?productId=${encodeURIComponent(productId)}`, {
    method: "DELETE",
  });
}

export async function listarFavoritosRemotos() {
  return requisitar<{
    productIds: string[];
  }>("/api/favorites", {
    method: "GET",
  });
}

export async function verificarFavoritoRemoto(productId: string) {
  return requisitar<{
    favorited: boolean;
    productId: string;
  }>(
    `/api/favorites?productId=${encodeURIComponent(productId)}`,
    {
      method: "GET",
    }
  );
}

export async function sincronizarFavoritosRemotos(
  productIds: string[]
) {
  return requisitar<MergeFavoritesResult>("/api/favorites/sync", {
    method: "POST",
    body: JSON.stringify({ productIds }),
  });
}

export async function sessaoFavoritosDisponivel(): Promise<boolean> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return Boolean(session?.user?.id);
}

export async function hidratarProdutosFavoritos(ids: string[]) {
  const response = await fetch("/api/favorites/products", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids }),
  });

  const data = (await response.json()) as {
    success?: boolean;
    error?: string;
    products?: Array<{
      id: string;
      name: string;
      image: string;
      price: number;
      oldPrice: number | null;
      discount: number | null;
      store: string;
      brand: string | null;
      installments: string | null;
      rating: number | null;
      reviews: number | null;
      stock: number | null;
    }>;
  };

  if (!response.ok || !data.success) {
    throw new Error(
      data.error || "Não foi possível carregar seus favoritos."
    );
  }

  return Array.isArray(data.products) ? data.products : [];
}
