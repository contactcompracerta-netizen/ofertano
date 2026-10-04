import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <p className="text-sm font-black uppercase tracking-[0.2em] text-emerald-700">
        Erro 404
      </p>
      <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
        Página não encontrada
      </h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-slate-600 sm:text-base">
        O endereço pode ter mudado ou o produto pode não estar mais
        disponível. Volte para comparar ofertas a partir da página inicial.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center justify-center rounded-lg bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-200"
      >
        Voltar para a página inicial
      </Link>
    </main>
  );
}
