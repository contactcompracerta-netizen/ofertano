"use client";

import { useEffect, useState } from "react";

type FavoriteButtonProps = {
  productId: string;
  variant?: "icon" | "label";
};

type IconProps = {
  className?: string;
  filled?: boolean;
};

const STORAGE_KEY = "ofertano:favorites";

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

function lerFavoritos(): string[] {
  try {
    const valor = window.localStorage.getItem(STORAGE_KEY);
    if (!valor) return [];

    const dados: unknown = JSON.parse(valor);
    if (!Array.isArray(dados)) return [];

    return dados.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export default function FavoriteButton({
  productId,
  variant = "icon",
}: FavoriteButtonProps) {
  const [favoritado, setFavoritado] = useState(false);

  useEffect(() => {
    setFavoritado(lerFavoritos().includes(productId));
  }, [productId]);

  function alternarFavorito() {
    const favoritos = lerFavoritos();
    const novoEstado = !favoritado;

    const proximos = novoEstado
      ? Array.from(new Set([...favoritos, productId]))
      : favoritos.filter((id) => id !== productId);

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(proximos));
    window.dispatchEvent(new Event("ofertano:favorites-changed"));
    setFavoritado(novoEstado);
  }

  if (variant === "label") {
    return (
      <button
        type="button"
        onClick={alternarFavorito}
        aria-pressed={favoritado}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-black transition ${
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

  return (
    <button
      type="button"
      onClick={alternarFavorito}
      aria-label={favoritado ? "Remover dos favoritos" : "Adicionar aos favoritos"}
      aria-pressed={favoritado}
      title={favoritado ? "Remover dos favoritos" : "Adicionar aos favoritos"}
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow-md transition active:scale-[0.98] ${
        favoritado
          ? "bg-rose-600 text-white hover:bg-rose-700"
          : "bg-rose-50 text-rose-600 hover:bg-rose-100"
      }`}
    >
      <HeartIcon className="h-5 w-5" filled={favoritado} />
    </button>
  );
}