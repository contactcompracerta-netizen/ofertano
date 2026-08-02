"use client";

import { useCallback, useEffect, useState } from "react";

type OpportunityStatus =
  | "WAITING_AFFILIATE"
  | "READY_TO_QUEUE"
  | "QUEUED"
  | "PUBLISHED"
  | "DISMISSED"
  | "ERROR";

type Opportunity = {
  id: string;
  externalId: string;
  sourceType: string;
  sourceUrl: string;
  title: string;
  image: string | null;
  categoryId: string | null;
  categoryName: string | null;
  price: number | null;
  oldPrice: number | null;
  discount: number | null;
  affiliateLink: string | null;
  status: OpportunityStatus;
  attempts: number;
  errorMessage: string | null;
  productId: string | null;
  discoveredAt: string;
  updatedAt: string;
  queuedAt: string | null;
  publishedAt: string | null;
};

type OpportunitySummary = {
  total: number;
  waitingAffiliate: number;
  readyToQueue: number;
  queued: number;
  published: number;
  dismissed: number;
  error: number;
};

type OpportunitiesResponse = {
  success: boolean;
  summary?: OpportunitySummary;
  items?: Opportunity[];
  error?: string;
};

const initialSummary: OpportunitySummary = {
  total: 0,
  waitingAffiliate: 0,
  readyToQueue: 0,
  queued: 0,
  published: 0,
  dismissed: 0,
  error: 0,
};

const statusLabels: Record<OpportunityStatus, string> = {
  WAITING_AFFILIATE: "Aguardando link",
  READY_TO_QUEUE: "Pronto para fila",
  QUEUED: "Na fila",
  PUBLISHED: "Publicado",
  DISMISSED: "Descartado",
  ERROR: "Erro",
};

const statusClasses: Record<OpportunityStatus, string> = {
  WAITING_AFFILIATE:
    "bg-amber-100 text-amber-800 border-amber-200",
  READY_TO_QUEUE:
    "bg-blue-100 text-blue-800 border-blue-200",
  QUEUED:
    "bg-purple-100 text-purple-800 border-purple-200",
  PUBLISHED:
    "bg-emerald-100 text-emerald-800 border-emerald-200",
  DISMISSED:
    "bg-slate-100 text-slate-700 border-slate-200",
  ERROR:
    "bg-red-100 text-red-800 border-red-200",
};

