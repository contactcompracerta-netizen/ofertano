"use client";

import { trackAnalyticsEvent } from "@/lib/analytics/tracker";
import { eventForFavoriteMutation } from "@/lib/favorites/analytics";
import { useIsFavorite } from "@/lib/favorites/hooks";
import { favoritesController } from "@/lib/favorites/store";

type FavoriteButtonProps = {
  productId: string;
  variant?: "icon" | "label";
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
  const favoritado = useIsFavorite(productId);

  async function alternarFavorito() {
    const estavaFavoritado = favoritesController
      .getIds()
      .includes(productId);
    const resultado = await favoritesController.toggle(productId);
    const evento = eventForFavoriteMutation(
      "user",
      estavaFavoritado,
      resultado.favorited,
    );

    if (!resultado.changed || !evento) {
      return;
    }

    trackAnalyticsEvent({
      eventType: evento,
      productId,
      metadata: {
        surface: "favorite",
      },
    });
  }

  if (variant === "label") {
    return (
      <button
        type="button"
        onClick={() => void alternarFavorito()}
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
      onClick={() => void alternarFavorito()}
      aria-label={
        favoritado ? "Remover dos favoritos" : "Adicionar aos favoritos"
      }
      aria-pressed={favoritado}
      title={
        favoritado ? "Remover dos favoritos" : "Adicionar aos favoritos"
      }
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
