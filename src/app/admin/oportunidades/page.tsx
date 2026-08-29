"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import AdminPushButton from "./AdminPushButton";

type OpportunityStatus =
  | "WAITING_AFFILIATE"
  | "READY_TO_QUEUE"
  | "QUEUED"
  | "PUBLISHED"
  | "DISMISSED"
  | "ERROR";

type DiscoveryMarketplace =
  | "MERCADO_LIVRE"
  | "AMAZON";

type Opportunity = {
  id: string;
  marketplace: DiscoveryMarketplace;
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
  secondPrice?: number | null;
  secondMarketplace?: string | null;
  savings?: number | null;
};

type OpportunityInboxItem = {
  id: string;
  focusId: string;
  source: "opportunity" | "offer";
  opportunityId: string | null;
  offerId: string | null;
  productId: string | null;
  title: string;
  image: string | null;
  sourceUrl: string;
  mlPrice: number | null;
  secondPrice: number | null;
  secondMarketplace: string | null;
  savings: number | null;
  discoveredAt: string;
  status: string;
  affiliateLink: string | null;
};

type OpportunitySummary = {
  total: number;
  waitingAffiliate: number;
  readyToQueue: number;
  queued: number;
  published: number;
  dismissed: number;
  error: number;
  inbox?: number;
};

