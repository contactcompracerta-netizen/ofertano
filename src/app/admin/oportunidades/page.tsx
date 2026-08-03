"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

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

type BatchPublishResponse = {
  success: boolean;
  message?: string;
  error?: string;
  prepared?: number;
  failed?: number;
  processing?: {
    processed: number;
    imported: number;
    errors: number;
  };
};

type DiscoverResponse = {
  success: boolean;
  message?: string;
  error?: string;
  categoryId?: string;
  categoryName?: string;
  requested?: number;
  scanned?: number;
  eligible?: number;
  added?: number;
  ignored?: number;
};

type MercadoLivreCategory = {
  id: string;
  name: string;
};

type CategoriesResponse = {
  success: boolean;
  categories?: MercadoLivreCategory[];
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

const statusLabels: Record<
  OpportunityStatus,
  string
> = {
  WAITING_AFFILIATE: "Aguardando link",
  READY_TO_QUEUE: "Link pronto",
  QUEUED: "Na fila",
  PUBLISHED: "Publicado",
  DISMISSED: "Descartado",
  ERROR: "Erro — tentar novamente",
};

const statusClasses: Record<
  OpportunityStatus,
  string
> = {
  WAITING_AFFILIATE:
    "border-amber-200 bg-amber-100 text-amber-800",
  READY_TO_QUEUE:
    "border-blue-200 bg-blue-100 text-blue-800",
  QUEUED:
    "border-purple-200 bg-purple-100 text-purple-800",
  PUBLISHED:
    "border-emerald-200 bg-emerald-100 text-emerald-800",
  DISMISSED:
    "border-slate-200 bg-slate-100 text-slate-700",
  ERROR:
    "border-red-200 bg-red-100 text-red-800",
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

function extractLinks(text: string): string[] {
  const matches =
    text.match(/https?:\/\/[^\s,;]+/gi) ?? [];

  return matches
    .map((link) =>
      link
        .trim()
        .replace(/[)\]}>.,;]+$/g, "")
    )
    .filter(Boolean);
}

