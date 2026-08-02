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
  READY_TO_QUEUE: "Pronto para fila",
  QUEUED: "Na fila",
  PUBLISHED: "Publicado",
  DISMISSED: "Descartado",
  ERROR: "Erro",
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

function extrairLinks(texto: string): string[] {
  const encontrados =
    texto.match(/https?:\/\/[^\s,;]+/gi) ?? [];

  return encontrados
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

  const [savingId, setSavingId] =
    useState<string | null>(null);

  const [queueingId, setQueueingId] =
    useState<string | null>(null);

  const [publishingBatch, setPublishingBatch] =
    useState(false);

  const [copyingUrls, setCopyingUrls] =
    useState(false);

  const [error, setError] = useState("");
  const [message, setMessage] =
    useState("");

  const oportunidadesPendentes =
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

  const linksEmLote = useMemo(
    () => extrairLinks(batchLinks),
    [batchLinks]
  );

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

        setAffiliateLinks((current) => {
          const next = { ...current };

          for (const item of loadedItems) {
            if (
              next[item.id] === undefined
            ) {
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
    void loadCategories();
    void loadOpportunities();
  }, [loadCategories, loadOpportunities]);

  async function discoverOpportunities() {
    const normalizedCategoryId =
      categoryId.trim().toUpperCase();

    if (!/^MLB\d+$/.test(normalizedCategoryId)) {
      setError(
        "Informe uma categoria válida no formato MLB seguido de números."
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

    try {
      setDiscovering(true);
      setError("");
      setMessage("");

      const response = await fetch(
        "/api/opportunities/discover",
        {
          method: "POST",
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

  async function copiarUrlsPendentes() {
    if (
      oportunidadesPendentes.length === 0
    ) {
      setError(
        "Não existem oportunidades pendentes."
      );
      return;
    }

    try {
      setCopyingUrls(true);
      setError("");
      setMessage("");

      const texto =
        oportunidadesPendentes
          .map(
            (opportunity, index) =>
              `${index + 1}. ${opportunity.sourceUrl}`
          )
          .join("\n");

      await navigator.clipboard.writeText(
        texto
      );

      setMessage(
        `${oportunidadesPendentes.length} URL(s) copiada(s). Gere os links de afiliado mantendo a mesma ordem.`
      );
    } catch {
      setError(
        "Não foi possível copiar as URLs automaticamente."
      );
    } finally {
      setCopyingUrls(false);
    }
  }

  function aplicarLinksNosCampos() {
    if (linksEmLote.length === 0) {
      setError(
        "Cole pelo menos um link de afiliado válido."
      );
      return;
    }

    if (
      linksEmLote.length >
      oportunidadesPendentes.length
    ) {
      setError(
        `Foram encontrados ${linksEmLote.length} links, mas existem apenas ${oportunidadesPendentes.length} oportunidades pendentes.`
      );
      return;
    }

    setError("");
    setMessage("");

    setAffiliateLinks((current) => {
      const next = { ...current };

      oportunidadesPendentes
        .slice(0, linksEmLote.length)
        .forEach(
          (opportunity, index) => {
            next[opportunity.id] =
              linksEmLote[index];
          }
        );

      return next;
    });

    setMessage(
      `${linksEmLote.length} link(s) associado(s) aos produtos na ordem exibida.`
    );
  }

  async function publicarEmLote() {
    if (
      oportunidadesPendentes.length === 0
    ) {
      setError(
        "Não existem oportunidades pendentes para publicar."
      );
      return;
    }

    const payload =
      oportunidadesPendentes
        .map((opportunity) => ({
          id: opportunity.id,
          affiliateLink:
            affiliateLinks[
              opportunity.id
            ]?.trim() ?? "",
        }))
        .filter(
          (item) => item.affiliateLink
        );

    if (payload.length === 0) {
      setError(
        "Nenhum produto possui link de afiliado preenchido."
      );
      return;
    }

    const semLink =
      oportunidadesPendentes.filter(
        (opportunity) =>
          !affiliateLinks[
            opportunity.id
          ]?.trim()
      );

    if (semLink.length > 0) {
      setError(
        `Ainda existem ${semLink.length} produto(s) sem link de afiliado. Preencha todos antes de publicar.`
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

      if (!response.ok) {
        throw new Error(
          data.error ||
            "Não foi possível publicar os produtos em lote."
        );
      }

      setMessage(
        data.message ||
          "Publicação em lote concluída."
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

  async function saveAffiliateLink(
    opportunity: Opportunity
  ) {
    const affiliateLink =
      affiliateLinks[
        opportunity.id
      ]?.trim() ?? "";

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
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            id: opportunity.id,
            affiliateLink,
          }),
        }
      );

      const data =
        (await response.json()) as {
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

  async function sendToQueue(
    opportunity: Opportunity
  ) {
    try {
      setQueueingId(opportunity.id);
      setError("");
      setMessage("");

      const response = await fetch(
        "/api/opportunities/queue",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            id: opportunity.id,
          }),
        }
      );

      const data =
        (await response.json()) as {
          success: boolean;
          message?: string;
          error?: string;
        };

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            "Não foi possível enviar o produto para a fila."
        );
      }

      setMessage(
        data.message ||
          "Oportunidade enviada para a fila."
      );

      await loadOpportunities();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erro ao enviar oportunidade para a fila."
      );
    } finally {
      setQueueingId(null);
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
              Adicione os links oficiais de
              afiliado e publique vários
              produtos de uma só vez.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              void loadOpportunities()
            }
            disabled={loading}
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
              Descoberta automática
            </p>

            <h2 className="mt-2 text-2xl font-black text-slate-950">
              Descobrir oportunidades
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              Informe a categoria do Mercado Livre e escolha quantos produtos deseja buscar.
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
                  categories.length === 0
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
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(
                  (value) => (
                    <option
                      key={value}
                      value={value}
                    >
                      {value}
                    </option>
                  )
                )}
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
                !categoryId
              }
              className="rounded-xl bg-blue-600 px-6 py-3 font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {discovering
                ? "Descobrindo..."
                : "Descobrir oportunidades"}
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
              Publicação em lote
            </p>

            <h2 className="mt-2 text-2xl font-black text-slate-950">
              Salvar e publicar todos
            </h2>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Copie as URLs pendentes,
              gere os links no programa de
              afiliados e cole um link por
              linha, mantendo a mesma
              ordem dos produtos.
            </p>
          </div>

          <div className="grid gap-6 p-6 lg:grid-cols-[1fr_1.25fr]">
            <div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-bold text-slate-900">
                  Produtos pendentes
                </p>

                <p className="mt-2 text-3xl font-black text-emerald-700">
                  {
                    oportunidadesPendentes.length
                  }
                </p>

                <button
                  type="button"
                  onClick={() =>
                    void copiarUrlsPendentes()
                  }
                  disabled={
                    copyingUrls ||
                    oportunidadesPendentes.length ===
                      0
                  }
                  className="mt-5 flex w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copyingUrls
                    ? "Copiando..."
                    : "Copiar URLs pendentes"}
                </button>
              </div>

              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <p className="text-sm font-black text-amber-900">
                  Atenção à ordem
                </p>

                <p className="mt-2 text-sm leading-6 text-amber-800">
                  O primeiro link colado
                  será associado ao
                  primeiro produto
                  pendente, o segundo ao
                  segundo produto e assim
                  por diante.
                </p>
              </div>
            </div>

            <div>
              <label
                htmlFor="batch-affiliate-links"
                className="block text-sm font-bold text-slate-900"
              >
                Links de afiliado
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
                  "Cole um link por linha:\nhttps://meli.la/...\nhttps://meli.la/..."
                }
                rows={8}
                className="mt-2 w-full resize-y rounded-2xl border border-slate-300 px-4 py-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
              />

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-500">
                <span>
                  {linksEmLote.length} link(s)
                  identificado(s)
                </span>

                <span>
                  {
                    oportunidadesPendentes.length
                  }{" "}
                  produto(s) pendente(s)
                </span>
              </div>

              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={
                    aplicarLinksNosCampos
                  }
                  disabled={
                    publishingBatch ||
                    linksEmLote.length === 0
                  }
                  className="flex-1 rounded-xl border border-emerald-300 bg-emerald-50 px-5 py-3 font-bold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Aplicar links aos produtos
                </button>

                <button
                  type="button"
                  onClick={() =>
                    void publicarEmLote()
                  }
                  disabled={
                    publishingBatch ||
                    oportunidadesPendentes.length ===
                      0
                  }
                  className="flex-1 rounded-xl bg-emerald-600 px-5 py-3 font-black text-white shadow-lg shadow-emerald-700/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {publishingBatch
                    ? "Publicando..."
                    : "Salvar e publicar todos"}
                </button>
              </div>
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

        {loading && visibleItems.length === 0 ? (
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
              automaticamente desta lista.
              Execute uma nova descoberta para
              buscar outros produtos.
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

            const isSaving =
              savingId === opportunity.id;

            const isQueueing =
              queueingId ===
              opportunity.id;

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
                          {
                            opportunity.discount
                          }
                          % OFF
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

                    <div className="mt-5">
                      <a
                        href={
                          opportunity.sourceUrl
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        Abrir produto no Mercado
                        Livre
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
                          onChange={(
                            event
                          ) => {
                            setAffiliateLinks(
                              (current) => ({
                                ...current,
                                [opportunity.id]:
                                  event
                                    .target
                                    .value,
                              })
                            );
                          }}
                          disabled={
                            !canEdit ||
                            isSaving ||
                            publishingBatch
                          }
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
                          disabled={
                            !canEdit ||
                            isSaving ||
                            isQueueing ||
                            publishingBatch
                          }
                          className="rounded-xl bg-emerald-600 px-6 py-3 font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {isSaving
                            ? "Salvando..."
                            : opportunity.status ===
                                "READY_TO_QUEUE"
                              ? "Atualizar link"
                              : "Salvar link"}
                        </button>

                        {opportunity.status ===
                        "READY_TO_QUEUE" ? (
                          <button
                            type="button"
                            onClick={() =>
                              void sendToQueue(
                                opportunity
                              )
                            }
                            disabled={
                              isQueueing ||
                              isSaving ||
                              publishingBatch
                            }
                            className="rounded-xl bg-blue-600 px-6 py-3 font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {isQueueing
                              ? "Enviando..."
                              : "Enviar para fila"}
                          </button>
                        ) : null}
                      </div>

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