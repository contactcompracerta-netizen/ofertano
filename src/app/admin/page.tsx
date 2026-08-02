"use client";

import Link from "next/link";
import { useState } from "react";

export default function AdminPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function importarProduto() {
    if (!url.trim()) {
      alert("Cole o link do Mercado Livre.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch("/api/import-product/v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: url.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Erro ao importar produto.");
        return;
      }

      alert("Produto importado com sucesso!");
      setUrl("");
    } catch (error) {
      console.error(error);
      alert("Erro ao importar produto.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-3xl p-6 md:p-10">
        <h1 className="mb-8 text-3xl font-bold text-green-600 md:text-4xl">
          Painel Administrativo
        </h1>

        <div className="mb-6 rounded-2xl bg-white p-6 shadow md:p-8">
          <h2 className="mb-2 text-xl font-bold text-gray-900">
            Oportunidades automáticas
          </h2>

          <p className="mb-5 text-sm text-gray-600">
            Acesse o painel para buscar produtos com desconto e gerenciar a
            publicação automática.
          </p>

          <Link
            href="/admin/oportunidades"
            className="block w-full rounded-xl bg-emerald-600 px-5 py-4 text-center text-lg font-bold text-white transition hover:bg-emerald-700"
          >
            Abrir Oportunidades
          </Link>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow md:p-8">
          <h2 className="mb-6 text-xl font-bold text-gray-900">
            Importação manual
          </h2>

          <label
            htmlFor="mercado-livre-url"
            className="mb-2 block font-bold text-gray-800"
          >
            Link do Mercado Livre
          </label>

          <input
            id="mercado-livre-url"
            type="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Cole aqui o link do produto..."
            className="w-full rounded-lg border border-gray-300 p-4 outline-none transition focus:border-green-600 focus:ring-4 focus:ring-green-600/10"
          />

          <button
            type="button"
            onClick={importarProduto}
            disabled={loading}
            className="mt-6 w-full rounded-xl bg-green-600 py-4 text-lg font-bold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Importando..." : "Importar Produto"}
          </button>
        </div>
      </div>
    </main>
  );
}