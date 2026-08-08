"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";

import Footer from "@/components/Footer";
import Header from "@/components/Header";
import { supabase } from "@/lib/supabaseClient";

const STORAGE_KEY = "ofertano:favorites";
const FAVORITES_EVENT = "ofertano:favorites-changed";

type FavoriteProduct = {
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
};

function formatarPreco(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function normalizarIds(valor: unknown): string[] {
  if (!Array.isArray(valor)) {
    return [];
  }

  return Array.from(
    new Set(
      valor
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function lerIdsFavoritosLocais(): string[] {
  try {
    const valor = window.localStorage.getItem(STORAGE_KEY);

    if (!valor) {
      return [];
    }

    return normalizarIds(JSON.parse(valor));
  } catch {
    return [];
  }
}

function salvarIdsFavoritosLocais(ids: string[]) {
  const normalizados = normalizarIds(ids);

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(normalizados)
  );

  window.dispatchEvent(new Event(FAVORITES_EVENT));
}

async function carregarIdsDaConta(userId: string) {
  const { data, error } = await supabase
    .from("user_favorites")
    .select("product_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return normalizarIds(
    (data ?? []).map((item) => item.product_id)
  );
}

async function enviarFavoritosLocaisParaConta(
  userId: string,
  ids: string[]
) {
  if (ids.length === 0) {
    return;
  }

  const linhas = ids.map((productId) => ({
    user_id: userId,
    product_id: productId,
  }));

  const { error } = await supabase
    .from("user_favorites")
    .upsert(linhas, {
      onConflict: "user_id,product_id",
      ignoreDuplicates: true,
    });

  if (error) {
    throw new Error(error.message);
  }
}

export default function FavoritosPage() {
  const [user, setUser] = useState<User | null>(null);
  const [products, setProducts] = useState<FavoriteProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [saindo, setSaindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregarProdutos = useCallback(async (ids: string[]) => {
    if (ids.length === 0) {
      setProducts([]);
      return;
    }

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
      products?: FavoriteProduct[];
    };

    if (!response.ok || !data.success) {
      throw new Error(
        data.error || "Não foi possível carregar seus favoritos."
      );
    }

    setProducts(
      Array.isArray(data.products) ? data.products : []
    );
  }, []);

  const sincronizarECarregar = useCallback(
    async (usuarioAtual?: User | null) => {
      setLoading(true);
      setErro(null);

      try {
        const idsLocais = lerIdsFavoritosLocais();

        if (!usuarioAtual) {
          await carregarProdutos(idsLocais);
          return;
        }

        await enviarFavoritosLocaisParaConta(
          usuarioAtual.id,
          idsLocais
        );

        const idsDaConta = await carregarIdsDaConta(
          usuarioAtual.id
        );

        const idsMesclados = Array.from(
          new Set([...idsDaConta, ...idsLocais])
        );

        salvarIdsFavoritosLocais(idsMesclados);
        await carregarProdutos(idsMesclados);
      } catch (error) {
        console.error(
          "Erro ao sincronizar favoritos:",
          error
        );

        setErro(
          "Não foi possível sincronizar seus favoritos agora."
        );

        try {
          await carregarProdutos(
            lerIdsFavoritosLocais()
          );
        } catch {
          setProducts([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [carregarProdutos]
  );

  useEffect(() => {
    let ativo = true;

    async function iniciar() {
      const {
        data: { user: usuarioAtual },
      } = await supabase.auth.getUser();

      if (!ativo) {
        return;
      }

      setUser(usuarioAtual ?? null);
      await sincronizarECarregar(
        usuarioAtual ?? null
      );
    }

    void iniciar();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!ativo) {
          return;
        }

        const usuarioAtual =
          session?.user ?? null;

        setUser(usuarioAtual);

        if (
          event === "SIGNED_IN" ||
          event === "INITIAL_SESSION"
        ) {
          void sincronizarECarregar(
            usuarioAtual
          );
        }

        if (event === "SIGNED_OUT") {
          void sincronizarECarregar(null);
        }
      }
    );

    return () => {
      ativo = false;
      subscription.unsubscribe();
    };
  }, [sincronizarECarregar]);

  useEffect(() => {
    const atualizar = () => {
      void sincronizarECarregar(user);
    };

    window.addEventListener(
      FAVORITES_EVENT,
      atualizar
    );

    window.addEventListener(
      "storage",
      atualizar
    );

    return () => {
      window.removeEventListener(
        FAVORITES_EVENT,
        atualizar
      );

      window.removeEventListener(
        "storage",
        atualizar
      );
    };
  }, [sincronizarECarregar, user]);

  async function removerFavorito(
    productId: string
  ) {
    const anteriores =
      lerIdsFavoritosLocais();

    const proximos = anteriores.filter(
      (id) => id !== productId
    );

    salvarIdsFavoritosLocais(proximos);
    setProducts((atuais) =>
      atuais.filter(
        (product) =>
          product.id !== productId
      )
    );

    if (!user) {
      return;
    }

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

      salvarIdsFavoritosLocais(
        anteriores
      );

      await sincronizarECarregar(user);
    }
  }

  async function sair() {
    try {
      setSaindo(true);

      const { error } =
        await supabase.auth.signOut();

      if (error) {
        setErro(
          "Não foi possível sair da conta."
        );
      }
    } finally {
      setSaindo(false);
    }
  }

  return (
    <>
      <Header />

      <main className="min-h-[70vh] bg-slate-50">
        <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
          <div className="mb-8 flex flex-col gap-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">
                Sua seleção
              </p>

              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
                Meus favoritos
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                Salve produtos para comparar depois. Se entrar na sua conta, os favoritos ficam sincronizados entre seus dispositivos.
              </p>
            </div>

            <div className="shrink-0">
              {user ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <p className="text-xs font-bold text-emerald-700">
                    Favoritos sincronizados
                  </p>

                  <p className="mt-0.5 max-w-[260px] truncate text-sm font-black text-slate-900">
                    {user.email}
                  </p>

                  <button
                    type="button"
                    onClick={() => void sair()}
                    disabled={saindo}
                    className="mt-2 text-xs font-black text-slate-600 underline underline-offset-4 transition hover:text-slate-950 disabled:opacity-50"
                  >
                    {saindo
                      ? "Saindo..."
                      : "Sair da conta"}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
                  <p className="max-w-xs text-sm leading-5 text-slate-600">
                    Entre para manter estes favoritos salvos também no celular, PC e outros dispositivos.
                  </p>

                  <Link
                    href="/login"
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-black text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700"
                  >
                    Entrar
                  </Link>
                </div>
              )}
            </div>
          </div>

          {loading ? (
            <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm font-semibold text-slate-500 shadow-sm">
              Sincronizando seus favoritos...
            </div>
          ) : erro && products.length === 0 ? (
            <div className="rounded-3xl border border-red-200 bg-red-50 p-8 text-center">
              <p className="font-bold text-red-700">
                {erro}
              </p>

              <button
                type="button"
                onClick={() =>
                  void sincronizarECarregar(
                    user
                  )
                }
                className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-black text-red-700 shadow-sm"
              >
                Tentar novamente
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="rounded-3xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-rose-50 text-3xl">
                ♡
              </div>

              <h2 className="mt-5 text-2xl font-black text-slate-950">
                Nenhum favorito ainda
              </h2>

              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
                Toque no coração de um produto para salvá-lo aqui e comparar com calma depois.
              </p>

              <Link
                href="/ofertas"
                className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-black text-white transition hover:bg-emerald-700"
              >
                Ver ofertas
              </Link>
            </div>
          ) : (
            <>
              {erro && (
                <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                  {erro}
                </div>
              )}

              <div className="mb-4 flex items-center justify-between gap-4">
                <p className="text-sm font-bold text-slate-600">
                  {products.length}{" "}
                  {products.length === 1
                    ? "produto salvo"
                    : "produtos salvos"}
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {products.map((product) => {
                  const possuiPrecoAnterior =
                    product.oldPrice !== null &&
                    product.oldPrice >
                      product.price;

                  return (
                    <article
                      key={product.id}
                      className="group flex min-h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
                    >
                      <Link
                        href={`/produto/${product.id}`}
                        className="relative flex aspect-square items-center justify-center overflow-hidden bg-white p-5"
                      >
                        <img
                          src={product.image}
                          alt={product.name}
                          className="h-full w-full object-contain transition duration-300 group-hover:scale-[1.03]"
                          loading="lazy"
                        />

                        {product.discount !==
                          null &&
                          product.discount >
                            0 && (
                            <span className="absolute left-3 top-3 rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-black text-white shadow-sm">
                              {
                                product.discount
                              }
                              % OFF
                            </span>
                          )}
                      </Link>

                      <div className="flex flex-1 flex-col p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                          {product.store}
                        </p>

                        <Link
                          href={`/produto/${product.id}`}
                          className="mt-2 line-clamp-2 min-h-12 text-sm font-black leading-6 text-slate-900 transition hover:text-emerald-700"
                        >
                          {product.name}
                        </Link>

                        <div className="mt-auto pt-4">
                          {possuiPrecoAnterior &&
                            product.oldPrice !==
                              null && (
                              <p className="text-xs font-semibold text-slate-400 line-through">
                                {formatarPreco(
                                  product.oldPrice
                                )}
                              </p>
                            )}

                          <p className="mt-1 text-2xl font-black tracking-tight text-emerald-700">
                            {formatarPreco(
                              product.price
                            )}
                          </p>

                          {product.installments && (
                            <p className="mt-1 line-clamp-1 text-xs font-semibold text-slate-500">
                              {
                                product.installments
                              }
                            </p>
                          )}

                          <div className="mt-4 grid grid-cols-[1fr_auto] gap-2">
                            <Link
                              href={`/produto/${product.id}`}
                              className="flex min-h-11 items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-black text-white transition hover:bg-emerald-700"
                            >
                              Ver produto
                            </Link>

                            <button
                              type="button"
                              onClick={() =>
                                void removerFavorito(
                                  product.id
                                )
                              }
                              aria-label={`Remover ${product.name} dos favoritos`}
                              title="Remover dos favoritos"
                              className="flex h-11 w-11 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-xl text-rose-600 transition hover:bg-rose-100"
                            >
                              ♥
                            </button>
                          </div>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </main>

      <Footer />
    </>
  );
}