type OpportunitiesResponse = {
  success: boolean;
  summary?: OpportunitySummary;
  items?: Opportunity[];
  inbox?: OpportunityInboxItem[];
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

type DismissOpportunityResponse = {
  success: boolean;
  message?: string;
  error?: string;
};

type ClearOpportunitiesResponse = {
  success: boolean;
  message?: string;
  error?: string;
  removed?: number;
  preserved?: number;
};

type DiscoverResponse = {
  success: boolean;
  message?: string;
  error?: string;
  marketplace?: DiscoveryMarketplace;
  query?: string;
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
  inbox: 0,
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
    "border-amber-200 bg-amber-50 text-amber-800",
  READY_TO_QUEUE:
    "border-emerald-200 bg-emerald-50 text-emerald-800",
  QUEUED:
    "border-slate-200 bg-slate-50 text-slate-700",
  PUBLISHED:
    "border-emerald-200 bg-emerald-50 text-emerald-800",
  DISMISSED:
    "border-slate-200 bg-slate-50 text-slate-600",
  ERROR:
    "border-red-200 bg-red-50 text-red-800",
};

const marketplaceLabels: Record<
  DiscoveryMarketplace,
  string
> = {
  MERCADO_LIVRE: "Mercado Livre",
  AMAZON: "Amazon",
};

const marketplaceClasses: Record<
  DiscoveryMarketplace,
  string
> = {
  MERCADO_LIVRE:
    "border-yellow-200 bg-yellow-50 text-yellow-800",
  AMAZON:
    "border-orange-200 bg-orange-50 text-orange-800",
};

const marketplaceOpenLabels: Record<
  DiscoveryMarketplace,
  string
> = {
  MERCADO_LIVRE:
    "Abrir no Mercado Livre",
  AMAZON: "Abrir na Amazon",
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

  const [inbox, setInbox] = useState<
    OpportunityInboxItem[]
  >([]);

  const [summary, setSummary] =
    useState<OpportunitySummary>(
      initialSummary
    );

  const [affiliateLinks, setAffiliateLinks] =
    useState<Record<string, string>>({});

  const [inboxLinks, setInboxLinks] =
    useState<Record<string, string>>({});

  const [batchLinks, setBatchLinks] =
    useState("");

  const [
    discoveryMarketplace,
    setDiscoveryMarketplace,
  ] = useState<DiscoveryMarketplace>(
    "MERCADO_LIVRE"
  );

  const [categoryId, setCategoryId] =
    useState("");

  const [amazonQuery, setAmazonQuery] =
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

  const [dismissingId, setDismissingId] =
    useState<string | null>(null);

  const [savingId, setSavingId] =
    useState<string | null>(null);

  const [resolvedIds, setResolvedIds] =
    useState<Record<string, string>>({});

  const [focusedId, setFocusedId] =
    useState<string | null>(null);

  const [clearingOpportunities, setClearingOpportunities] =
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

  const hasPendingMercadoLivre =
    opportunitiesWithoutLink.some(
      (opportunity) =>
        opportunity.marketplace ===
        "MERCADO_LIVRE"
    );

  const hasPendingAmazon =
    opportunitiesWithoutLink.some(
      (opportunity) =>
        opportunity.marketplace ===
        "AMAZON"
    );

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
        setInbox(data.inbox ?? []);

        setInboxLinks((current) => {
          const next = { ...current };

          for (const item of data.inbox ?? []) {
            if (next[item.id] === undefined) {
              next[item.id] = item.affiliateLink ?? "";
            }
          }

          return next;
        });

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

  useEffect(() => {
    function applyFocus(rawId: string | null) {
      const id = rawId?.trim();

      if (!id) {
        return;
      }

      setFocusedId(id);

      window.setTimeout(() => {
        const element = document.getElementById(
          `opportunity-${id}`,
        );

        element?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 120);
    }

    const params = new URLSearchParams(
      window.location.search,
    );
    applyFocus(params.get("focus"));

    function onMessage(event: MessageEvent) {
      if (
        event.data?.type !==
        "OFERTANO_FOCUS_OPPORTUNITY"
      ) {
        return;
      }

      const url = String(event.data.url ?? "");

      try {
        const parsed = new URL(
          url,
          window.location.origin,
        );

        if (
          parsed.origin !== window.location.origin ||
          parsed.pathname !== "/admin/oportunidades"
        ) {
          return;
        }

        applyFocus(parsed.searchParams.get("focus"));
        window.history.replaceState(
          null,
          "",
          `${parsed.pathname}${parsed.search}`,
        );
      } catch {
        applyFocus(null);
      }
    }

    navigator.serviceWorker?.addEventListener(
      "message",
      onMessage,
    );

    return () => {
      navigator.serviceWorker?.removeEventListener(
        "message",
        onMessage,
      );
    };
  }, [inbox, items]);

  async function discoverOpportunities() {
    const normalizedCategoryId =
      categoryId.trim().toUpperCase();

    const normalizedAmazonQuery =
      amazonQuery.trim();

    if (
      discoveryMarketplace ===
        "MERCADO_LIVRE" &&
      !/^MLB\d+$/.test(normalizedCategoryId)
    ) {
      setError(
        "Selecione uma categoria válida do Mercado Livre."
      );
      return;
    }

    if (
      discoveryMarketplace === "AMAZON" &&
      normalizedAmazonQuery.length < 3
    ) {
      setError(
        "Digite o nome do produto que deseja buscar na Amazon."
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

    if (
    discoveryMarketplace === "AMAZON" &&
    pendingOpportunities.length > 0
  ) {
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
          body: JSON.stringify(
            discoveryMarketplace ===
              "AMAZON"
              ? {
                  marketplace: "AMAZON",
                  query:
                    normalizedAmazonQuery,
                  quantity,
                }
              : {
                  marketplace:
                    "MERCADO_LIVRE",
                  categoryId:
                    normalizedCategoryId,
                  quantity,
                }
          ),
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
        `${opportunitiesWithoutLink.length} URL(s) copiada(s). No Mercado Livre, gere os links de afiliado e mantenha a ordem. Produtos Amazon com ASIN já entram com o link automático.`
      );
    } catch {
      setError(
        "Não foi possível copiar as URLs automaticamente."
      );
    } finally {
      setCopyingUrls(false);
    }
  }

  async function dismissOpportunity(
    opportunity: Opportunity
  ) {
    const confirmed = window.confirm(
      `Descartar "${opportunity.title}" por estar indisponível?`
    );

    if (!confirmed) {
      return;
    }

    try {
      setDismissingId(opportunity.id);
      setError("");
      setMessage("");

      const response = await fetch(
        "/api/opportunities",
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            id: opportunity.id,
            reason:
              "Produto indisponível no marketplace.",
          }),
        }
      );

      const data =
        (await response.json()) as DismissOpportunityResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            "Não foi possível descartar o produto."
        );
      }

      setBatchLinks("");

      setMessage(
        data.message ||
          "Produto indisponível descartado."
      );

      await loadOpportunities();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erro ao descartar produto."
      );
    } finally {
      setDismissingId(null);
    }
  }

  async function clearOpportunities() {
    if (items.length === 0) {
      setError("");
      setMessage("A lista de oportunidades já está vazia.");
      return;
    }

    const confirmed = window.confirm(
      "Tem certeza de que deseja limpar a lista de oportunidades? Produtos publicados, ofertas Multi Loja e a fila de importação não serão apagados.",
    );

    if (!confirmed) {
      return;
    }

    try {
      setClearingOpportunities(true);
      setError("");
      setMessage("");

      const response = await fetch(
        "/api/opportunities",
        {
          method: "DELETE",
          credentials: "include",
        },
      );

      const data =
        (await response.json()) as ClearOpportunitiesResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            "Não foi possível limpar as oportunidades.",
        );
      }

      setBatchLinks("");
      setAffiliateLinks({});
      setItems([]);
      setSummary(initialSummary);

      setMessage(
        data.message ||
          `${data.removed ?? 0} oportunidade(s) removida(s).`,
      );

      await loadOpportunities();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erro ao limpar oportunidades.",
      );
    } finally {
      setClearingOpportunities(false);
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
      label: "Pendentes agora",
      value: inbox.length,
    },
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
  ];

  const actionsLocked =
    publishingBatch ||
    dismissingId !== null ||
    clearingOpportunities ||
    savingId !== null;

  async function saveAndRelease(input: {
    id: string;
    opportunityId?: string | null;
    offerId?: string | null;
    affiliateLink: string;
  }) {
    const affiliateLink = input.affiliateLink.trim();

    if (!affiliateLink) {
      setError(
        "Cole o link de afiliado do Mercado Livre antes de salvar.",
      );
      return;
    }

    try {
      setSavingId(input.id);
      setError("");
      setMessage("");

      const response = await fetch(
        "/api/opportunities/release",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            opportunityId:
              input.opportunityId || undefined,
            offerId: input.offerId || undefined,
            affiliateLink,
          }),
        },
      );

      const data = (await response.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
      };

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            "Não foi possível salvar o link de afiliado.",
        );
      }

      setResolvedIds((current) => ({
        ...current,
        [input.id]:
          data.message ||
          "Link salvo. Oferta liberada.",
      }));

      setMessage(
        data.message ||
          "Link salvo. Oferta liberada.",
      );

      await loadOpportunities();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erro ao salvar e liberar a oferta.",
      );
    } finally {
      setSavingId(null);
    }
  }

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              Operação
            </p>

            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
              Oportunidades
            </h1>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Central operacional: quando o Mercado Livre
              tem o menor preço válido, cole o link
              afiliado e libere a oferta pelo celular.
            </p>
          </div>

          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={() =>
                void loadOpportunities()
              }
              disabled={
                loading || actionsLocked
              }
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? "Atualizando..."
                : "Atualizar lista"}
            </button>

            <button
              type="button"
              onClick={() =>
                void clearOpportunities()
              }
              disabled={
                loading || actionsLocked
              }
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {clearingOpportunities
                ? "Limpando..."
                : "Limpar oportunidades"}
            </button>
          </div>
        </div>

        <div className="mb-4">
          <AdminPushButton />
        </div>

        <section className="mb-4">
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">
              Aguardando você
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              Oportunidades pendentes
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Mercado Livre com o menor preço válido e
              sem link afiliado. Toque, cole o link e
              libere a oferta.
            </p>
          </div>

          {loading && inbox.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-slate-600">
              Carregando pendências...
            </div>
          ) : null}

          {!loading && inbox.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-white p-6 text-center">
              <p className="font-semibold text-emerald-800">
                Nenhuma oferta aguardando link agora
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Quando o Mercado Livre for o menor preço,
                a pendência aparece aqui e a notificação
                chega neste dispositivo.
              </p>
            </div>
          ) : null}

          <div className="space-y-4">
            {inbox.map((item) => {
              const resolved = Boolean(resolvedIds[item.id]);
              const focused = focusedId === item.id;

              return (
                <article
                  key={item.id}
                  id={`opportunity-${item.id}`}
                  className={`scroll-mt-24 overflow-hidden rounded-2xl border bg-white p-4 shadow-sm ${
                    focused
                      ? "border-emerald-500 ring-4 ring-emerald-100"
                      : resolved
                        ? "border-emerald-200"
                        : "border-amber-200"
                  }`}
                >
                  <div className="flex gap-3">
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.title}
                          className="h-full w-full object-contain p-2"
                        />
                      ) : (
                        <span className="px-2 text-center text-xs text-slate-500">
                          Sem imagem
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                        {resolved
                          ? "Resolvido"
                          : "Link afiliado necessário"}
                      </p>
                      <h3 className="mt-1 text-base font-semibold leading-snug text-slate-950">
                        {item.title}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDate(item.discoveredAt)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-emerald-50 px-3 py-2">
                      <p className="text-[11px] font-semibold text-emerald-800">
                        Mercado Livre
                      </p>
                      <p className="mt-1 text-lg font-bold text-emerald-700">
                        {formatCurrency(item.mlPrice)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <p className="text-[11px] font-semibold text-slate-500">
                        {item.secondMarketplace
                          ? `2º menor · ${item.secondMarketplace}`
                          : "2º menor preço"}
                      </p>
                      <p className="mt-1 text-lg font-bold text-slate-800">
                        {item.secondPrice === null
                          ? "—"
                          : formatCurrency(item.secondPrice)}
                      </p>
                    </div>
                  </div>

                  {item.savings !== null ? (
                    <p className="mt-2 text-sm font-semibold text-emerald-700">
                      Economia de {formatCurrency(item.savings)}
                    </p>
                  ) : null}

                  {resolved ? (
                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-800">
                      {resolvedIds[item.id]}
                    </div>
                  ) : (
                    <>
                      <a
                        href={item.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800"
                      >
                        Abrir anúncio original
                      </a>

                      <label
                        htmlFor={`inbox-affiliate-${item.id}`}
                        className="mt-4 mb-2 block text-sm font-bold text-slate-800"
                      >
                        Colar link afiliado
                      </label>
                      <textarea
                        id={`inbox-affiliate-${item.id}`}
                        value={inboxLinks[item.id] ?? ""}
                        onChange={(event) => {
                          setInboxLinks((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }));
                        }}
                        rows={3}
                        disabled={actionsLocked}
                        placeholder="https://www.mercadolivre.com.br/social/..."
                        className="min-h-24 w-full rounded-xl border border-slate-300 px-3 py-3 text-base text-slate-900 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 disabled:bg-slate-100"
                      />

                      <button
                        type="button"
                        onClick={() =>
                          void saveAndRelease({
                            id: item.id,
                            opportunityId:
                              item.source ===
                              "opportunity"
                                ? item.opportunityId
                                : undefined,
                            offerId:
                              item.source === "offer"
                                ? item.offerId
                                : undefined,
                            affiliateLink:
                              inboxLinks[item.id] ?? "",
                          })
                        }
                        disabled={actionsLocked}
                        className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {savingId === item.id
                          ? "Salvando..."
                          : "Salvar e liberar oferta"}
                      </button>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <details className="mb-4 rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <summary className="cursor-pointer list-none">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              Etapa 1
            </p>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">
              Descobrir oportunidades
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Busca em lote no Mercado Livre ou Amazon.
              Toque para expandir.
            </p>
          </summary>

          <div className="mb-5 mt-4">

          <div className="grid gap-4 lg:grid-cols-[220px_1fr_160px_auto] lg:items-end">
            <div>
              <label
                htmlFor="discovery-marketplace"
                className="mb-2 block text-sm font-bold text-slate-900"
              >
                Marketplace
              </label>

              <select
                id="discovery-marketplace"
                value={discoveryMarketplace}
                onChange={(event) => {
                  setDiscoveryMarketplace(
                    event.target
                      .value as DiscoveryMarketplace
                  );
                  setError("");
                  setMessage("");
                }}
                disabled={
                  discovering ||
                  publishingBatch
                }
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-slate-50"
              >
                <option value="MERCADO_LIVRE">
                  Mercado Livre
                </option>

                <option value="AMAZON">
                  Amazon
                </option>
              </select>
            </div>

            {discoveryMarketplace ===
            "MERCADO_LIVRE" ? (
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
                    discovering ||
                    publishingBatch
                  }
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-slate-50"
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
                    categories.map(
                      (category) => (
                        <option
                          key={category.id}
                          value={category.id}
                        >
                          {category.name}
                        </option>
                      )
                    )
                  )}
                </select>
              </div>
            ) : (
              <div>
                <label
                  htmlFor="amazon-query"
                  className="mb-2 block text-sm font-bold text-slate-900"
                >
                  Produto para buscar na Amazon
                </label>

                <input
                  id="amazon-query"
                  type="search"
                  value={amazonQuery}
                  onChange={(event) =>
                    setAmazonQuery(
                      event.target.value
                    )
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !discovering &&
                      !publishingBatch &&
                      pendingOpportunities.length ===
                        0
                    ) {
                      event.preventDefault();
                      void discoverOpportunities();
                    }
                  }}
                  disabled={
                    discovering ||
                    publishingBatch
                  }
                  placeholder="Ex.: Samsung Galaxy A55 5G 256GB"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                />
              </div>
            )}

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
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:bg-slate-50"
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
                actionsLocked ||
                (discoveryMarketplace === "AMAZON" &&
                  pendingOpportunities.length > 0) ||
                (discoveryMarketplace ===
                "MERCADO_LIVRE"
                  ? loadingCategories ||
                    !categoryId
                  : amazonQuery.trim().length < 3)
              }
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {discovering
                ? "Descobrindo..."
                : discoveryMarketplace ===
                    "AMAZON"
                  ? "Buscar na Amazon"
                  : "Descobrir produtos"}
            </button>
          </div>
          </div>
        </details>

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

        <section className="mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="border-b border-slate-100 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              Etapa 2
            </p>

            <h2 className="mt-2 text-lg font-semibold text-slate-950">
              Gerar links e publicar
            </h2>

            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              No Mercado Livre, copie as URLs, gere
              os links no programa de afiliados e
              cole abaixo. Na Amazon, o link afiliado
              é gerado automaticamente pelo ASIN e o
              produto já fica pronto para a fila.
            </p>
          </div>

          <div className="grid gap-6 p-6 lg:grid-cols-[0.85fr_1.4fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <p className="text-sm font-bold text-slate-900">
                  Produtos pendentes
                </p>

                <p className="mt-2 text-3xl font-semibold text-emerald-700">
                  {pendingOpportunities.length}
                </p>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="rounded-xl bg-white p-3">
                    <p className="text-xs font-semibold text-slate-500">
                      Links necessários
                    </p>

                    <p className="mt-1 text-xl font-semibold text-slate-900">
                      {linksMissing}
                    </p>
                  </div>

                  <div className="rounded-xl bg-white p-3">
                    <p className="text-xs font-semibold text-slate-500">
                      Links já preenchidos
                    </p>

                    <p className="mt-1 text-xl font-semibold text-slate-900">
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
                    actionsLocked ||
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
                <p className="text-sm font-semibold text-amber-900">
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
                    ? hasPendingAmazon &&
                      hasPendingMercadoLivre
                      ? "Cole os links do Mercado Livre, um por linha, na mesma ordem. Amazon com ASIN não precisa de link manual."
                      : hasPendingAmazon
                        ? "Somente se algum produto Amazon ficou sem ASIN. Caso contrário, o link já foi gerado automaticamente."
                        : "Cole um link por linha:\nhttps://meli.la/...\nhttps://meli.la/..."
                    : "Todos os produtos já possuem link. Clique em publicar."
                }
                rows={9}
                disabled={
                  actionsLocked
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
                  actionsLocked ||
                  pendingOpportunities.length ===
                    0
                }
                className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-lg bg-emerald-600 px-6 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
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
        visibleItems.length === 0 &&
        inbox.length === 0 ? (
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

            const resolved = Boolean(
              resolvedIds[opportunity.id],
            );

            const focused =
              focusedId === opportunity.id;

            return (
              <article
                key={opportunity.id}
                id={`opportunity-${opportunity.id}`}
                className={`scroll-mt-24 overflow-hidden rounded-2xl border bg-white shadow-sm ${
                  focused
                    ? "border-emerald-500 ring-4 ring-emerald-100"
                    : resolved
                      ? "border-emerald-200"
                      : "border-slate-200"
                }`}
              >
                <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-[140px_1fr]">
                  <div className="flex min-h-36 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                    {opportunity.image ? (
                      <img
                        src={
                          opportunity.image
                        }
                        alt={
                          opportunity.title
                        }
                        className="h-36 w-full object-contain p-3"
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
                        className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                          marketplaceClasses[
                            opportunity.marketplace
                          ]
                        }`}
                      >
                        {
                          marketplaceLabels[
                            opportunity.marketplace
                          ]
                        }
                      </span>

                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-bold ${
                          statusClasses[
                            opportunity.status
                          ]
                        }`}
                      >
                        {resolved
                          ? "Resolvido"
                          : statusLabels[
                              opportunity.status
                            ]}
                      </span>

                      {opportunity.discount !==
                      null ? (
                        <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
                          {opportunity.discount}% OFF
                        </span>
                      ) : null}

                      <span className="text-xs text-slate-500">
                        {formatDate(
                          opportunity.discoveredAt
                        )}
                      </span>
                    </div>

                    <h2 className="text-lg font-bold leading-snug text-slate-900 sm:text-xl">
                      {opportunity.title}
                    </h2>

                    <p className="mt-2 text-sm text-slate-500">
                      {opportunity.marketplace ===
                      "AMAZON"
                        ? `ASIN: ${opportunity.externalId}`
                        : opportunity.categoryName ||
                          opportunity.categoryId ||
                          "Categoria não informada"}
                    </p>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-emerald-50 px-3 py-2">
                        <p className="text-[11px] font-semibold text-emerald-800">
                          {opportunity.marketplace ===
                          "MERCADO_LIVRE"
                            ? "Mercado Livre"
                            : "Preço atual"}
                        </p>
                        <p className="mt-1 text-lg font-bold text-emerald-700">
                          {opportunity.price ===
                            null &&
                          opportunity.marketplace ===
                            "AMAZON"
                            ? "Ao publicar"
                            : formatCurrency(
                                opportunity.price
                              )}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[11px] font-semibold text-slate-500">
                          {opportunity.secondMarketplace
                            ? `2º menor · ${opportunity.secondMarketplace}`
                            : opportunity.oldPrice !==
                                null
                              ? "Preço anterior"
                              : "2º menor preço"}
                        </p>
                        <p className="mt-1 text-lg font-bold text-slate-800">
                          {opportunity.secondPrice !==
                            null &&
                          opportunity.secondPrice !==
                            undefined
                            ? formatCurrency(
                                opportunity.secondPrice
                              )
                            : opportunity.oldPrice !==
                                null
                              ? formatCurrency(
                                  opportunity.oldPrice
                                )
                              : "—"}
                        </p>
                      </div>
                    </div>

                    {opportunity.savings ? (
                      <p className="mt-2 text-sm font-semibold text-emerald-700">
                        Economia de{" "}
                        {formatCurrency(
                          opportunity.savings
                        )}
                      </p>
                    ) : null}

                    <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      <a
                        href={
                          opportunity.sourceUrl
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                      >
                        {
                          marketplaceOpenLabels[
                            opportunity.marketplace
                          ]
                        }
                      </a>

                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() =>
                            void dismissOpportunity(
                              opportunity
                            )
                          }
                          disabled={
                            actionsLocked
                          }
                          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {dismissingId ===
                          opportunity.id
                            ? "Descartando..."
                            : "Descartar indisponível"}
                        </button>
                      ) : null}

                      {opportunity.productId ? (
                        <a
                          href={`/produto/${opportunity.productId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-emerald-300 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
                        >
                          Abrir produto no Ofertano
                        </a>
                      ) : null}
                    </div>

                    <div className="mt-5 border-t border-slate-200 pt-5">
                      {resolved ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-800">
                          {resolvedIds[opportunity.id]}
                        </div>
                      ) : (
                        <>
                          <label
                            htmlFor={`affiliate-${opportunity.id}`}
                            className="mb-2 block text-sm font-bold text-slate-800"
                          >
                            Colar link afiliado
                          </label>

                          <textarea
                            id={`affiliate-${opportunity.id}`}
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
                              actionsLocked
                            }
                            rows={3}
                            placeholder={
                              opportunity.marketplace ===
                              "AMAZON"
                                ? "Cole o link afiliado somente se o ASIN não foi identificado"
                                : "https://www.mercadolivre.com.br/social/..."
                            }
                            className="min-h-24 w-full rounded-xl border border-slate-300 px-4 py-3 text-base text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100"
                          />

                          {canEdit &&
                          opportunity.marketplace ===
                            "MERCADO_LIVRE" ? (
                            <button
                              type="button"
                              onClick={() =>
                                void saveAndRelease({
                                  id: opportunity.id,
                                  opportunityId:
                                    opportunity.id,
                                  affiliateLink:
                                    affiliateLinks[
                                      opportunity.id
                                    ] ?? "",
                                })
                              }
                              disabled={
                                actionsLocked
                              }
                              className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {savingId ===
                              opportunity.id
                                ? "Salvando..."
                                : "Salvar e liberar oferta"}
                            </button>
                          ) : null}

                          {opportunity.errorMessage ? (
                            <p className="mt-3 text-sm font-medium text-red-700">
                              {
                                opportunity.errorMessage
                              }
                            </p>
                          ) : null}
                        </>
                      )}
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