export default function OpportunitiesPage() {
  const [items, setItems] = useState<
    Opportunity[]
  >([]);

  const [summary, setSummary] =
    useState<OpportunitySummary>(
      initialSummary
    );

  const [affiliateLinks, setAffiliateLinks] =
    useState<Record<string, string>>({});

  const [batchLinks, setBatchLinks] =
    useState("");

  const [categoryId, setCategoryId] =
    useState("");

  const [categories, setCategories] =
    useState<MercadoLivreCategory[]>([]);

  const [loadingCategories, setLoadingCategories] =
    useState(true);

  const [quantity, setQuantity] =
    useState(5);

  const [discovering, setDiscovering] =
    useState(false);

  const [loading, setLoading] =
    useState(true);

  const [publishingBatch, setPublishingBatch] =
    useState(false);

  const [copyingUrls, setCopyingUrls] =
    useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] =
    useState("");

  const pendingOpportunities =
    useMemo(
      () =>
        items.filter(
          (item) =>
            item.status ===
              "WAITING_AFFILIATE" ||
            item.status ===
              "READY_TO_QUEUE" ||
            item.status === "ERROR"
        ),
      [items]
    );

  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) =>
          item.status !== "PUBLISHED" &&
          item.status !== "DISMISSED"
      ),
    [items]
  );

  const batchAffiliateLinks = useMemo(
    () => extractLinks(batchLinks),
    [batchLinks]
  );

  const opportunitiesWithoutLink =
    useMemo(
      () =>
        pendingOpportunities.filter(
          (opportunity) =>
            !affiliateLinks[
              opportunity.id
            ]?.trim()
        ),
      [
        affiliateLinks,
        pendingOpportunities,
      ]
    );

  const linksMissing =
    opportunitiesWithoutLink.length;

  const pastedLinksMatch =
    linksMissing === 0
      ? batchAffiliateLinks.length === 0
      : batchAffiliateLinks.length ===
        linksMissing;

  const loadCategories =
    useCallback(async () => {
      try {
        setLoadingCategories(true);
        setError("");

        const response = await fetch(
          "/api/opportunities/categories",
          {
            method: "GET",
            cache: "no-store",
            credentials: "include",
          }
        );

        const data =
          (await response.json()) as CategoriesResponse;

        if (!response.ok || !data.success) {
          throw new Error(
            data.error ||
              "Não foi possível carregar as categorias."
          );
        }

        const loadedCategories =
          data.categories ?? [];

        setCategories(loadedCategories);

        setCategoryId((current) => {
          if (
            current &&
            loadedCategories.some(
              (category) =>
                category.id === current
            )
          ) {
            return current;
          }

          return loadedCategories[0]?.id ?? "";
        });
      } catch (requestError) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Erro ao carregar categorias."
        );
      } finally {
        setLoadingCategories(false);
      }
    }, []);

  const loadOpportunities =
    useCallback(async () => {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          "/api/opportunities",
          {
            method: "GET",
            cache: "no-store",
            credentials: "include",
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

        const loadedItems =
          data.items ?? [];

        setItems(loadedItems);

        setSummary(
          data.summary ?? initialSummary
        );

        setAffiliateLinks(
          Object.fromEntries(
            loadedItems.map((item) => [
              item.id,
              item.affiliateLink ?? "",
            ])
          )
        );
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
    void loadCategories();
    void loadOpportunities();
  }, [loadCategories, loadOpportunities]);

  async function discoverOpportunities() {
    const normalizedCategoryId =
      categoryId.trim().toUpperCase();

    if (!/^MLB\d+$/.test(normalizedCategoryId)) {
      setError(
        "Selecione uma categoria válida do Mercado Livre."
      );
      return;
    }

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 10
    ) {
      setError(
        "A quantidade deve estar entre 1 e 10."
      );
      return;
    }

    if (pendingOpportunities.length > 0) {
      setError(
        "Publique ou corrija os produtos pendentes antes de fazer uma nova descoberta."
      );
      return;
    }

    try {
      setDiscovering(true);
      setError("");
      setMessage("");

      const response = await fetch(
        "/api/opportunities/discover",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            categoryId:
              normalizedCategoryId,
            quantity,
          }),
        }
      );

      const data =
        (await response.json()) as DiscoverResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            "Não foi possível descobrir novas oportunidades."
        );
      }

      setBatchLinks("");

      setMessage(
        data.message ||
          `${data.added ?? 0} oportunidade(s) nova(s) encontrada(s).`
      );

      await loadOpportunities();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erro ao descobrir oportunidades."
      );
    } finally {
      setDiscovering(false);
    }
  }

  async function copyPendingUrls() {
    if (
      opportunitiesWithoutLink.length === 0
    ) {
      setError(
        pendingOpportunities.length === 0
          ? "Não existem oportunidades pendentes."
          : "Todos os produtos pendentes já possuem link de afiliado."
      );
      return;
    }

    try {
      setCopyingUrls(true);
      setError("");
      setMessage("");

      const text =
        opportunitiesWithoutLink
          .map(
            (opportunity) =>
              opportunity.sourceUrl
          )
          .join("\n");

      await navigator.clipboard.writeText(
        text
      );

      setMessage(
        `${opportunitiesWithoutLink.length} URL(s) copiada(s). Gere os links de afiliado e mantenha a mesma ordem.`
      );
    } catch {
      setError(
        "Não foi possível copiar as URLs automaticamente."
      );
    } finally {
      setCopyingUrls(false);
    }
  }

  async function publishBatch() {
    if (
      pendingOpportunities.length === 0
    ) {
      setError(
        "Não existem oportunidades pendentes para publicar."
      );
      return;
    }

    if (
      opportunitiesWithoutLink.length > 0 &&
      batchAffiliateLinks.length !==
        opportunitiesWithoutLink.length
    ) {
      setError(
        `Cole exatamente ${opportunitiesWithoutLink.length} link(s) de afiliado. Foram identificados ${batchAffiliateLinks.length}.`
      );
      return;
    }

    if (
      opportunitiesWithoutLink.length === 0 &&
      batchAffiliateLinks.length > 0
    ) {
      setError(
        "Todos os produtos já possuem link salvo. Apague os links colados ou edite o campo do produto que deseja corrigir."
      );
      return;
    }

    const normalizedBatchLinks =
      batchAffiliateLinks.map(
        (link) => link.trim()
      );

    const uniqueBatchLinks = new Set(
      normalizedBatchLinks.map(
        (link) => link.toLowerCase()
      )
    );

    if (
      uniqueBatchLinks.size !==
      normalizedBatchLinks.length
    ) {
      setError(
        "Existem links repetidos na lista colada."
      );
      return;
    }

    const resolvedLinks = {
      ...affiliateLinks,
    };

    opportunitiesWithoutLink.forEach(
      (opportunity, index) => {
        resolvedLinks[opportunity.id] =
          normalizedBatchLinks[index];
      }
    );

    const payload =
      pendingOpportunities.map(
        (opportunity) => ({
          id: opportunity.id,
          affiliateLink:
            resolvedLinks[
              opportunity.id
            ]?.trim() ?? "",
        })
      );

    const missingAfterAssociation =
      payload.filter(
        (item) => !item.affiliateLink
      );

    if (
      missingAfterAssociation.length > 0
    ) {
      setError(
        `Ainda existem ${missingAfterAssociation.length} produto(s) sem link de afiliado.`
      );
      return;
    }

    const allLinks = payload.map(
      (item) =>
        item.affiliateLink.toLowerCase()
    );

    if (
      new Set(allLinks).size !==
      allLinks.length
    ) {
      setError(
        "O mesmo link de afiliado está associado a mais de um produto."
      );
      return;
    }

    try {
      setPublishingBatch(true);
      setError("");
      setMessage("");

      const response = await fetch(
        "/api/opportunities/batch-publish",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            items: payload,
          }),
        }
      );

      const data =
        (await response.json()) as BatchPublishResponse;

      if (
        !response.ok ||
        !data.success
      ) {
        await loadOpportunities();

        throw new Error(
          data.error ||
            data.message ||
            "Não foi possível publicar os produtos em lote."
        );
      }

      setMessage(
        data.message ||
          "Publicação concluída com sucesso."
      );

      setBatchLinks("");

      await loadOpportunities();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erro ao publicar produtos em lote."
      );
    } finally {
      setPublishingBatch(false);
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
      label: "Links prontos",
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
              Importação rápida de produtos
            </h1>

            <p className="mt-2 text-slate-600">
              Descubra oportunidades, cole os
              links de afiliado e publique tudo
              em uma única operação.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              void loadOpportunities()
            }
            disabled={
              loading ||
              publishingBatch
            }
            className="rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? "Atualizando..."
              : "Atualizar lista"}
          </button>
        </div>

        <section className="mb-8 rounded-3xl border border-blue-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <p className="text-sm font-black uppercase tracking-[0.12em] text-blue-700">
              Etapa 1
            </p>

            <h2 className="mt-2 text-2xl font-black text-slate-950">
              Descobrir oportunidades
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              Escolha a categoria e quantos
              produtos deseja buscar.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_180px_auto] md:items-end">
            <div>
              <label
                htmlFor="category-id"
                className="mb-2 block text-sm font-bold text-slate-900"
              >
                Categoria do Mercado Livre
              </label>

              <select
                id="category-id"
                value={categoryId}
                onChange={(event) =>
                  setCategoryId(
                    event.target.value
                  )
                }
                disabled={
                  loadingCategories ||
                  categories.length === 0 ||
                  publishingBatch
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                {loadingCategories ? (
                  <option value="">
                    Carregando categorias...
                  </option>
                ) : categories.length === 0 ? (
                  <option value="">
                    Nenhuma categoria disponível
                  </option>
                ) : (
                  categories.map((category) => (
                    <option
                      key={category.id}
                      value={category.id}
                    >
                      {category.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label
                htmlFor="quantity"
                className="mb-2 block text-sm font-bold text-slate-900"
              >
                Quantidade
              </label>

              <select
                id="quantity"
                value={quantity}
                onChange={(event) =>
                  setQuantity(
                    Number(event.target.value)
                  )
                }
                disabled={
                  discovering ||
                  publishingBatch
                }
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                {[
                  1, 2, 3, 4, 5,
                  6, 7, 8, 9, 10,
                ].map((value) => (
                  <option
                    key={value}
                    value={value}
                  >
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() =>
                void discoverOpportunities()
              }
              disabled={
                discovering ||
                loading ||
                loadingCategories ||
                publishingBatch ||
                pendingOpportunities.length > 0 ||
                !categoryId
              }
              className="rounded-xl bg-blue-600 px-6 py-3 font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {discovering
                ? "Descobrindo..."
                : "Descobrir produtos"}
            </button>
          </div>
        </section>

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

        <section className="mb-8 overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-sm">
          <div className="border-b border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50 p-6">
            <p className="text-sm font-black uppercase tracking-[0.12em] text-emerald-700">
              Etapa 2
            </p>

            <h2 className="mt-2 text-2xl font-black text-slate-950">
              Gerar links e publicar
            </h2>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Copie as URLs, gere os links no
              programa de afiliados, cole todos
              abaixo e clique uma única vez para
              validar, importar e publicar.
            </p>
          </div>

          <div className="grid gap-6 p-6 lg:grid-cols-[0.85fr_1.4fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-bold text-slate-900">
                  Produtos pendentes
                </p>

                <p className="mt-2 text-3xl font-black text-emerald-700">
                  {pendingOpportunities.length}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-white p-3">
                    <p className="text-xs font-semibold text-slate-500">
                      Links necessários
                    </p>

                    <p className="mt-1 text-xl font-black text-slate-900">
                      {linksMissing}
                    </p>
                  </div>

                  <div className="rounded-xl bg-white p-3">
                    <p className="text-xs font-semibold text-slate-500">
                      Links já preenchidos
                    </p>

                    <p className="mt-1 text-xl font-black text-slate-900">
                      {pendingOpportunities.length -
                        linksMissing}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    void copyPendingUrls()
                  }
                  disabled={
                    copyingUrls ||
                    publishingBatch ||
                    linksMissing === 0
                  }
                  className="mt-5 flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copyingUrls
                    ? "Copiando..."
                    : linksMissing === 0
                      ? "Nenhuma URL para copiar"
                      : `Copiar ${linksMissing} URL(s)`}
                </button>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <p className="text-sm font-black text-amber-900">
                  Mantenha a ordem
                </p>

                <p className="mt-2 text-sm leading-6 text-amber-800">
                  O primeiro link gerado será
                  associado ao primeiro produto
                  sem link, o segundo ao segundo
                  produto e assim por diante.
                </p>
              </div>
            </div>

            <div>
              <label
                htmlFor="batch-affiliate-links"
                className="block text-sm font-bold text-slate-900"
              >
                Links de afiliado gerados
              </label>

              <textarea
                id="batch-affiliate-links"
                value={batchLinks}
                onChange={(event) =>
                  setBatchLinks(
                    event.target.value
                  )
                }
                placeholder={
                  linksMissing > 0
                    ? "Cole um link por linha:\nhttps://meli.la/...\nhttps://meli.la/..."
                    : "Todos os produtos já possuem link. Clique em publicar."
                }
                rows={9}
                disabled={
                  publishingBatch
                }
                className="mt-2 w-full resize-y rounded-2xl border border-slate-300 px-4 py-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100"
              />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold">
                <span
                  className={
                    pastedLinksMatch
                      ? "text-emerald-700"
                      : "text-amber-700"
                  }
                >
                  {batchAffiliateLinks.length} link(s)
                  colado(s)
                </span>

                <span className="text-slate-500">
                  {linksMissing} link(s)
                  necessário(s)
                </span>
              </div>

              {!pastedLinksMatch ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                  Cole exatamente {linksMissing} link(s)
                  para continuar.
                </div>
              ) : null}

              <button
                type="button"
                onClick={() =>
                  void publishBatch()
                }
                disabled={
                  publishingBatch ||
                  pendingOpportunities.length ===
                    0
                }
                className="mt-5 flex w-full items-center justify-center rounded-xl bg-emerald-600 px-6 py-4 text-base font-black text-white shadow-lg shadow-emerald-700/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {publishingBatch
                  ? "Validando e publicando..."
                  : "Validar, importar e publicar agora"}
              </button>

              <p className="mt-3 text-center text-xs leading-5 text-slate-500">
                O sistema salva os links, cria a
                fila, importa os produtos e publica
                no site automaticamente.
              </p>
            </div>
          </div>
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

        {loading &&
        visibleItems.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-600 shadow-sm">
            Carregando oportunidades...
          </div>
        ) : null}

        {!loading &&
        visibleItems.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
            <h2 className="text-xl font-bold text-slate-900">
              Lista de oportunidades limpa
            </h2>

            <p className="mt-2 text-slate-600">
              Os produtos publicados são removidos
              automaticamente desta lista. Faça
              uma nova descoberta para buscar
              outros produtos.
            </p>
          </div>
        ) : null}

        <section className="space-y-5">
          {visibleItems.map((opportunity) => {
            const canEdit =
              opportunity.status ===
                "WAITING_AFFILIATE" ||
              opportunity.status ===
                "READY_TO_QUEUE" ||
              opportunity.status ===
                "ERROR";

            return (
              <article
                key={opportunity.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <div className="grid gap-6 p-5 md:grid-cols-[180px_1fr]">
                  <div className="flex min-h-44 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                    {opportunity.image ? (
                      <img
                        src={
                          opportunity.image
                        }
                        alt={
                          opportunity.title
                        }
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
                        className={`rounded-full border px-3 py-1 text-xs font-bold ${
                          statusClasses[
                            opportunity.status
                          ]
                        }`}
                      >
                        {
                          statusLabels[
                            opportunity.status
                          ]
                        }
                      </span>

                      {opportunity.discount !==
                      null ? (
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

                      {opportunity.oldPrice !==
                      null ? (
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

                    <div className="mt-5 flex flex-wrap gap-3">
                      <a
                        href={
                          opportunity.sourceUrl
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Abrir no Mercado Livre
                      </a>

                      {opportunity.productId ? (
                        <a
                          href={`/produto/${opportunity.productId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          Abrir produto no Ofertano
                        </a>
                      ) : null}
                    </div>

                    <div className="mt-5 border-t border-slate-200 pt-5">
                      <label
                        htmlFor={`affiliate-${opportunity.id}`}
                        className="mb-2 block text-sm font-bold text-slate-800"
                      >
                        Link oficial de afiliado
                      </label>

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
                        disabled={
                          !canEdit ||
                          publishingBatch
                        }
                        placeholder="Preenchido automaticamente pelos links colados acima"
                        className="w-full rounded-xl border border-slate-300 px-4 py-3 text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                      />

                      <p className="mt-2 text-xs text-slate-500">
                        Use este campo apenas para
                        corrigir manualmente um link.
                        Não é necessário salvar
                        separadamente.
                      </p>

                      {opportunity.errorMessage ? (
                        <p className="mt-3 text-sm font-medium text-red-700">
                          {
                            opportunity.errorMessage
                          }
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