function formatCurrency(value: number | null) {
  if (value === null) {
    return "Preço não informado";
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function OpportunitiesPage() {
  const [items, setItems] = useState<Opportunity[]>([]);
  const [summary, setSummary] =
    useState<OpportunitySummary>(initialSummary);

  const [affiliateLinks, setAffiliateLinks] =
    useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] =
    useState<string | null>(null);

  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadOpportunities = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        "/api/opportunities",
        {
          method: "GET",
          cache: "no-store",
        }
      );

      const data =
        (await response.json()) as OpportunitiesResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            "Não foi possível carregar as oportunidades."
        );
      }

      const loadedItems = data.items ?? [];

      setItems(loadedItems);
      setSummary(data.summary ?? initialSummary);

      setAffiliateLinks((current) => {
        const next = { ...current };

        for (const item of loadedItems) {
          if (next[item.id] === undefined) {
            next[item.id] =
              item.affiliateLink ?? "";
          }
        }

        return next;
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erro ao carregar oportunidades."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOpportunities();
  }, [loadOpportunities]);

  async function saveAffiliateLink(
    opportunity: Opportunity
  ) {
    const affiliateLink =
      affiliateLinks[opportunity.id]?.trim() ?? "";

    if (!affiliateLink) {
      setError(
        "Cole o link oficial de afiliado antes de salvar."
      );
      return;
    }

    try {
      setSavingId(opportunity.id);
      setError("");
      setMessage("");

      const response = await fetch(
        "/api/opportunities/affiliate",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: opportunity.id,
            affiliateLink,
          }),
        }
      );

      const data = (await response.json()) as {
        success: boolean;
        message?: string;
        error?: string;
      };

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            "Não foi possível salvar o link."
        );
      }

      setMessage(
        data.message ||
          "Link de afiliado salvo com sucesso."
      );

      await loadOpportunities();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erro ao salvar o link de afiliado."
      );
    } finally {
      setSavingId(null);
    }
  }

  const summaryCards = [
    {
      label: "Total",
      value: summary.total,
    },
    {
      label: "Aguardando link",
      value: summary.waitingAffiliate,
    },
    {
      label: "Prontos",
      value: summary.readyToQueue,
    },
    {
      label: "Na fila",
      value: summary.queued,
    },
    {
      label: "Publicados",
      value: summary.published,
    },
    {
      label: "Erros",
      value: summary.error,
    },
  ];

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-emerald-600">
              Painel administrativo
            </p>

            <h1 className="text-3xl font-bold text-slate-900">
              Oportunidades encontradas
            </h1>

            <p className="mt-2 text-slate-600">
              Analise os produtos e adicione o link
              oficial de afiliado antes da publicação.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadOpportunities()}
            disabled={loading}
            className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Atualizando..." : "Atualizar lista"}
          </button>
        </div>

        <section className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
          {summaryCards.map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <p className="text-sm font-medium text-slate-500">
                {card.label}
              </p>

              <p className="mt-2 text-3xl font-bold text-slate-900">
                {card.value}
              </p>
            </div>
          ))}
        </section>

        {error ? (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">
            {error}
          </div>
        ) : null}

        {message ? (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
            {message}
          </div>
        ) : null}

        {loading && items.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-600 shadow-sm">
            Carregando oportunidades...
          </div>
        ) : null}

        {!loading && items.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">
              Nenhuma oportunidade encontrada
            </h2>

            <p className="mt-2 text-slate-600">
              Execute a descoberta de produtos para
              preencher esta lista.
            </p>
          </div>
        ) : null}

        <section className="space-y-5">
          {items.map((opportunity) => {
            const canEdit =
              opportunity.status ===
                "WAITING_AFFILIATE" ||
              opportunity.status ===
                "READY_TO_QUEUE" ||
              opportunity.status === "ERROR";

            const isSaving =
              savingId === opportunity.id;

            return (
              <article
                key={opportunity.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="grid gap-6 p-5 md:grid-cols-[180px_1fr]">
                  <div className="flex min-h-44 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                    {opportunity.image ? (
                      <img
                        src={opportunity.image}
                        alt={opportunity.title}
                        className="h-44 w-full object-contain p-3"
                      />
                    ) : (
                      <span className="px-4 text-center text-sm text-slate-500">
                        Imagem não disponível
                      </span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-bold ${statusClasses[opportunity.status]}`}
                      >
                        {statusLabels[opportunity.status]}
                      </span>

                      {opportunity.discount !== null ? (
                        <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
                          {opportunity.discount}% OFF
                        </span>
                      ) : null}

                      <span className="text-xs text-slate-500">
                        Descoberto em{" "}
                        {formatDate(
                          opportunity.discoveredAt
                        )}
                      </span>
                    </div>

                    <h2 className="text-xl font-bold leading-snug text-slate-900">
                      {opportunity.title}
                    </h2>

                    <p className="mt-2 text-sm text-slate-500">
                      {opportunity.categoryName ||
                        opportunity.categoryId ||
                        "Categoria não informada"}
                    </p>

                    <div className="mt-4 flex flex-wrap items-end gap-4">
                      <div>
                        <p className="text-sm text-slate-500">
                          Preço atual
                        </p>

                        <p className="text-2xl font-bold text-emerald-600">
                          {formatCurrency(
                            opportunity.price
                          )}
                        </p>
                      </div>

                      {opportunity.oldPrice !== null ? (
                        <div>
                          <p className="text-sm text-slate-500">
                            Preço anterior
                          </p>

                          <p className="text-base text-slate-500 line-through">
                            {formatCurrency(
                              opportunity.oldPrice
                            )}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-5">
                      <a
                        href={opportunity.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Abrir produto no Mercado Livre
                      </a>
                    </div>

                    <div className="mt-5 border-t border-slate-200 pt-5">
                      <label
                        htmlFor={`affiliate-${opportunity.id}`}
                        className="mb-2 block text-sm font-bold text-slate-800"
                      >
                        Link oficial de afiliado
                      </label>

                      <div className="flex flex-col gap-3 lg:flex-row">
                        <input
                          id={`affiliate-${opportunity.id}`}
                          type="url"
                          value={
                            affiliateLinks[
                              opportunity.id
                            ] ?? ""
                          }
                          onChange={(event) => {
                            setAffiliateLinks(
                              (current) => ({
                                ...current,
                                [opportunity.id]:
                                  event.target.value,
                              })
                            );
                          }}
                          disabled={!canEdit || isSaving}
                          placeholder="Cole aqui o link gerado no programa de afiliados"
                          className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                        />

                        <button
                          type="button"
                          onClick={() =>
                            void saveAffiliateLink(
                              opportunity
                            )
                          }
                          disabled={!canEdit || isSaving}
                          className="rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSaving
                            ? "Salvando..."
                            : opportunity.status ===
                                "READY_TO_QUEUE"
                              ? "Atualizar link"
                              : "Salvar link"}
                        </button>
                      </div>

                      {opportunity.errorMessage ? (
                        <p className="mt-3 text-sm font-medium text-red-700">
                          {opportunity.errorMessage}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}