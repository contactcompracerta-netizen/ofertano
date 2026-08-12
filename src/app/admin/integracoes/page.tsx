"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
} from "react";

type IntegrationStatus =
  | "READY"
  | "DISCONNECTED"
  | "CONFIG_REQUIRED";

type Integration = {
  marketplace: string;
  name: string;
  authMode: string;

  configured: boolean;
  connected: boolean;

  status: IntegrationStatus;
  message: string;

  sellerId?: string | null;
  tokenExpiresAt?: string | null;

  affiliateTag?: string | null;
  affiliateStore?: string | null;

  totalOffers: number;
  activeOffers: number;

  lastActivity: string | null;
  lastOfferStatus: string | null;
};

type StatusResponse = {
  success: boolean;
  generatedAt?: string;
  integrations?: Integration[];
  error?: string;
};

type TestResponse = {
  success: boolean;
  marketplace?: string;
  detail?: string;
  durationMs?: number;
  testedAt?: string;
  error?: string;
};

function formatarData(
  value?: string | null,
) {
  if (!value) {
    return "Nenhuma";
  }

  try {
    return new Intl.DateTimeFormat(
      "pt-BR",
      {
        dateStyle: "short",
        timeStyle: "short",
      },
    ).format(new Date(value));
  } catch {
    return value;
  }
}

function textoStatus(
  status: IntegrationStatus,
) {
  if (status === "READY") {
    return "Operacional";
  }

  if (status === "DISCONNECTED") {
    return "Desconectado";
  }

  return "Configuração necessária";
}

function classesStatus(
  status: IntegrationStatus,
) {
  if (status === "READY") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "DISCONNECTED") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }

  return "border-red-200 bg-red-50 text-red-700";
}

function classesIndicador(
  status: IntegrationStatus,
) {
  if (status === "READY") {
    return "bg-emerald-500";
  }

  if (status === "DISCONNECTED") {
    return "bg-amber-500";
  }

  return "bg-red-500";
}

