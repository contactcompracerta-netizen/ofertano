"use client";

import { useEffect, useState, type MouseEvent } from "react";

import {
  FAVORITES_EVENT,
  alternarFavoritoDoProduto,
  produtoEstaFavoritadoLocal,
} from "@/services/favorites";

type FavoriteButtonProps = {
  productId: string;
  variant?: "icon" | "label" | "card";
};

type IconProps = {
  className?: string;
  filled?: boolean;
};

function HeartIcon({ className, filled = false }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path
        d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function FavoriteButton({
  productId,
  variant = "icon",
}: FavoriteButtonProps) {
  const [favoritado, setFavoritado] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  useEffect(() => {
    function atualizarEstado() {
      setFavoritado(produtoEstaFavoritadoLocal(productId));
    }

    atualizarEstado();

    window.addEventListener(FAVORITES_EVENT, atualizarEstado);
    window.addEventListener("storage", atualizarEstado);

    return () => {
      window.removeEventListener(FAVORITES_EVENT, atualizarEstado);
      window.removeEventListener("storage", atualizarEstado);
    };
  }, [productId]);

  async function alternarFavorito(
    event?: MouseEvent<HTMLButtonElement>
  ) {
    event?.preventDefault();
    event?.stopPropagation();

    if (sincronizando) {
      return;
    }

    const estadoAnterior = favoritado;
    const proximoEstado = !estadoAnterior;

    setFavoritado(proximoEstado);
    setSincronizando(true);

    try {
      const favoritadoAgora =
        await alternarFavoritoDoProduto(productId);
      setFavoritado(favoritadoAgora);
    } catch (error) {
      console.error("Erro ao atualizar favorito:", error);
      setFavoritado(produtoEstaFavoritadoLocal(productId));
    } finally {
      setSincronizando(false);
    }
  }

  const rotulo = favoritado
    ? "Remover dos favoritos"
    : "Adicionar aos favoritos";

  if (variant === "label") {
    return (
      <button
        type="button"
        onClick={(event) => void alternarFavorito(event)}
        onMouseDown={(event) => event.stopPropagation()}
        disabled={sincronizando}
        aria-label={rotulo}
        aria-pressed={favoritado}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-black transition disabled:cursor-wait disabled:opacity-70 ${
          favoritado
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-slate-200 bg-white text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
        }`}
      >
        <HeartIcon className="h-5 w-5" filled={favoritado} />
        {favoritado ? "Favoritado" : "Favoritar"}
      </button>
    );
  }

  if (variant === "card") {
    return (
      <button
        type="button"
        onClick={(event) => void alternarFavorito(event)}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        disabled={sincronizando}
        aria-label={rotulo}
        aria-pressed={favoritado}
        title={rotulo}
        className={`flex h-8 w-8 items-center justify-center rounded-full border shadow-sm backdrop-blur-sm transition active:scale-[0.96] disabled:cursor-wait sm:h-9 sm:w-9 ${
          favoritado
            ? "border-rose-200 bg-white text-rose-600"
            : "border-white/80 bg-white/90 text-slate-500 hover:border-rose-200 hover:text-rose-600"
        }`}
      >
        <HeartIcon className="h-4 w-4" filled={favoritado} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(event) => void alternarFavorito(event)}
      onMouseDown={(event) => event.stopPropagation()}
      disabled={sincronizando}
      aria-label={rotulo}
      aria-pressed={favoritado}
      title={rotulo}
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow-md transition active:scale-[0.98] disabled:cursor-wait ${
        favoritado
          ? "bg-rose-600 text-white hover:bg-rose-700"
          : "bg-rose-50 text-rose-600 hover:bg-rose-100"
      }`}
    >
      <HeartIcon className="h-5 w-5" filled={favoritado} />
    </button>
  );
}
