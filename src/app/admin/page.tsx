"use client";

import Link from "next/link";
import { useState } from "react";

export default function AdminPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function importarProduto() {
    if (!url.trim()) {
      alert("Cole o link de um produto.");
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

      const mensagem = [
        data.message || "Produto importado com sucesso.",
        data.product?.name
          ? `Produto: ${data.product.name}`
          : null,
        data.multiLojaQueued
          ? "Multi Loja: enviado para processamento automático."
          : null,
        data.multiLojaWarning
          ? `Aviso Multi Loja: ${data.multiLojaWarning}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");

      alert(mensagem);
      setUrl("");
    } catch (error) {
      console.error(error);
      alert("Erro ao importar produto.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
        {/* Cabeçalho */}
        <header className="mb-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:mb-6 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.16em] text-emerald-700">
                Ofertano Admin
              </p>

              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
                Painel Administrativo
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Gerencie produtos, oportunidades, integrações, links de afiliados
                e conteúdo do Ofertano.
              </p>
            </div>

            <Link
              href="/"
              className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
            >
              Ver site
            </Link>
          </div>
        </header>

        {/* Atalhos administrativos */}
        <section>
          <div className="mb-3">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
              Gerenciamento
            </p>

            <h2 className="mt-1 text-lg font-black text-slate-950 sm:text-xl">
              Áreas do painel
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {/* Oportunidades */}
            <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md sm:p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-lg">
                🔎
              </div>

              <h3 className="text-lg font-black text-slate-950">
                Oportunidades
              </h3>

              <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
                Gerencie oportunidades, descoberta e publicação de produtos.
              </p>

              <Link
                href="/admin/oportunidades"
                className="mt-5 flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-black text-white transition hover:bg-slate-700"
              >
                Abrir oportunidades
              </Link>
            </article>

            {/* Links de afiliados */}
            <article className="flex h-full flex-col rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm transition hover:border-emerald-300 hover:shadow-md sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-lg">
                  🔗
                </div>

                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-emerald-800">
                  Importante
                </span>
              </div>

              <h3 className="mt-4 text-lg font-black text-slate-950">
                Links de afiliados
              </h3>

              <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
                Resolva em lote os links dos produtos que o robô importou
                automaticamente.
              </p>

              <Link
                href="/admin/links-afiliados"
                className="mt-5 flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-black text-white transition hover:bg-emerald-700"
              >
                Resolver links pendentes
              </Link>
            </article>

            {/* Integrações */}
            <article className="flex h-full flex-col rounded-2xl border border-sky-200 bg-white p-5 shadow-sm transition hover:border-sky-300 hover:shadow-md sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-100 text-lg">
                  ⚙️
                </div>

                <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-sky-800">
                  Sistema
                </span>
              </div>

              <h3 className="mt-4 text-lg font-black text-slate-950">
                Central de Integrações
              </h3>

              <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
                Acompanhe conexões, credenciais, ofertas e o status dos
                marketplaces integrados.
              </p>

              <Link
                href="/admin/integracoes"
                className="mt-5 flex min-h-11 w-full items-center justify-center rounded-xl bg-sky-600 px-4 text-sm font-black text-white transition hover:bg-sky-700"
              >
                Abrir integrações
              </Link>
            </article>

            {/* Blog */}
            <article className="flex h-full flex-col rounded-2xl border border-violet-200 bg-white p-5 shadow-sm transition hover:border-violet-300 hover:shadow-md sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-lg">
                  ✍️
                </div>

                <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-violet-800">
                  Editorial
                </span>
              </div>

              <h3 className="mt-4 text-lg font-black text-slate-950">
                Blog do Ofertano
              </h3>

              <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
                Crie, edite, agende e publique artigos diretamente pelo painel.
              </p>

              <Link
                href="/admin/blog"
                className="mt-5 flex min-h-11 w-full items-center justify-center rounded-xl bg-violet-600 px-4 text-sm font-black text-white transition hover:bg-violet-700"
              >
                Administrar blog
              </Link>
            </article>

            {/* Fila */}
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md sm:p-6 md:col-span-2">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-lg">
                    📥
                  </div>

                  <div>
                    <h3 className="text-lg font-black text-slate-950">
                      Fila de importação
                    </h3>

                    <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-600">
                      Acompanhe os produtos enviados para processamento
                      automático e verifique o andamento das importações.
                    </p>
                  </div>
                </div>

                <Link
                  href="/admin/fila"
                  className="flex min-h-11 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white px-5 text-sm font-black text-slate-900 transition hover:border-amber-300 hover:bg-amber-50"
                >
                  Abrir fila
                </Link>
              </div>
            </article>
          </div>
        </section>

        {/* Importação manual */}
        <section className="mt-6 rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-lg">
              ＋
            </div>

            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">
                Cadastro rápido
              </p>

              <h2 className="mt-1 text-xl font-black text-slate-950">
                Importação manual
              </h2>

              <p className="mt-1 text-sm leading-6 text-slate-600">
                Cole o link de um produto para importá-lo manualmente e iniciar
                o processamento Multi Loja.
              </p>
            </div>
          </div>

          <div className="mt-5">
            <label
              htmlFor="product-url"
              className="mb-2 block text-sm font-black text-slate-800"
            >
              Link do produto
            </label>

            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="product-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !loading) {
                    importarProduto();
                  }
                }}
                placeholder="Cole aqui o link do produto..."
                className="min-h-12 w-full flex-1 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/10"
              />

              <button
                type="button"
                onClick={importarProduto}
                disabled={loading}
                className="min-h-12 shrink-0 rounded-xl bg-emerald-600 px-6 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-44"
              >
                {loading ? "Importando..." : "Importar produto"}
              </button>
            </div>

            <p className="mt-2 text-xs leading-5 text-slate-500">
              Use o link individual do produto na loja de origem.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}