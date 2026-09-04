"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type EstadoRecuperacao =
  | "verificando"
  | "pronta"
  | "invalida";

function traduzirErro(message: string) {
  const texto = message.toLowerCase();

  if (texto.includes("invalid recovery")) {
    return "Este link de recuperação não é mais válido. Solicite um novo.";
  }

  if (texto.includes("expired")) {
    return "Este link de recuperação expirou. Solicite um novo e-mail.";
  }

  return "Não foi possível redefinir a senha. Tente novamente.";
}

export default function RecuperarSenhaPage() {
  const [estado, setEstado] =
    useState<EstadoRecuperacao>("verificando");
  const recoveryConfirmada = useRef(false);
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] =
    useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  useEffect(() => {
    let ativo = true;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!ativo) {
          return;
        }

        if (
          event === "PASSWORD_RECOVERY" &&
          session
        ) {
          recoveryConfirmada.current = true;
          setEstado("pronta");
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname
          );
        }
      }
    );

    void supabase.auth.getSession().then(
      ({ data: { session } }) => {
        if (!ativo) {
          return;
        }

        if (
          !session ||
          !recoveryConfirmada.current
        ) {
          setEstado("invalida");
        }
      }
    );

    return () => {
      ativo = false;
      subscription.unsubscribe();
    };
  }, []);

  async function redefinirSenha(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    setErro(null);

    if (!recoveryConfirmada.current) {
      setErro(
        "Este link de recuperação não é mais válido. Solicite um novo."
      );
      return;
    }

    if (!senha || !confirmarSenha) {
      setErro(
        "Preencha a nova senha e a confirmação."
      );
      return;
    }

    if (senha !== confirmarSenha) {
      setErro("As senhas não são iguais.");
      return;
    }

    try {
      setSalvando(true);

      const { error } =
        await supabase.auth.updateUser({
          password: senha,
        });

      if (error) {
        setErro(traduzirErro(error.message));
        return;
      }

      setSucesso(true);
      setSenha("");
      setConfirmarSenha("");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-md">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-sm font-bold text-slate-600 transition hover:text-emerald-700"
        >
          <span aria-hidden="true">←</span>
          Voltar ao Ofertano
        </Link>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/60">
          <div className="border-b border-slate-100 px-6 py-7 sm:px-8">
            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-xl font-black text-white shadow-lg shadow-emerald-600/20">
              O
            </div>

            <h1 className="text-2xl font-black tracking-tight text-slate-950">
              Criar nova senha
            </h1>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              Defina uma nova senha para a sua conta.
            </p>
          </div>

          <div className="px-6 py-7 sm:px-8">
            {estado === "verificando" && (
              <p className="text-sm font-semibold text-slate-600">
                Validando seu link de recuperação...
              </p>
            )}

            {estado === "invalida" && (
              <div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                  Este link de recuperação não é válido
                  ou já expirou. Solicite um novo link de
                  recuperação para continuar.
                </div>

                <Link
                  href="/login"
                  className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-black text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700"
                >
                  Voltar para entrar
                </Link>
              </div>
            )}

            {estado === "pronta" &&
              (sucesso ? (
                <div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                    Senha redefinida. Agora entre com a
                    sua nova senha.
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      window.location.href = "/login";
                    }}
                    className="mt-5 flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-black text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700"
                  >
                    Entrar com a nova senha
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={redefinirSenha}
                  className="space-y-4"
                >
                  <div>
                    <label
                      htmlFor="nova-senha"
                      className="mb-1.5 block text-sm font-bold text-slate-700"
                    >
                      Nova senha
                    </label>

                    <input
                      id="nova-senha"
                      type="password"
                      autoComplete="new-password"
                      value={senha}
                      onChange={(event) =>
                        setSenha(event.target.value)
                      }
                      placeholder="Digite sua nova senha"
                      className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="confirmar-nova-senha"
                      className="mb-1.5 block text-sm font-bold text-slate-700"
                    >
                      Confirmar nova senha
                    </label>

                    <input
                      id="confirmar-nova-senha"
                      type="password"
                      autoComplete="new-password"
                      value={confirmarSenha}
                      onChange={(event) =>
                        setConfirmarSenha(
                          event.target.value
                        )
                      }
                      placeholder="Digite novamente"
                      className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                    />
                  </div>

                  {erro && (
                    <div
                      role="alert"
                      className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
                    >
                      {erro}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={salvando}
                    className="flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-black text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {salvando
                      ? "Salvando..."
                      : "Salvar nova senha"}
                  </button>
                </form>
              ))}
          </div>
        </section>
      </div>
    </main>
  );
}