"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

type PendingItem = {
  offerId: string;
  productId: string;
  opportunityId: string;
  externalId: string;
  sourceUrl: string;
  name: string;
  image: string | null;
  price: number;
  createdAt: string;
};

type ListResponse = {
  success: boolean;
  total?: number;
  items?: PendingItem[];
  error?: string;
};

type SaveResponse = {
  success: boolean;
  updated?: number;
  message?: string;
  error?: string;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function parseLinks(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function AffiliateLinksPage() {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [linksText, setLinksText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const links = useMemo(
    () => parseLinks(linksText),
    [linksText],
  );

  const quantidadeCorreta =
    items.length > 0 &&
    links.length === items.length;

  const carregarPendentes = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch(
        "/api/opportunities/affiliate/offers",
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        },
      );

      const data =
        (await response.json()) as ListResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            "Não foi possível carregar os links pendentes.",
        );
      }

      setItems(data.items ?? []);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erro ao carregar links pendentes.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void carregarPendentes();
  }, [carregarPendentes]);

  async function copiarUrls() {
    if (items.length === 0) {
      setError(
        "Não existem produtos aguardando link.",
      );
      return;
    }

    try {
      setCopying(true);
      setError("");
      setMessage("");

      const texto = items
        .map((item) => item.sourceUrl)
        .join("\n");

      await navigator.clipboard.writeText(texto);

      setMessage(
        `${items.length} URL(s) copiadas. Cole no Gerador de Links do Mercado Livre.`,
      );
    } catch {
      setError(
        "Não foi possível copiar as URLs.",
      );
    } finally {
      setCopying(false);
    }
  }

  async function ativarLinks() {
    if (items.length === 0) {
      setError(
        "Não existem produtos pendentes.",
      );
      return;
    }

    if (links.length !== items.length) {
      setError(
        `Cole exatamente ${items.length} link(s). Foram encontrados ${links.length}.`,
      );
      return;
    }

    const linksUnicos = new Set(
      links.map((link) => link.toLowerCase()),
    );

    if (linksUnicos.size !== links.length) {
      setError(
        "Existem links repetidos na lista.",
      );
      return;
    }

    try {
      setSaving(true);
      setError("");
      setMessage("");

      const payload = items.map(
        (item, index) => ({
          offerId: item.offerId,
          affiliateLink: links[index],
        }),
      );

      const response = await fetch(
        "/api/opportunities/affiliate/offers",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            items: payload,
          }),
        },
      );

      const data =
        (await response.json()) as SaveResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            "Não foi possível ativar os links.",
        );
      }

      setLinksText("");

      setMessage(
        data.message ||
          "Links ativados com sucesso.",
      );

      await carregarPendentes();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Erro ao ativar links.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-wider text-emerald-700">
              Mercado Livre
            </p>

            <h1 className="mt-2 text-3xl font-black text-slate-950">
              Links de afiliados
            </h1>

            <p className="mt-2 text-slate-600">
              Resolva em lote os produtos importados automaticamente.
            </p>
          </div>

          <Link
            href="/admin"
            className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-center font-bold text-slate-700"
          >
            Voltar ao painel
          </Link>
        </div>

        {error ? (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 font-semibold text-red-800">
            {error}
          </div>
        ) : null}

        {message ? (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 p-4 font-semibold text-emerald-800">
            {message}
          </div>
        ) : null}

        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">
              Aguardando link
            </p>

            <p className="mt-2 text-4xl font-black">
              {items.length}
            </p>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">
              Links colados
            </p>

            <p className="mt-2 text-4xl font-black">
              {links.length}
            </p>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">
              Situação
            </p>

            <p
              className={`mt-2 text-xl font-black ${
                quantidadeCorreta
                  ? "text-emerald-700"
                  : "text-amber-700"
              }`}
            >
              {items.length === 0
                ? "Tudo resolvido"
                : quantidadeCorreta
                  ? "Pronto para ativar"
                  : "Aguardando links"}
            </p>
          </div>
        </div>

        <section className="mb-8 rounded-3xl border border-emerald-200 bg-white p-6 shadow-sm">
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-xl font-black">
                1. Copiar produtos
              </h2>

              <p className="mt-2 text-sm leading-6 text-slate-600">
                Copie as URLs e cole no Gerador de produtos recomendados do Mercado Livre usando a etiqueta
                {" "}
                <strong>ofertano</strong>.
              </p>

              <button
                type="button"
                onClick={() => void copiarUrls()}
                disabled={
                  copying ||
                  saving ||
                  items.length === 0
                }
                className="mt-5 w-full rounded-xl bg-blue-600 px-5 py-4 font-black text-white disabled:opacity-50"
              >
                {copying
                  ? "Copiando..."
                  : `Copiar ${items.length} URL(s)`}
              </button>

              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                No Mercado Livre, mantenha a mesma ordem e escolha
                {" "}
                <strong>Links completos</strong>.
              </div>
            </div>

            <div>
              <h2 className="text-xl font-black">
                2. Colar links gerados
              </h2>

              <textarea
                value={linksText}
                onChange={(event) =>
                  setLinksText(event.target.value)
                }
                rows={9}
                disabled={saving}
                placeholder={"Cole um link por linha:\nhttps://www.mercadolivre.com.br/social/..."}
                className="mt-3 w-full rounded-2xl border border-slate-300 p-4 text-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
              />

              <p
                className={`mt-3 font-bold ${
                  quantidadeCorreta
                    ? "text-emerald-700"
                    : "text-amber-700"
                }`}
              >
                {links.length} de {items.length} links
              </p>

              <button
                type="button"
                onClick={() => void ativarLinks()}
                disabled={
                  saving ||
                  !quantidadeCorreta
                }
                className="mt-5 w-full rounded-xl bg-emerald-600 px-5 py-4 font-black text-white disabled:opacity-50"
              >
                {saving
                  ? "Validando e ativando..."
                  : "Validar e ativar todos"}
              </button>
            </div>
          </div>
        </section>

        {loading ? (
          <div className="rounded-2xl bg-white p-10 text-center">
            Carregando...
          </div>
        ) : null}

        {!loading && items.length === 0 ? (
          <div className="rounded-2xl border border-emerald-200 bg-white p-10 text-center">
            <h2 className="text-2xl font-black text-emerald-700">
              Nenhum link pendente
            </h2>

            <p className="mt-2 text-slate-600">
              Todos os produtos do Mercado Livre estão resolvidos.
            </p>
          </div>
        ) : null}

        {!loading && items.length > 0 ? (
          <section className="space-y-4">
            <h2 className="text-xl font-black">
              Prévia da associação
            </h2>

            {items.map((item, index) => (
              <article
                key={item.offerId}
                className="grid gap-4 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-[80px_1fr] lg:grid-cols-[80px_1fr_1.2fr]"
              >
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
                  {item.image ? (
                    <img
                      src={item.image}
                      alt={item.name}
                      className="h-full w-full object-contain p-2"
                    />
                  ) : (
                    <span className="text-xs text-slate-400">
                      Sem imagem
                    </span>
                  )}
                </div>

                <div>
                  <p className="text-xs font-black text-emerald-700">
                    #{index + 1}
                  </p>

                  <h3 className="mt-1 font-bold">
                    {item.name}
                  </h3>

                  <p className="mt-2 font-black text-emerald-700">
                    {formatCurrency(item.price)}
                  </p>

                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-xs font-bold text-blue-700 hover:underline"
                  >
                    Abrir no Mercado Livre
                  </a>
                </div>

                <div className="rounded-xl bg-slate-50 p-4">
                  <p className="text-xs font-bold text-slate-500">
                    LINK #{index + 1}
                  </p>

                  <p className="mt-2 break-all text-xs leading-5">
                    {links[index] ||
                      "Aguardando link correspondente..."}
                  </p>
                </div>
              </article>
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}
