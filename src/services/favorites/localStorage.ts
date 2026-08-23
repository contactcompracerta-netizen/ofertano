import { normalizarIds } from "./ids";

export const FAVORITES_STORAGE_KEY = "ofertano:favorites";
export const FAVORITES_OWNER_KEY = "ofertano:favorites-owner";
export const FAVORITES_EVENT = "ofertano:favorites-changed";
export const FAVORITES_SYNC_FLAG_KEY = "ofertano:favorites-synced";

export function lerIdsFavoritosLocais(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const valor = window.localStorage.getItem(
      FAVORITES_STORAGE_KEY
    );

    if (!valor) {
      return [];
    }

    return normalizarIds(JSON.parse(valor));
  } catch {
    return [];
  }
}

export function salvarIdsFavoritosLocais(
  ids: string[],
  emitirEvento = true
): string[] {
  const normalizados = normalizarIds(ids);

  if (typeof window === "undefined") {
    return normalizados;
  }

  window.localStorage.setItem(
    FAVORITES_STORAGE_KEY,
    JSON.stringify(normalizados)
  );

  if (emitirEvento) {
    window.dispatchEvent(new Event(FAVORITES_EVENT));
  }

  return normalizados;
}

export function contarIdsFavoritosLocais(): number {
  return lerIdsFavoritosLocais().length;
}

export function produtoEstaFavoritadoLocal(productId: string): boolean {
  return lerIdsFavoritosLocais().includes(productId);
}

export function lerDonoFavoritosLocais(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const valor = window.localStorage.getItem(FAVORITES_OWNER_KEY);
  return valor?.trim() || null;
}

export function salvarDonoFavoritosLocais(ownerId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(FAVORITES_OWNER_KEY, ownerId);
}

export function marcarSincronizacaoDaSessao(userId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(FAVORITES_SYNC_FLAG_KEY, userId);
}

export function jaSincronizouNestaSessao(userId: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.sessionStorage.getItem(FAVORITES_SYNC_FLAG_KEY) === userId;
}

export function limparSincronizacaoDaSessao() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(FAVORITES_SYNC_FLAG_KEY);
}
