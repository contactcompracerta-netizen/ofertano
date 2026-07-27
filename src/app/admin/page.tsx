"use client";

import { useState } from "react";

export default function AdminPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function importarProduto() {
    if (!url) {
      alert("Cole o link do Mercado Livre.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch("/api/import-product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url,
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

      alert("Erro ao importar.");

    } finally {

      setLoading(false);

    }
  }

  return (
    <main className="min-h-screen bg-gray-100">

      <div className="mx-auto max-w-3xl p-10">

        <h1 className="mb-8 text-4xl font-bold text-green-600">
          Painel Administrativo
        </h1>

        <div className="rounded-2xl bg-white p-8 shadow">

          <label className="mb-2 block font-bold">
            Link do Mercado Livre
          </label>

          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Cole aqui o link do produto..."
            className="w-full rounded-lg border p-4"
          />

          <button
            onClick={importarProduto}
            disabled={loading}
            className="mt-6 w-full rounded-xl bg-green-600 py-4 text-lg font-bold text-white hover:bg-green-700 disabled:opacity-60"
          >
            {loading ? "Importando..." : "Importar Produto"}
          </button>

        </div>

      </div>

    </main>
  );
}