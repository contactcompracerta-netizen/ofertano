"use client";

import Link from "next/link";
import { useState } from "react";

type MercadoLivreChromeSnapshot = {
  externalId: string;
  title: string;
  price: number;
  oldPrice?: number | null;
  image: string;
  images?: string[];
  description?: string | null;
  brand?: string | null;
  category?: string | null;
  seller?: string | null;
  attributes?: Record<string, string>;
};

type PonteChromeResult = {
  requestId: string;
  success: boolean;
  data?: MercadoLivreChromeSnapshot | null;
  error?: string | null;
};

type QueueClearResponse = {
  success: boolean;
  message?: string;
  error?: string;
  removed?: number;
};

function isMercadoLivreUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname
      .toLowerCase()
      .replace(/^www\./, "");

    return (
      hostname === "meli.la" ||
      hostname.endsWith(".meli.la") ||
      hostname === "mercadolivre.com.br" ||
      hostname.endsWith(".mercadolivre.com.br") ||
      hostname === "mercadolibre.com" ||
      hostname.endsWith(".mercadolibre.com")
    );
  } catch {
    return false;
  }
}

function criarRequestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `ofertano-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function capturarMercadoLivreDoChrome(
  url: string,
): Promise<MercadoLivreChromeSnapshot> {
  if (
    document.documentElement.getAttribute("data-ofertano-ml-bridge") !==
    "ready"
  ) {
    return Promise.reject(
      new Error(
        "Instale e ative a Ponte Chrome do Ofertano e atualize esta página antes de importar um link do Mercado Livre.",
      ),
    );
  }

  const requestId = criarRequestId();

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      window.removeEventListener(
        "ofertano:mercadolivre:capture-result",
        onResult,
      );
      reject(
        new Error(
          "A Ponte Chrome demorou demais para ler o anúncio do Mercado Livre. Tente novamente.",
        ),
      );
    }, 50000);

    function onResult(event: Event) {
      const result = (event as CustomEvent<PonteChromeResult>).detail;

      if (!result || result.requestId !== requestId) {
        return;
      }

      window.clearTimeout(timeout);
      window.removeEventListener(
        "ofertano:mercadolivre:capture-result",
        onResult,
      );

      if (result.success && result.data) {
        resolve(result.data);
        return;
      }

      reject(
        new Error(
          result.error ||
            "A Ponte Chrome não conseguiu ler o anúncio do Mercado Livre.",
        ),
      );
    }

    window.addEventListener(
      "ofertano:mercadolivre:capture-result",
      onResult,
    );

    window.dispatchEvent(
      new CustomEvent("ofertano:mercadolivre:capture", {
        detail: { requestId, url },
      }),
    );
  });
}

const cardClass =
  "flex h-full flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const badgeClass =
  "inline-flex w-fit rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide";

const primaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60";

const destructiveButtonClass =
  "inline-flex h-10 items-center justify-center rounded-lg border border-red-200 bg-white px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60";

export default function AdminPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearMessage, setClearMessage] = useState<string | null>(null);
  const [clearError, setClearError] = useState<string | null>(null);

  async function importarProduto() {
    if (!url.trim()) {
      alert("Cole o link de um produto.");
      return;
    }

    try {
      setLoading(true);
      const productUrl = url.trim();
      let mercadoLivreSnapshot: MercadoLivreChromeSnapshot | undefined;

      if (isMercadoLivreUrl(productUrl)) {
        setImportStatus("Lendo o anúncio no Chrome...");
        mercadoLivreSnapshot = await capturarMercadoLivreDoChrome(productUrl);
      }

      setImportStatus("Importando e procurando outras lojas...");

      const response = await fetch("/api/import-product/v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: productUrl,
          mercadoLivreSnapshot,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Erro ao importar produto.");
        return;
      }

      const comparison = data.comparison;

      const detalhes = comparison
        ? [
            data.message,
            "",
            `Encontradas: ${comparison.found ?? 0}`,
            `Candidatos analisados: ${comparison.scanned ?? 0}`,
            `Importados para validação: ${comparison.importedCandidates ?? 0}`,
            `Rejeitados: ${comparison.rejectedCandidates ?? 0}`,
            comparison.rejections?.length
              ? `Motivos das rejeições:` +
                `\n${comparison.rejections
                  .slice(0, 15)
                  .map(
                    (item: {
                      marketplace?: string;
                      name?: string;
                      reason?: string;
                    }) =>
                      `${item.marketplace ?? "Loja"}: ` +
                      `${item.name ?? "Produto"} — ` +
                      `${item.reason ?? "sem motivo informado"}`,
                  )
                  .join("\n")}`
              : null,
            comparison.errors?.length
              ? `Erros: ${comparison.errors.join(" | ")}`
              : null,
            data.comparisonError
              ? `Erro da comparação: ${data.comparisonError}`
              : null,
          ]
            .filter(Boolean)
            .join("\n")
        : JSON.stringify(data, null, 2);

      alert(detalhes);
      setUrl("");
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error
          ? error.message
          : "Erro ao importar produto.",
      );
    } finally {
      setLoading(false);
      setImportStatus("");
    }
  }

  async function limparFila() {
    try {
      setClearing(true);
      setClearError(null);
      setClearMessage(null);

      const response = await fetch("/api/import-queue/clear", {
        method: "POST",
        credentials: "same-origin",
      });

      const data = (await response.json()) as QueueClearResponse;

      if (!response.ok || !data.success) {
        setConfirmClear(false);
        setClearError(
          data.error || "Não foi possível limpar a fila de importação.",
        );
        return;
      }

      setConfirmClear(false);
      setClearMessage(
        data.message ||
          `${data.removed ?? 0} registro(s) removido(s) da fila.`,
      );
    } catch (error) {
      console.error(error);
      setConfirmClear(false);
      setClearError("Não foi possível limpar a fila de importação.");
    } finally {
      setClearing(false);
    }
  }

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-[1200px]">
        <header className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
            Operação
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            Painel
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Gerencie importação, fila, oportunidades e publicações do Ofertano.
          </p>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <article className={cardClass}>
            <span
              className={`${badgeClass} border-slate-200 bg-slate-50 text-slate-600`}
            >
              Descoberta
            </span>
            <h2 className="mt-3 text-base font-semibold text-slate-950">
              Oportunidades
            </h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
              Gerencie oportunidades, descoberta e publicação de produtos.
            </p>
            <Link
              href="/admin/oportunidades"
              className={`${secondaryButtonClass} mt-5 w-full`}
            >
              Abrir oportunidades
            </Link>
          </article>

          <article className={cardClass}>
            <span
              className={`${badgeClass} border-emerald-200 bg-emerald-50 text-emerald-800`}
            >
              Afiliados
            </span>
            <h2 className="mt-3 text-base font-semibold text-slate-950">
              Links de afiliados
            </h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
              Resolva em lote os links dos produtos que o robô importou
              automaticamente.
            </p>
            <Link
              href="/admin/links-afiliados"
              className={`${primaryButtonClass} mt-5 w-full`}
            >
              Resolver links pendentes
            </Link>
          </article>

          <article className={cardClass}>
            <span
              className={`${badgeClass} border-slate-200 bg-slate-50 text-slate-600`}
            >
              Sistema
            </span>
            <h2 className="mt-3 text-base font-semibold text-slate-950">
              Central de Integrações
            </h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
              Acompanhe conexões, credenciais, ofertas e status dos
              marketplaces.
            </p>
            <Link
              href="/admin/integracoes"
              className={`${secondaryButtonClass} mt-5 w-full`}
            >
              Abrir integrações
            </Link>
          </article>

          <article className={cardClass}>
            <span
              className={`${badgeClass} border-slate-200 bg-slate-50 text-slate-600`}
            >
              Editorial
            </span>
            <h2 className="mt-3 text-base font-semibold text-slate-950">
              Blog do Ofertano
            </h2>
            <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
              Crie, edite, agende e publique artigos diretamente pelo painel.
            </p>
            <Link
              href="/admin/blog"
              className={`${secondaryButtonClass} mt-5 w-full`}
            >
              Administrar blog
            </Link>
          </article>

          <article className={`${cardClass} sm:col-span-2 xl:col-span-1`}>
            <span
              className={`${badgeClass} border-slate-200 bg-slate-50 text-slate-600`}
            >
              Processamento
            </span>
            <h2 className="mt-3 text-base font-semibold text-slate-950">
              Fila de importação
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Acompanhe os produtos enviados para processamento automático.
              Limpar a fila remove apenas os registros da fila, sem apagar
              produtos, ofertas ou comparações já publicados.
            </p>

            {confirmClear ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50/70 p-3">
                <p className="text-sm leading-5 text-red-800">
                  Remover os registros da fila de importação? Itens em
                  processamento serão preservados. Produtos publicados não
                  serão apagados.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => void limparFila()}
                    disabled={clearing}
                    className={`${destructiveButtonClass} flex-1 bg-red-700 text-white hover:bg-red-800`}
                  >
                    {clearing ? "Limpando..." : "Confirmar exclusão"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    disabled={clearing}
                    className={`${secondaryButtonClass} flex-1`}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Link
                  href="/admin/fila"
                  className={`${secondaryButtonClass} w-full`}
                >
                  Abrir fila
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setClearMessage(null);
                    setClearError(null);
                    setConfirmClear(true);
                  }}
                  disabled={clearing}
                  className={`${destructiveButtonClass} w-full`}
                >
                  Limpar fila
                </button>
              </div>
            )}

            {clearMessage ? (
              <p
                className="mt-3 text-sm font-medium text-emerald-700"
                role="status"
              >
                {clearMessage}
              </p>
            ) : null}

            {clearError ? (
              <p
                className="mt-3 text-sm font-medium text-red-700"
                role="alert"
              >
                {clearError}
              </p>
            ) : null}
          </article>
        </section>

        <section className={`${cardClass} mt-4`}>
          <span
            className={`${badgeClass} border-emerald-200 bg-emerald-50 text-emerald-800`}
          >
            Manual
          </span>
          <h2 className="mt-3 text-base font-semibold text-slate-950">
            Importação manual
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            Cole o link de um produto para importá-lo e executar o Multi Loja.
          </p>

          <label
            htmlFor="product-url"
            className="mt-5 block text-sm font-medium text-slate-800"
          >
            Link do produto
          </label>

          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id="product-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.mercadolivre.com.br/..."
              disabled={loading}
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:bg-slate-50"
            />

            <button
              type="button"
              onClick={() => void importarProduto()}
              disabled={loading}
              className={`${primaryButtonClass} h-11 shrink-0 sm:w-48`}
            >
              {loading ? importStatus || "Importando..." : "Importar produto"}
            </button>
          </div>

          {loading ? (
            <p
              className="mt-3 text-sm font-medium text-emerald-700"
              role="status"
            >
              {importStatus || "Importando..."}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}
