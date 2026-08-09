"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type AlertType = "ANY_DROP" | "TARGET";

type PriceAlertButtonProps = {
  productId: string;
  currentPrice: number;
};

type PriceAlertRow = {
  id: string;
  alert_type: AlertType;
  target_price: number | null;
  reference_price: number;
  last_seen_price: number;
  active: boolean;
};

function formatarPreco(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function converterPrecoDigitado(valor: string) {
  const normalizado = valor
    .trim()
    .replace(/\s/g, "")
    .replace(/^R\$/i, "")
    .replace(/\./g, "")
    .replace(",", ".");

  const numero = Number(normalizado);

  if (!Number.isFinite(numero)) {
    return null;
  }

  return numero;
}

function BellIcon({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path
        d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 21h4" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path
        d="M6 6l12 12M18 6 6 18"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function PriceAlertButton({
  productId,
  currentPrice,
}: PriceAlertButtonProps) {
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] =
    useState(true);
  const [salvando, setSalvando] =
    useState(false);
  const [autenticado, setAutenticado] =
    useState(false);
  const [alertaAtual, setAlertaAtual] =
    useState<PriceAlertRow | null>(null);
  const [tipo, setTipo] =
    useState<AlertType>("ANY_DROP");
  const [precoAlvo, setPrecoAlvo] =
    useState("");
  const [erro, setErro] =
    useState<string | null>(null);
  const [sucesso, setSucesso] =
    useState<string | null>(null);

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      setCarregando(true);

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!ativo) {
          return;
        }

        if (!user) {
          setAutenticado(false);
          setAlertaAtual(null);
          return;
        }

        setAutenticado(true);

        const { data, error } = await supabase
          .from("price_alerts")
          .select(
            `
              id,
              alert_type,
              target_price,
              reference_price,
              last_seen_price,
              active
            `
          )
          .eq("user_id", user.id)
          .eq("product_id", productId)
          .maybeSingle();

        if (!ativo) {
          return;
        }

        if (error) {
          console.error(
            "Erro ao carregar alerta:",
            error.message
          );
          setErro(
            "Não foi possível consultar seu alerta."
          );
          return;
        }

        if (!data) {
          setAlertaAtual(null);
          setTipo("ANY_DROP");
          setPrecoAlvo("");
          return;
        }

        const alerta = data as PriceAlertRow;

        setAlertaAtual(alerta);
        setTipo(
          alerta.alert_type === "TARGET"
            ? "TARGET"
            : "ANY_DROP"
        );

        if (
          alerta.alert_type === "TARGET" &&
          alerta.target_price
        ) {
          setPrecoAlvo(
            alerta.target_price.toLocaleString(
              "pt-BR",
              {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }
            )
          );
        } else {
          setPrecoAlvo("");
        }
      } finally {
        if (ativo) {
          setCarregando(false);
        }
      }
    }

    void carregar();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!ativo) {
          return;
        }

        setAutenticado(Boolean(session?.user));

        if (!session?.user) {
          setAlertaAtual(null);
        }
      }
    );

    return () => {
      ativo = false;
      subscription.unsubscribe();
    };
  }, [productId]);

  useEffect(() => {
    if (!aberto) {
      document.body.style.overflow = "";
      return;
    }

    const overflowAnterior =
      document.body.style.overflow;

    document.body.style.overflow = "hidden";

    function fecharNoEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAberto(false);
      }
    }

    window.addEventListener(
      "keydown",
      fecharNoEscape
    );

    return () => {
      document.body.style.overflow =
        overflowAnterior;
      window.removeEventListener(
        "keydown",
        fecharNoEscape
      );
    };
  }, [aberto]);

  async function salvarAlerta() {
    if (salvando) {
      return;
    }

    setErro(null);
    setSucesso(null);

    if (
      !Number.isFinite(currentPrice) ||
      currentPrice <= 0
    ) {
      setErro(
        "O preço atual deste produto não está disponível."
      );
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setAutenticado(false);
      setErro(
        "Entre na sua conta para criar alertas de preço."
      );
      return;
    }

    let targetPrice: number | null = null;

    if (tipo === "TARGET") {
      targetPrice =
        converterPrecoDigitado(precoAlvo);

      if (
        targetPrice === null ||
        targetPrice <= 0
      ) {
        setErro(
          "Informe um preço-alvo válido."
        );
        return;
      }

      if (targetPrice >= currentPrice) {
        setErro(
          `O menor preço atual já é ${formatarPreco(
            currentPrice
          )}. Defina um valor abaixo do preço atual.`
        );
        return;
      }
    }

    try {
      setSalvando(true);

      const { data, error } = await supabase
        .from("price_alerts")
        .upsert(
          {
            user_id: user.id,
            product_id: productId,
            alert_type: tipo,
            target_price:
              tipo === "TARGET"
                ? targetPrice
                : null,
            reference_price: currentPrice,
            last_seen_price: currentPrice,
            active: true,
            last_notified_price: null,
            last_notified_at: null,
          },
          {
            onConflict:
              "user_id,product_id",
          }
        )
        .select(
          `
            id,
            alert_type,
            target_price,
            reference_price,
            last_seen_price,
            active
          `
        )
        .single();

      if (error) {
        console.error(
          "Erro ao salvar alerta:",
          error.message
        );
        setErro(
          "Não foi possível salvar o alerta."
        );
        return;
      }

      const alerta = data as PriceAlertRow;
      setAlertaAtual(alerta);

      if (tipo === "TARGET") {
        setSucesso(
          `Pronto! Vamos acompanhar este produto e avisar quando o menor preço chegar a ${formatarPreco(
            targetPrice as number
          )} ou menos.`
        );
      } else {
        setSucesso(
          `Pronto! Vamos avisar quando o menor preço cair abaixo de ${formatarPreco(
            currentPrice
          )}.`
        );
      }
    } finally {
      setSalvando(false);
    }
  }

  async function desativarAlerta() {
    if (
      salvando ||
      !alertaAtual
    ) {
      return;
    }

    setErro(null);
    setSucesso(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setAutenticado(false);
      return;
    }

    try {
      setSalvando(true);

      const { error } = await supabase
        .from("price_alerts")
        .update({
          active: false,
        })
        .eq("user_id", user.id)
        .eq("product_id", productId);

      if (error) {
        console.error(
          "Erro ao desativar alerta:",
          error.message
        );
        setErro(
          "Não foi possível desativar o alerta."
        );
        return;
      }

      setAlertaAtual({
        ...alertaAtual,
        active: false,
      });

      setSucesso(
        "Alerta de preço desativado."
      );
    } finally {
      setSalvando(false);
    }
  }

  function abrirLogin() {
    window.location.href = "/login";
  }

  const alertaAtivo =
    Boolean(alertaAtual?.active);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() =>
          setAberto((valor) => !valor)
        }
        disabled={carregando}
        aria-expanded={aberto}
        className={`flex h-9 w-9 items-center justify-center rounded-full border transition disabled:cursor-wait disabled:opacity-60 ${
          alertaAtivo
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            : "border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
        }`}
        aria-label={
          alertaAtivo
            ? "Alerta de preço ativo"
            : "Criar alerta de preço"
        }
        title={
          alertaAtivo
            ? "Alerta de preço ativo"
            : "Criar alerta de preço"
        }
      >
        <BellIcon className="h-5 w-5" />
      </button>

      {aberto && (
        <div
          className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-0 sm:absolute sm:right-0 sm:top-12 sm:inset-auto sm:z-50 sm:block sm:bg-transparent"
          onClick={() => setAberto(false)}
        >
          <div
            className="w-full max-w-none rounded-t-3xl border border-slate-200 bg-white p-4 shadow-2xl sm:w-[360px] sm:max-w-[calc(100vw-32px)] sm:rounded-2xl"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="mx-auto mb-3 h-1.5 w-14 rounded-full bg-slate-200 sm:hidden" />

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">
                  Alerta de preço
                </p>

                <h3 className="mt-1 text-base font-black leading-5 text-slate-950">
                  Avise quando o preço baixar
                </h3>

                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Menor preço atual:{" "}
                  <strong className="text-slate-800">
                    {formatarPreco(
                      currentPrice
                    )}
                  </strong>
                </p>
              </div>

              <button
                type="button"
                onClick={() =>
                  setAberto(false)
                }
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
                aria-label="Fechar alerta"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 max-h-[70vh] overflow-y-auto pr-1 sm:max-h-[75vh]">
              {!autenticado ? (
                <div>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-sm font-bold leading-5 text-amber-900">
                      Entre na sua conta para
                      salvar alertas e recebê-los
                      em todos os seus dispositivos.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={abrirLogin}
                    className="mt-3 flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-600 px-4 text-sm font-black text-white transition hover:bg-emerald-700"
                  >
                    Entrar para criar alerta
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTipo("ANY_DROP");
                        setErro(null);
                        setSucesso(null);
                      }}
                      className={`w-full rounded-2xl border p-3 text-left transition ${
                        tipo === "ANY_DROP"
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                            tipo === "ANY_DROP"
                              ? "border-emerald-600"
                              : "border-slate-300"
                          }`}
                        >
                          {tipo ===
                            "ANY_DROP" && (
                            <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                          )}
                        </span>

                        <div>
                          <p className="text-sm font-black text-slate-900">
                            Qualquer queda de preço
                          </p>

                          <p className="mt-0.5 text-xs leading-4 text-slate-500">
                            Avise quando o menor
                            preço ficar abaixo de{" "}
                            {formatarPreco(
                              currentPrice
                            )}
                            .
                          </p>
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setTipo("TARGET");
                        setErro(null);
                        setSucesso(null);
                      }}
                      className={`w-full rounded-2xl border p-3 text-left transition ${
                        tipo === "TARGET"
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                            tipo === "TARGET"
                              ? "border-emerald-600"
                              : "border-slate-300"
                          }`}
                        >
                          {tipo ===
                            "TARGET" && (
                            <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
                          )}
                        </span>

                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-black text-slate-900">
                            Definir preço-alvo
                          </p>

                          <p className="mt-0.5 text-xs leading-4 text-slate-500">
                            Exemplo: avise quando
                            chegar a R$ 1.500,00.
                          </p>
                        </div>
                      </div>
                    </button>
                  </div>

                  {tipo === "TARGET" && (
                    <div className="mt-3">
                      <label
                        htmlFor={`price-alert-${productId}`}
                        className="mb-1.5 block text-xs font-black text-slate-700"
                      >
                        Avise quando chegar a:
                      </label>

                      <div className="flex h-11 items-center rounded-xl border border-slate-300 bg-white px-3 focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-500/10">
                        <span className="mr-2 text-sm font-black text-slate-500">
                          R$
                        </span>

                        <input
                          id={`price-alert-${productId}`}
                          type="text"
                          inputMode="decimal"
                          value={precoAlvo}
                          onChange={(event) =>
                            setPrecoAlvo(
                              event.target.value
                            )
                          }
                          placeholder="1.500,00"
                          className="min-w-0 flex-1 bg-transparent text-sm font-black text-slate-900 outline-none placeholder:text-slate-400"
                        />
                      </div>
                    </div>
                  )}

                  {erro && (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                      <p className="text-xs font-bold leading-5 text-red-700">
                        {erro}
                      </p>
                    </div>
                  )}

                  {sucesso && (
                    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                      <p className="text-xs font-bold leading-5 text-emerald-800">
                        {sucesso}
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      void salvarAlerta()
                    }
                    disabled={salvando}
                    className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white transition hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
                  >
                    <BellIcon className="h-4 w-4" />

                    {salvando
                      ? "Salvando..."
                      : alertaAtivo
                        ? "Atualizar alerta"
                        : "Criar alerta"}
                  </button>

                  {alertaAtivo && (
                    <button
                      type="button"
                      onClick={() =>
                        void desativarAlerta()
                      }
                      disabled={salvando}
                      className="mt-2 flex min-h-10 w-full items-center justify-center rounded-xl px-4 text-xs font-black text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-60"
                    >
                      Desativar alerta
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}