export default function IntegracoesPage() {
  const [
    integrations,
    setIntegrations,
  ] = useState<Integration[]>([]);

  const [
    generatedAt,
    setGeneratedAt,
  ] = useState<string | null>(null);

  const [
    loading,
    setLoading,
  ] = useState(true);

  const [
    error,
    setError,
  ] = useState<string | null>(null);

  const [
    testando,
    setTestando,
  ] = useState<string | null>(null);

  const [
    resultadosTeste,
    setResultadosTeste,
  ] = useState<
    Record<string, TestResponse>
  >({});

  const carregar = useCallback(
    async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          "/api/admin/integracoes/status",
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const data =
          (await response.json()) as StatusResponse;

        if (
          !response.ok ||
          !data.success
        ) {
          throw new Error(
            data.error ||
              "Não foi possível carregar as integrações.",
          );
        }

        setIntegrations(
          data.integrations ?? [],
        );

        setGeneratedAt(
          data.generatedAt ?? null,
        );
      } catch (err) {
        console.error(err);

        setError(
          err instanceof Error
            ? err.message
            : "Erro ao carregar integrações.",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function testarIntegracao(
    marketplace: string,
  ) {
    try {
      setTestando(marketplace);

      setResultadosTeste(
        (atual) => ({
          ...atual,
          [marketplace]: {
            success: false,
            marketplace,
            detail:
              "Executando teste...",
          },
        }),
      );

      const response = await fetch(
        "/api/admin/integracoes/test",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            marketplace,
          }),
        },
      );

      const data =
        (await response.json()) as TestResponse;

      setResultadosTeste(
        (atual) => ({
          ...atual,
          [marketplace]: data,
        }),
      );

      if (data.success) {
        await carregar();
      }
    } catch (err) {
      console.error(err);

      setResultadosTeste(
        (atual) => ({
          ...atual,
          [marketplace]: {
            success: false,
            marketplace,

            error:
              err instanceof Error
                ? err.message
                : "Erro ao testar integração.",

            testedAt:
              new Date().toISOString(),
          },
        }),
      );
    } finally {
      setTestando(null);
    }
  }

  const operacionais =
    integrations.filter(
      (integration) =>
        integration.status === "READY",
    ).length;

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
        <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Link
              href="/admin"
              className="text-sm font-bold text-emerald-700 transition hover:text-emerald-800"
            >
              ← Voltar ao painel
            </Link>

            <p className="mt-5 text-sm font-black uppercase tracking-[0.12em] text-emerald-700">
              Ofertano
            </p>

            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
              Central de Integrações
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Acompanhe conexões,
              credenciais, ofertas e teste
              em tempo real cada marketplace.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              void carregar()
            }
            disabled={loading}
            className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? "Atualizando..."
              : "Atualizar status"}
          </button>
        </div>

        {!loading &&
          !error && (
            <div className="mb-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">
                  Integrações
                </p>

                <p className="mt-2 text-3xl font-black text-slate-950">
                  {
                    integrations.length
                  }
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">
                  Operacionais
                </p>

                <p className="mt-2 text-3xl font-black text-emerald-600">
                  {operacionais}
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-semibold text-slate-500">
                  Última verificação
                </p>

                <p className="mt-2 text-sm font-bold text-slate-900">
                  {formatarData(
                    generatedAt,
                  )}
                </p>
              </div>
            </div>
          )}

        {error && (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5">
            <p className="font-bold text-red-800">
              Não foi possível carregar
              as integrações.
            </p>

            <p className="mt-2 text-sm text-red-700">
              {error}
            </p>
          </div>
        )}

        {loading &&
          integrations.length ===
            0 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
              <p className="font-bold text-slate-800">
                Carregando integrações...
              </p>
            </div>
          )}

        <div className="grid gap-5 lg:grid-cols-2">
          {integrations.map(
            (integration) => {
              const resultado =
                resultadosTeste[
                  integration
                    .marketplace
                ];

              const estaTestando =
                testando ===
                integration
                  .marketplace;

              return (
                <article
                  key={
                    integration.marketplace
                  }
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                >
                  <div className="p-6">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-3">
                          <span
                            className={`h-3 w-3 rounded-full ${classesIndicador(
                              integration.status,
                            )}`}
                          />

                          <h2 className="text-xl font-black text-slate-950">
                            {
                              integration.name
                            }
                          </h2>
                        </div>

                        <p className="mt-2 text-sm font-medium text-slate-500">
                          {
                            integration.authMode
                          }
                        </p>
                      </div>

                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-black ${classesStatus(
                          integration.status,
                        )}`}
                      >
                        {textoStatus(
                          integration.status,
                        )}
                      </span>
                    </div>

                    <p className="mt-5 text-sm leading-6 text-slate-600">
                      {
                        integration.message
                      }
                    </p>

                    <div className="mt-6 grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-slate-50 p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Ofertas
                        </p>

                        <p className="mt-1 text-2xl font-black text-slate-950">
                          {
                            integration.totalOffers
                          }
                        </p>
                      </div>

                      <div className="rounded-xl bg-slate-50 p-4">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                          Ativas
                        </p>

                        <p className="mt-1 text-2xl font-black text-slate-950">
                          {
                            integration.activeOffers
                          }
                        </p>
                      </div>
                    </div>

                    <div className="mt-6 space-y-3 border-t border-slate-100 pt-5 text-sm">
                      <div className="flex items-start justify-between gap-4">
                        <span className="text-slate-500">
                          Última atividade
                        </span>

                        <span className="text-right font-bold text-slate-800">
                          {formatarData(
                            integration.lastActivity,
                          )}
                        </span>
                      </div>

                      <div className="flex items-start justify-between gap-4">
                        <span className="text-slate-500">
                          Último status
                        </span>

                        <span className="text-right font-bold text-slate-800">
                          {integration.lastOfferStatus ??
                            "Sem ofertas"}
                        </span>
                      </div>

                      {integration.sellerId && (
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">
                            Seller ID
                          </span>

                          <span className="text-right font-bold text-slate-800">
                            {
                              integration.sellerId
                            }
                          </span>
                        </div>
                      )}

                      {integration.tokenExpiresAt && (
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">
                            Token expira
                          </span>

                          <span className="text-right font-bold text-slate-800">
                            {formatarData(
                              integration.tokenExpiresAt,
                            )}
                          </span>
                        </div>
                      )}

                      {integration.affiliateTag && (
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">
                            Tag afiliado
                          </span>

                          <span className="text-right font-bold text-slate-800">
                            {
                              integration.affiliateTag
                            }
                          </span>
                        </div>
                      )}

                      {integration.affiliateStore && (
                        <div className="flex items-start justify-between gap-4">
                          <span className="text-slate-500">
                            Vitrine
                          </span>

                          <span className="text-right font-bold text-slate-800">
                            {
                              integration.affiliateStore
                            }
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="mt-6 border-t border-slate-100 pt-5">
                      <button
                        type="button"
                        onClick={() =>
                          void testarIntegracao(
                            integration.marketplace,
                          )
                        }
                        disabled={
                          testando !==
                          null
                        }
                        className="w-full rounded-xl bg-emerald-600 px-5 py-3 font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {estaTestando
                          ? "Testando integração..."
                          : "Testar integração"}
                      </button>

                      {resultado && (
                        <div
                          className={`mt-4 rounded-xl border p-4 ${
                            resultado.success
                              ? "border-emerald-200 bg-emerald-50"
                              : resultado.detail ===
                                  "Executando teste..."
                                ? "border-slate-200 bg-slate-50"
                                : "border-red-200 bg-red-50"
                          }`}
                        >
                          <p
                            className={`font-bold ${
                              resultado.success
                                ? "text-emerald-800"
                                : resultado.detail ===
                                    "Executando teste..."
                                  ? "text-slate-800"
                                  : "text-red-800"
                            }`}
                          >
                            {resultado.success
                              ? "✓ Teste aprovado"
                              : resultado.detail ===
                                  "Executando teste..."
                                ? "Executando..."
                                : "✕ Teste falhou"}
                          </p>

                          <p className="mt-2 text-sm leading-6 text-slate-700">
                            {resultado.detail ||
                              resultado.error ||
                              "Sem detalhes."}
                          </p>

                          {typeof resultado.durationMs ===
                            "number" && (
                            <p className="mt-2 text-xs font-semibold text-slate-500">
                              Tempo de resposta:{" "}
                              {
                                resultado.durationMs
                              }{" "}
                              ms
                            </p>
                          )}

                          {resultado.testedAt && (
                            <p className="mt-1 text-xs text-slate-500">
                              Testado em{" "}
                              {formatarData(
                                resultado.testedAt,
                              )}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            },
          )}
        </div>
      </div>
    </main>
  );
}