"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { garantirSincronizacaoDaSessao } from "@/services/favorites";

type Mode = "login" | "signup";

function traduzirErro(message: string) {
  const texto = message.toLowerCase();

  if (texto.includes("invalid login credentials")) {
    return "E-mail ou senha incorretos.";
  }

  if (texto.includes("email not confirmed")) {
    return "Confirme seu e-mail antes de entrar.";
  }

  if (texto.includes("user already registered")) {
    return "Já existe uma conta com este e-mail.";
  }

  if (texto.includes("password should be at least")) {
    return "A senha precisa ter pelo menos 6 caracteres.";
  }

  if (texto.includes("unable to validate email address")) {
    return "Digite um endereço de e-mail válido.";
  }

  return message;
}

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const criandoConta = mode === "signup";

  const titulo = useMemo(
    () => (criandoConta ? "Criar sua conta" : "Entrar no Ofertano"),
    [criandoConta]
  );

  async function enviar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setErro(null);
    setMensagem(null);

    const emailLimpo = email.trim();

    if (!emailLimpo || !senha) {
      setErro("Preencha o e-mail e a senha.");
      return;
    }

    if (criandoConta && senha !== confirmarSenha) {
      setErro("As senhas não são iguais.");
      return;
    }

    if (senha.length < 6) {
      setErro("A senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    try {
      setLoading(true);

      if (criandoConta) {
        const { data, error } = await supabase.auth.signUp({
          email: emailLimpo,
          password: senha,
          options: {
            emailRedirectTo: `${window.location.origin}/favoritos`,
          },
        });

        if (error) {
          setErro(traduzirErro(error.message));
          return;
        }

        if (data.session) {
          await garantirSincronizacaoDaSessao({ forcar: true });
          window.location.href = "/favoritos";
          return;
        }

        setMensagem(
          "Conta criada. Verifique seu e-mail para confirmar o cadastro e depois entre no Ofertano."
        );
        setMode("login");
        setSenha("");
        setConfirmarSenha("");
        return;
      }

      const { error } = await supabase.auth.signInWithPassword({
        email: emailLimpo,
        password: senha,
      });

      if (error) {
        setErro(traduzirErro(error.message));
        return;
      }

      await garantirSincronizacaoDaSessao({ forcar: true });
      window.location.href = "/favoritos";
    } catch {
      setErro("Não foi possível concluir a operação. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function recuperarSenha() {
    setErro(null);
    setMensagem(null);

    const emailLimpo = email.trim();

    if (!emailLimpo) {
      setErro("Digite seu e-mail para recuperar a senha.");
      return;
    }

    try {
      setLoading(true);

      const { error } = await supabase.auth.resetPasswordForEmail(
        emailLimpo,
        {
          redirectTo: `${window.location.origin}/login`,
        }
      );

      if (error) {
        setErro(traduzirErro(error.message));
        return;
      }

      setMensagem(
        "Enviamos as instruções de recuperação para o seu e-mail."
      );
    } catch {
      setErro("Não foi possível enviar o e-mail de recuperação.");
    } finally {
      setLoading(false);
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
              {titulo}
            </h1>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              {criandoConta
                ? "Crie sua conta para manter seus produtos favoritos salvos em qualquer dispositivo."
                : "Entre para acessar seus favoritos e continuar comparando ofertas."}
            </p>
          </div>

          <div className="px-6 py-7 sm:px-8">
            <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setErro(null);
                  setMensagem(null);
                }}
                className={`rounded-lg px-3 py-2.5 text-sm font-black transition ${
                  mode === "login"
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Entrar
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode("signup");
                  setErro(null);
                  setMensagem(null);
                }}
                className={`rounded-lg px-3 py-2.5 text-sm font-black transition ${
                  mode === "signup"
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                Criar conta
              </button>
            </div>

            <form onSubmit={enviar} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-sm font-bold text-slate-700"
                >
                  E-mail
                </label>

                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="seuemail@exemplo.com"
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-3">
                  <label
                    htmlFor="senha"
                    className="block text-sm font-bold text-slate-700"
                  >
                    Senha
                  </label>

                  {!criandoConta && (
                    <button
                      type="button"
                      onClick={() => void recuperarSenha()}
                      disabled={loading}
                      className="text-xs font-bold text-emerald-700 transition hover:text-emerald-800 disabled:opacity-50"
                    >
                      Esqueci minha senha
                    </button>
                  )}
                </div>

                <input
                  id="senha"
                  type="password"
                  autoComplete={
                    criandoConta ? "new-password" : "current-password"
                  }
                  value={senha}
                  onChange={(event) => setSenha(event.target.value)}
                  placeholder="Mínimo de 6 caracteres"
                  className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                />
              </div>

              {criandoConta && (
                <div>
                  <label
                    htmlFor="confirmar-senha"
                    className="mb-1.5 block text-sm font-bold text-slate-700"
                  >
                    Confirmar senha
                  </label>

                  <input
                    id="confirmar-senha"
                    type="password"
                    autoComplete="new-password"
                    value={confirmarSenha}
                    onChange={(event) =>
                      setConfirmarSenha(event.target.value)
                    }
                    placeholder="Digite a senha novamente"
                    className="h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                  />
                </div>
              )}

              {erro && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
                >
                  {erro}
                </div>
              )}

              {mensagem && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                  {mensagem}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-black text-white shadow-lg shadow-emerald-600/20 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading
                  ? "Aguarde..."
                  : criandoConta
                    ? "Criar minha conta"
                    : "Entrar"}
              </button>
            </form>

            <div className="mt-6 rounded-2xl bg-slate-50 p-4">
              <p className="text-xs leading-5 text-slate-500">
                O cadastro é opcional. Você pode continuar navegando e
                comparando preços sem criar uma conta.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}