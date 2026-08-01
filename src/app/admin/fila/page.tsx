"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";

type ResultadoFila = {
  success: boolean;
  message?: string;
  error?: string;
  received?: number;
  added?: number;
  ignored?: number;
};

type ItemProcessado = {
  queueId: string;
  url: string;
  success: boolean;
  productId?: string;
  productName?: string;
  error?: string;
};

type ResultadoProcessamento = {
  success: boolean;
  message?: string;
  error?: string;
  processed?: number;
  imported?: number;
  errors?: number;
  results?: ItemProcessado[];
};

export default function FilaImportacaoPage() {
  const [urls, setUrls] = useState("");
  const [adicionando, setAdicionando] = useState(false);
  const [processando, setProcessando] = useState(false);

  const [resultadoFila, setResultadoFila] =
    useState<ResultadoFila | null>(null);

  const [resultadoProcessamento, setResultadoProcessamento] =
    useState<ResultadoProcessamento | null>(null);

  async function adicionarLinks(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!urls.trim()) {
      setResultadoFila({
        success: false,
        error: "Cole pelo menos um link do Mercado Livre.",
      });

      return;
    }

    try {
      setAdicionando(true);
      setResultadoFila(null);

      const response = await fetch(
        "/api/import-queue/add",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            urls,
          }),
        }
      );

      const data =
        (await response.json()) as ResultadoFila;

      setResultadoFila(data);

      if (response.ok && data.success) {
        setUrls("");
      }
    } catch (error) {
      console.error(error);

      setResultadoFila({
        success: false,
        error: "Não foi possível adicionar os links à fila.",
      });
    } finally {
      setAdicionando(false);
    }
  }

  async function processarFila() {
    try {
      setProcessando(true);
      setResultadoProcessamento(null);

      const response = await fetch(
        "/api/import-queue/process",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            limit: 5,
          }),
        }
      );

      const data =
        (await response.json()) as ResultadoProcessamento;

      setResultadoProcessamento(data);
    } catch (error) {
      console.error(error);

      setResultadoProcessamento({
        success: false,
        error: "Não foi possível processar a fila.",
      });
    } finally {
      setProcessando(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-wider text-green-700">
              Painel Ofertano
            </p>

            <h1 className="mt-1 text-3xl font-black text-gray-900">
              Fila de importação
            </h1>

            <p className="mt-2 text-gray-600">
              Adicione vários links e processe até cinco produtos por vez.
            </p>
          </div>

          <Link
            href="/admin"
            className="rounded-xl border border-gray-300 bg-white px-5 py-3 font-bold text-gray-700 transition hover:border-green-500 hover:text-green-700"
          >
            Voltar ao importador
          </Link>
        </div>

        <form
          onSubmit={adicionarLinks}
          className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <label
            htmlFor="urls"
            className="block text-sm font-black text-gray-800"
          >
            Links dos produtos
          </label>

          <textarea
            id="urls"
            value={urls}
            onChange={(event) =>
              setUrls(event.target.value)
            }
            rows={12}
            placeholder={`https://www.mercadolivre.com.br/produto-1
https://www.mercadolivre.com.br/produto-2
https://meli.la/produto-3`}
            className="mt-3 w-full resize-y rounded-2xl border border-gray-300 bg-gray-50 p-4 text-sm text-gray-900 outline-none transition focus:border-green-500 focus:bg-white focus:ring-4 focus:ring-green-100"
          />

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-gray-500">
              Use um link por linha. Links repetidos serão ignorados.
            </p>

            <button
              type="submit"
              disabled={adicionando || processando}
              className="rounded-xl bg-green-600 px-6 py-3.5 font-black text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {adicionando
                ? "Adicionando..."
                : "Adicionar à fila"}
            </button>
          </div>
        </form>

        {resultadoFila && (
          <section
            className={`mt-6 rounded-2xl border p-5 ${
              resultadoFila.success
                ? "border-green-200 bg-green-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            <p
              className={`font-black ${
                resultadoFila.success
                  ? "text-green-800"
                  : "text-red-800"
              }`}
            >
              {resultadoFila.message ||
                resultadoFila.error}
            </p>

            {resultadoFila.success && (
              <div className="mt-3 flex flex-wrap gap-4 text-sm font-bold text-gray-700">
                <span>
                  Recebidos: {resultadoFila.received ?? 0}
                </span>

                <span>
                  Adicionados: {resultadoFila.added ?? 0}
                </span>

                <span>
                  Repetidos: {resultadoFila.ignored ?? 0}
                </span>
              </div>
            )}
          </section>
        )}

        <section className="mt-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-gray-900">
                Processar produtos pendentes
              </h2>

              <p className="mt-1 text-sm text-gray-600">
                O sistema importará até cinco produtos por execução.
              </p>
            </div>

            <button
              type="button"
              onClick={processarFila}
              disabled={processando || adicionando}
              className="rounded-xl bg-gray-900 px-6 py-3.5 font-black text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {processando
                ? "Processando..."
                : "Processar 5 produtos"}
            </button>
          </div>
        </section>

        {resultadoProcessamento && (
          <section
            className={`mt-6 rounded-2xl border p-5 ${
              resultadoProcessamento.success
                ? "border-blue-200 bg-blue-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            <p
              className={`font-black ${
                resultadoProcessamento.success
                  ? "text-blue-900"
                  : "text-red-800"
              }`}
            >
              {resultadoProcessamento.message ||
                resultadoProcessamento.error}
            </p>

            {resultadoProcessamento.success && (
              <div className="mt-3 flex flex-wrap gap-4 text-sm font-bold text-gray-700">
                <span>
                  Processados:{" "}
                  {resultadoProcessamento.processed ?? 0}
                </span>

                <span className="text-green-700">
                  Importados:{" "}
                  {resultadoProcessamento.imported ?? 0}
                </span>

                <span className="text-red-700">
                  Erros:{" "}
                  {resultadoProcessamento.errors ?? 0}
                </span>
              </div>
            )}

            {resultadoProcessamento.results &&
              resultadoProcessamento.results.length > 0 && (
                <div className="mt-5 space-y-3">
                  {resultadoProcessamento.results.map(
                    (item) => (
                      <div
                        key={item.queueId}
                        className="rounded-xl border border-white bg-white/80 p-4"
                      >
                        <p
                          className={`font-bold ${
                            item.success
                              ? "text-green-700"
                              : "text-red-700"
                          }`}
                        >
                          {item.success
                            ? `Importado: ${
                                item.productName ||
                                "Produto"
                              }`
                            : `Erro: ${
                                item.error ||
                                "Falha desconhecida"
                              }`}
                        </p>

                        <p className="mt-1 break-all text-xs text-gray-500">
                          {item.url}
                        </p>
                      </div>
                    )
                  )}
                </div>
              )}
          </section>
        )}
      </div>
    </main>
  );
}