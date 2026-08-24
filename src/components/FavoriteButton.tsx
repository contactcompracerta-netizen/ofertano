"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { trackAnalyticsEvent } from "@/lib/analytics/tracker";

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

    if (!valor) {
      return [];
    }

    const dados: unknown = JSON.parse(valor);

    if (!Array.isArray(dados)) {
      return [];
    }

    return Array.from(
      new Set(
        dados
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
  } catch {
    return [];
  }
}

function salvarFavoritos(ids: string[]) {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(Array.from(new Set(ids)))
  );

  window.dispatchEvent(
    new Event("ofertano:favorites-changed")
  );
}

export default function FavoriteButton({
  productId,
  variant = "icon",
}: FavoriteButtonProps) {
  const [favoritado, setFavoritado] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  useEffect(() => {
    let ativo = true;

    async function carregarEstado() {
      const favoritosLocais = lerFavoritos();
      const estaLocal = favoritosLocais.includes(productId);

      if (ativo) {
        setFavoritado(estaLocal);
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!ativo || !user) {
        return;
      }

      if (estaLocal) {
        const { error } = await supabase
          .from("user_favorites")
          .upsert(
            {
              user_id: user.id,
              product_id: productId,
            },
            {
              onConflict: "user_id,product_id",
              ignoreDuplicates: true,
            }
          );

        if (error) {
          console.error(
            "Erro ao sincronizar favorito local:",
            error.message
          );
        }

        return;
      }

      const { data, error } = await supabase
        .from("user_favorites")
        .select("product_id")
        .eq("user_id", user.id)
        .eq("product_id", productId)
        .maybeSingle();

      if (!ativo) {
        return;
      }

      if (error) {
        console.error(
          "Erro ao consultar favorito:",
          error.message
        );
        return;
      }

      if (data?.product_id) {
        salvarFavoritos([
          ...favoritosLocais,
          productId,
        ]);
        setFavoritado(true);
      }
    }

    void carregarEstado();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (
          event !== "SIGNED_IN" ||
          !session?.user
        ) {
          return;
        }

        const favoritosLocais = lerFavoritos();

        if (!favoritosLocais.includes(productId)) {
          return;
        }

        void supabase
          .from("user_favorites")
          .upsert(
            {
              user_id: session.user.id,
              product_id: productId,
            },
            {
              onConflict: "user_id,product_id",
              ignoreDuplicates: true,
            }
          );
      }
    );

    return () => {
      ativo = false;
      subscription.unsubscribe();
    };
  }, [productId]);

  async function alternarFavorito() {
    if (sincronizando) {
      return;
    }

    const favoritos = lerFavoritos();
    const novoEstado = !favoritado;

    const proximos = novoEstado
      ? Array.from(
          new Set([...favoritos, productId])
        )
      : favoritos.filter(
          (id) => id !== productId
        );

    salvarFavoritos(proximos);
    setFavoritado(novoEstado);
    trackAnalyticsEvent({
      eventType: novoEstado ? "FAVORITE_ADD" : "FAVORITE_REMOVE",
      productId,
      metadata: {
        surface: "favorite",
      },
    });

    try {
      setSincronizando(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return;
      }

      if (novoEstado) {
        const { error } = await supabase
          .from("user_favorites")
          .upsert(
            {
              user_id: user.id,
              product_id: productId,
            },
            {
              onConflict: "user_id,product_id",
              ignoreDuplicates: true,
            }
          );

        if (error) {
          console.error(
            "Erro ao salvar favorito na conta:",
            error.message
          );
        }
      } else {
        const { error } = await supabase
          .from("user_favorites")
          .delete()
          .eq("user_id", user.id)
          .eq("product_id", productId);

        if (error) {
          console.error(
            "Erro ao remover favorito da conta:",
            error.message
          );
        }
      }
    } finally {
      setSincronizando(false);
    }
  }

  if (variant === "label") {
    return (
      <button
        type="button"
        onClick={() =>
          void alternarFavorito()
        }
        disabled={sincronizando}
        aria-pressed={favoritado}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-black transition disabled:cursor-wait disabled:opacity-70 ${
          favoritado
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-slate-200 bg-white text-slate-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
        }`}
      >
        <HeartIcon
          className="h-5 w-5"
          filled={favoritado}
        />
        {favoritado
          ? "Favoritado"
          : "Favoritar"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() =>
        void alternarFavorito()
      }
      disabled={sincronizando}
      aria-label={
        favoritado
          ? "Remover dos favoritos"
          : "Adicionar aos favoritos"
      }
      aria-pressed={favoritado}
      title={
        favoritado
          ? "Remover dos favoritos"
          : "Adicionar aos favoritos"
      }
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full shadow-md transition active:scale-[0.98] disabled:cursor-wait disabled:opacity-70 ${
        favoritado
          ? "bg-rose-600 text-white hover:bg-rose-700"
          : "bg-rose-50 text-rose-600 hover:bg-rose-100"
      }`}
    >
      <HeartIcon
        className="h-5 w-5"
        filled={favoritado}
      />
    </button>
  );
}