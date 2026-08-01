"use client";

import Link from "next/link";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type QueueStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUCCESS"
  | "ERROR";

type QueueSummary = {
  total: number;
  pending: number;
  processing: number;
  success: number;
  error: number;
};

type QueueItem = {
  id: string;
  url: string;
  marketplace: string;
  status: QueueStatus;
  attempts: number;
  errorMessage: string | null;
  productId: string | null;
  productName: string | null;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
};

type QueueResponse = {
  success: boolean;
  summary?: QueueSummary;
  items?: QueueItem[];
  error?: string;
};

type AddResponse = {
  success: boolean;
  message?: string;
  error?: string;
  received?: number;
  added?: number;
  ignored?: number;
};

type ProcessedItem = {
  queueId: string;
  url: string;
  success: boolean;
  productId?: string;
  productName?: string;
  error?: string;
};

type ProcessResponse = {
  success: boolean;
  message?: string;
  error?: string;
  processed?: number;
  imported?: number;
  errors?: number;
  results?: ProcessedItem[];
};

type ActionResponse = {
  success: boolean;
  message?: string;
  error?: string;
};

const initialSummary: QueueSummary = {
  total: 0,
  pending: 0,
  processing: 0,
  success: 0,
  error: 0,
};

const statusLabels: Record<QueueStatus, string> = {
  PENDING: "Pendente",
  PROCESSING: "Processando",
  SUCCESS: "Concluído",
  ERROR: "Erro",
};

function statusClasses(status: QueueStatus): string {
  switch (status) {
    case "PENDING":
      return "border-amber-200 bg-amber-50 text-amber-800";

    case "PROCESSING":
      return "border-blue-200 bg-blue-50 text-blue-800";

    case "SUCCESS":
      return "border-green-200 bg-green-50 text-green-800";

    case "ERROR":
      return "border-red-200 bg-red-50 text-red-800";
  }
}

