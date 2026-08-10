"use client";

import Link from "next/link";
import { useState } from "react";

export default function AdminPage() {
  const [url, setUrl] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  async function importarProduto() {
    if (!url.trim()) {
      alert(
        "Cole o link de um produto.",
      );
      return;
    }

    try {
      setLoading(true);

      const response =
        await fetch(
          "/api/import-product/v2",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              url: url.trim(),
            }),
          },
        );

      const data =
        await response.json();

      if (!response.ok) {
        alert(
          data.error ||
            "Erro ao importar produto.",
        );
        return;
      }

      alert(
        "Produto importado com sucesso!",
      );

      setUrl("");
    } catch (error) {
      console.error(error);

      alert(
        "Erro ao importar produto.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="mb-8">
          <p className="text-sm font-black uppercase tracking-[0.12em] text-emerald-700">
            Ofertano
          </p>

          <h1 className="mt-2 text-3xl font-black text-gray-950">
            Painel Administrativo
          </h1>
        </div>

        <div className="mb-6 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow md:p-8">
            <h2 className="text-xl font-bold text-gray-900">
              Oportunidades
            </h2>

            <p className="mt-2 text-sm leading-6 text-gray-600">
              Gerencie oportunidades, descoberta e publicação de produtos.
            </p>

            <Link
              href="/admin/oportunidades"
              className="mt-5 block w-full rounded-xl bg-slate-900 px-5 py-4 text-center font-bold text-white transition hover:bg-slate-700"
            >
              Abrir Oportunidades
            </Link>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow md:p-8">
            <div className="inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-800">
              Novo
            </div>

            <h2 className="mt-3 text-xl font-bold text-gray-900">
              Links de afiliados
            </h2>

            <p className="mt-2 text-sm leading-6 text-gray-600">
              Resolva em lote os links dos produtos que o robô importou automaticamente.
            </p>

            <Link
              href="/admin/links-afiliados"
              className="mt-5 block w-full rounded-xl bg-emerald-600 px-5 py-4 text-center font-bold text-white transition hover:bg-emerald-700"
            >
              Resolver links pendentes
            </Link>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow md:p-8">
          <h2 className="text-xl font-bold text-gray-900">
            Importação manual
          </h2>

          <p className="mt-2 text-sm leading-6 text-gray-600">
            Cole o link de um produto para importá-lo manualmente.
          </p>

          <label
            htmlFor="product-url"
            className="mb-2 mt-6 block font-bold text-gray-800"
          >
            Link do produto
          </label>

          <input
            id="product-url"
            type="url"
            value={url}
            onChange={(event) =>
              setUrl(
                event.target.value,
              )
            }
            placeholder="Cole aqui o link do produto..."
            className="w-full rounded-lg border border-gray-300 p-4 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
          />

          <button
            type="button"
            onClick={
              importarProduto
            }
            disabled={loading}
            className="mt-6 w-full rounded-xl bg-emerald-600 py-4 text-lg font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? "Importando..."
              : "Importar Produto"}
          </button>
        </div>
      </div>
    </main>
  );
}
