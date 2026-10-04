"use client";

import Link from "next/link";

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ error, reset }: ErrorProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <p className="text-sm font-black uppercase tracking-[0.2em] text-rose-600">
        Algo deu errado
      </p>
      <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
        Não foi possível carregar esta página
      </h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-slate-600 sm:text-base">
        Tente novamente em instantes. Se o problema persistir, volte para a
        página inicial e continue comparando ofertas.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-slate-400">
          Código de erro: {error.digest}
        </p>
      ) : null}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-200"
        >
          Tentar novamente
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-lg border border-slate-200 px-5 py-3 text-sm font-black text-slate-800 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
        >
          Página inicial
        </Link>
      </div>
    </main>
  );
}