function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export default function FilaImportacaoPage() {
  const [urls, setUrls] = useState("");
  const [summary, setSummary] =
    useState<QueueSummary>(initialSummary);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [filter, setFilter] =
    useState<QueueStatus | "ALL">("ALL");

  const [loadingPanel, setLoadingPanel] = useState(true);
  const [adding, setAdding] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [retryingId, setRetryingId] =
    useState<string | null>(null);

  const [panelError, setPanelError] =
    useState<string | null>(null);
  const [addResult, setAddResult] =
    useState<AddResponse | null>(null);
  const [processResult, setProcessResult] =
    useState<ProcessResponse | null>(null);
  const [actionResult, setActionResult] =
    useState<ActionResponse | null>(null);

  const loadQueue = useCallback(async () => {
    try {
      setPanelError(null);

      const response = await fetch("/api/import-queue", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });

      const data =
        (await response.json()) as QueueResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.error || "Não foi possível consultar a fila."
        );
      }

      setSummary(data.summary ?? initialSummary);
      setItems(data.items ?? []);
    } catch (error) {
      console.error(error);

      setPanelError(
        error instanceof Error
          ? error.message
          : "Não foi possível consultar a fila."
      );
    } finally {
      setLoadingPanel(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();

    const interval = window.setInterval(() => {
      void loadQueue();
    }, 15000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadQueue]);

  const visibleItems = useMemo(() => {
    if (filter === "ALL") {
      return items;
    }

    return items.filter((item) => item.status === filter);
  }, [filter, items]);

  async function addLinks(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    if (!urls.trim()) {
      setAddResult({
        success: false,
        error: "Cole pelo menos um link do Mercado Livre.",
      });

      return;
    }

    try {
      setAdding(true);
      setAddResult(null);
      setActionResult(null);

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
        (await response.json()) as AddResponse;

      setAddResult(data);

      if (response.ok && data.success) {
        setUrls("");
        await loadQueue();
      }
    } catch (error) {
      console.error(error);

      setAddResult({
        success: false,
        error:
          "Não foi possível adicionar os links à fila.",
      });
    } finally {
      setAdding(false);
    }
  }

  async function processQueue() {
    try {
      setProcessing(true);
      setProcessResult(null);
      setActionResult(null);

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
        (await response.json()) as ProcessResponse;

      setProcessResult(data);
      await loadQueue();
    } catch (error) {
      console.error(error);

      setProcessResult({
        success: false,
        error: "Não foi possível processar a fila.",
      });
    } finally {
      setProcessing(false);
    }
  }

  async function retryItem(id: string) {
    try {
      setRetryingId(id);
      setActionResult(null);

      const response = await fetch(
        "/api/import-queue/retry",
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id,
          }),
        }
      );

      const data =
        (await response.json()) as ActionResponse;

      setActionResult(data);

      if (response.ok && data.success) {
        await loadQueue();
      }
    } catch (error) {
      console.error(error);

      setActionResult({
        success: false,
        error:
          "Não foi possível devolver o produto para a fila.",
      });
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100 px-4 py-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-5">
          <div>
            <p className="text-sm font-black uppercase tracking-wider text-green-700">
              Painel Ofertano
            </p>

            <h1 className="mt-1 text-3xl font-black text-gray-900">
              Fila de importação
            </h1>

            <p className="mt-2 max-w-2xl text-gray-600">
              Acompanhe os produtos pendentes, concluídos e
              com erro. O painel atualiza automaticamente a
              cada 15 segundos.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                setLoadingPanel(true);
                void loadQueue();
              }}
              disabled={loadingPanel}
              className="rounded-xl border border-gray-300 bg-white px-5 py-3 font-bold text-gray-700 transition hover:border-green-500 hover:text-green-700 disabled:opacity-60"
            >
              {loadingPanel
                ? "Atualizando..."
                : "Atualizar painel"}
            </button>

            <Link
              href="/admin"
              className="rounded-xl bg-gray-900 px-5 py-3 font-bold text-white transition hover:bg-gray-700"
            >
              Voltar ao importador
            </Link>
          </div>
        </header>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <SummaryCard
            label="Total"
            value={summary.total}
            description="Últimos registros"
            className="border-gray-200 bg-white text-gray-900"
          />

          <SummaryCard
            label="Pendentes"
            value={summary.pending}
            description="Aguardando importação"
            className="border-amber-200 bg-amber-50 text-amber-900"
          />

          <SummaryCard
            label="Processando"
            value={summary.processing}
            description="Em execução"
            className="border-blue-200 bg-blue-50 text-blue-900"
          />

          <SummaryCard
            label="Concluídos"
            value={summary.success}
            description="Importados com sucesso"
            className="border-green-200 bg-green-50 text-green-900"
          />

          <SummaryCard
            label="Erros"
            value={summary.error}
            description="Precisam de atenção"
            className="border-red-200 bg-red-50 text-red-900"
          />
        </section>

        {panelError && (
          <section className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="font-bold text-red-800">
              {panelError}
            </p>
          </section>
        )}

        <section className="mt-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-gray-900">
                Processamento manual
              </h2>

              <p className="mt-1 text-sm text-gray-600">
                O botão processa até cinco produtos. A automação
                diária processa até dez produtos por execução.
              </p>
            </div>

            <button
              type="button"
              onClick={processQueue}
              disabled={
                processing ||
                adding ||
                summary.pending === 0
              }
              className="rounded-xl bg-green-600 px-6 py-3.5 font-black text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {processing
                ? "Processando..."
                : "Processar 5 produtos"}
            </button>
          </div>
        </section>

        {processResult && (
          <section
            className={`mt-6 rounded-2xl border p-5 ${
              processResult.success
                ? "border-blue-200 bg-blue-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            <p
              className={`font-black ${
                processResult.success
                  ? "text-blue-900"
                  : "text-red-800"
              }`}
            >
              {processResult.message ||
                processResult.error}
            </p>

            {processResult.success && (
              <div className="mt-3 flex flex-wrap gap-5 text-sm font-bold text-gray-700">
                <span>
                  Processados:{" "}
                  {processResult.processed ?? 0}
                </span>

                <span className="text-green-700">
                  Importados:{" "}
                  {processResult.imported ?? 0}
                </span>

                <span className="text-red-700">
                  Erros: {processResult.errors ?? 0}
                </span>
              </div>
            )}
          </section>
        )}

        {actionResult && (
          <section
            className={`mt-6 rounded-2xl border p-5 ${
              actionResult.success
                ? "border-green-200 bg-green-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            <p
              className={`font-bold ${
                actionResult.success
                  ? "text-green-800"
                  : "text-red-800"
              }`}
            >
              {actionResult.message ||
                actionResult.error}
            </p>
          </section>
        )}

        <form
          onSubmit={addLinks}
          className="mt-6 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <label
            htmlFor="urls"
            className="block text-lg font-black text-gray-900"
          >
            Adicionar produtos à fila
          </label>

          <p className="mt-1 text-sm text-gray-600">
            Cole um link do Mercado Livre por linha.
          </p>

          <textarea
            id="urls"
            value={urls}
            onChange={(event) =>
              setUrls(event.target.value)
            }
            rows={7}
            placeholder={`https://www.mercadolivre.com.br/produto-1
https://www.mercadolivre.com.br/produto-2
https://meli.la/produto-3`}
            className="mt-4 w-full resize-y rounded-2xl border border-gray-300 bg-gray-50 p-4 text-sm text-gray-900 outline-none transition focus:border-green-500 focus:bg-white focus:ring-4 focus:ring-green-100"
          />

          <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-gray-500">
              Links já cadastrados serão ignorados.
            </p>

            <button
              type="submit"
              disabled={adding || processing}
              className="rounded-xl bg-gray-900 px-6 py-3.5 font-black text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {adding
                ? "Adicionando..."
                : "Adicionar à fila"}
            </button>
          </div>
        </form>

        {addResult && (
          <section
            className={`mt-6 rounded-2xl border p-5 ${
              addResult.success
                ? "border-green-200 bg-green-50"
                : "border-red-200 bg-red-50"
            }`}
          >
            <p
              className={`font-black ${
                addResult.success
                  ? "text-green-800"
                  : "text-red-800"
              }`}
            >
              {addResult.message || addResult.error}
            </p>

            {addResult.success && (
              <div className="mt-3 flex flex-wrap gap-5 text-sm font-bold text-gray-700">
                <span>
                  Recebidos: {addResult.received ?? 0}
                </span>

                <span className="text-green-700">
                  Adicionados: {addResult.added ?? 0}
                </span>

                <span>
                  Ignorados: {addResult.ignored ?? 0}
                </span>
              </div>
            )}
          </section>
        )}

        <section className="mt-6 overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 p-6">
            <div>
              <h2 className="text-xl font-black text-gray-900">
                Produtos da fila
              </h2>

              <p className="mt-1 text-sm text-gray-600">
                Exibindo até os 100 registros mais recentes.
              </p>
            </div>

            <select
              value={filter}
              onChange={(event) =>
                setFilter(
                  event.target.value as
                    | QueueStatus
                    | "ALL"
                )
              }
              className="rounded-xl border border-gray-300 bg-white px-4 py-3 font-bold text-gray-700 outline-none focus:border-green-500 focus:ring-4 focus:ring-green-100"
            >
              <option value="ALL">
                Todos os status
              </option>
              <option value="PENDING">Pendentes</option>
              <option value="PROCESSING">
                Processando
              </option>
              <option value="SUCCESS">Concluídos</option>
              <option value="ERROR">Erros</option>
            </select>
          </div>

          {loadingPanel && items.length === 0 ? (
            <div className="p-10 text-center text-gray-500">
              Carregando produtos da fila...
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="p-10 text-center">
              <p className="font-bold text-gray-700">
                Nenhum produto encontrado neste filtro.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {visibleItems.map((item) => (
                <article
                  key={item.id}
                  className="p-6 transition hover:bg-gray-50"
                >
                  <div className="flex flex-wrap items-start justify-between gap-5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          className={`rounded-full border px-3 py-1 text-xs font-black ${statusClasses(
                            item.status
                          )}`}
                        >
                          {statusLabels[item.status]}
                        </span>

                        <span className="text-xs font-bold text-gray-500">
                          Tentativas: {item.attempts}
                        </span>

                        <span className="text-xs text-gray-500">
                          Adicionado em{" "}
                          {formatDate(item.createdAt)}
                        </span>
                      </div>

                      <h3 className="mt-3 break-words text-base font-black text-gray-900">
                        {item.productName ||
                          "Produto ainda não importado"}
                      </h3>

                      <a
                        href={item.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 block break-all text-sm font-medium text-blue-700 hover:underline"
                      >
                        {item.url}
                      </a>

                      {item.errorMessage && (
                        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
                          <p className="text-sm font-bold text-red-800">
                            {item.errorMessage}
                          </p>
                        </div>
                      )}

                      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-gray-500">
                        <span>
                          Atualizado:{" "}
                          {formatDate(item.updatedAt)}
                        </span>

                        <span>
                          Processado:{" "}
                          {formatDate(item.processedAt)}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3">
                      {item.productId && (
                        <Link
                          href={`/produto/${item.productId}`}
                          className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 transition hover:border-green-500 hover:text-green-700"
                        >
                          Ver produto
                        </Link>
                      )}

                      {item.status === "ERROR" && (
                        <button
                          type="button"
                          onClick={() =>
                            void retryItem(item.id)
                          }
                          disabled={
                            retryingId === item.id
                          }
                          className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {retryingId === item.id
                            ? "Enviando..."
                            : "Tentar novamente"}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

type SummaryCardProps = {
  label: string;
  value: number;
  description: string;
  className: string;
};

function SummaryCard({
  label,
  value,
  description,
  className,
}: SummaryCardProps) {
  return (
    <article
      className={`rounded-2xl border p-5 shadow-sm ${className}`}
    >
      <p className="text-sm font-black uppercase tracking-wide">
        {label}
      </p>

      <p className="mt-2 text-4xl font-black">
        {value}
      </p>

      <p className="mt-2 text-xs font-medium opacity-75">
        {description}
      </p>
    </article>
  );
}