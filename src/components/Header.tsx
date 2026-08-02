"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Logo from "@/components/Logo";

const linksNavegacao = [
  { nome: "Início", href: "/" },
  { nome: "Ofertas", href: "/ofertas" },
  { nome: "Categorias", href: "/categorias" },
  { nome: "Blog", href: "/blog" },
];

export default function Header() {
  const pathname = usePathname();
  const [menuAberto, setMenuAberto] = useState(false);
  const [buscaAberta, setBuscaAberta] = useState(false);

  function fecharPaineis() {
    setMenuAberto(false);
    setBuscaAberta(false);
  }

  function alternarBusca() {
    setBuscaAberta((estadoAtual) => {
      const proximoEstado = !estadoAtual;

      if (proximoEstado) {
        setMenuAberto(false);
      }

      return proximoEstado;
    });
  }

  function alternarMenu() {
    setMenuAberto((estadoAtual) => {
      const proximoEstado = !estadoAtual;

      if (proximoEstado) {
        setBuscaAberta(false);
      }

      return proximoEstado;
    });
  }

  function linkEstaAtivo(href: string) {
    if (href === "/") {
      return pathname === "/";
    }

    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 shadow-[0_8px_30px_rgba(15,23,42,0.06)] backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-3 sm:px-4 lg:px-6">
        <div className="flex h-16 items-center gap-3 lg:gap-4">
          <div
            onClick={fecharPaineis}
            className="flex min-w-0 shrink-0 items-center [&_p]:hidden xl:[&_p]:block"
          >
            <Logo />
          </div>

          <form
            action="/"
            method="GET"
            className="relative hidden min-w-0 flex-1 md:block"
          >
            <label htmlFor="busca-header" className="sr-only">
              Pesquisar produtos
            </label>

            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M16.5 16.5L21 21" />
            </svg>

            <input
              id="busca-header"
              name="q"
              type="search"
              autoComplete="off"
              placeholder="Busque por produto, marca ou categoria"
              className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-12 pr-28 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
            />

            <button
              type="submit"
              className="absolute right-1 top-1 h-9 rounded-xl bg-[#087A55] px-5 text-sm font-black text-white transition hover:bg-[#066747]"
            >
              Buscar
            </button>
          </form>

          <nav className="hidden items-center gap-1 xl:flex">
            {linksNavegacao.map((link) => {
              const ativo = linkEstaAtivo(link.href);

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-xl px-3 py-2.5 text-sm font-bold transition ${
                    ativo
                      ? "bg-emerald-50 text-emerald-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-emerald-700"
                  }`}
                >
                  {link.nome}
                </Link>
              );
            })}
          </nav>

          <a
            href="https://www.instagram.com/ofertano.br/"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 transition hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700 lg:flex"
          >
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle
                cx="17.5"
                cy="6.5"
                r="0.8"
                fill="currentColor"
                stroke="none"
              />
            </svg>

            Instagram
          </a>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={alternarBusca}
              aria-label={buscaAberta ? "Fechar pesquisa" : "Abrir pesquisa"}
              aria-expanded={buscaAberta}
              aria-controls="pesquisa-mobile"
              className={`flex h-10 w-10 items-center justify-center rounded-xl border transition md:hidden ${
                buscaAberta
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-slate-200 bg-white text-slate-800 hover:bg-emerald-50 hover:text-emerald-700"
              }`}
            >
              {buscaAberta ? (
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M6 6L18 18" />
                  <path d="M18 6L6 18" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M16.5 16.5L21 21" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={alternarMenu}
              aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
              aria-expanded={menuAberto}
              aria-controls="menu-mobile"
              className={`flex h-10 w-10 items-center justify-center rounded-xl border transition xl:hidden ${
                menuAberto
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-slate-200 bg-white text-slate-800 hover:bg-emerald-50 hover:text-emerald-700"
              }`}
            >
              {menuAberto ? (
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M6 6L18 18" />
                  <path d="M18 6L6 18" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M4 7H20" />
                  <path d="M4 12H20" />
                  <path d="M4 17H20" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {buscaAberta && (
          <div
            id="pesquisa-mobile"
            className="border-t border-slate-100 pb-3 pt-3 md:hidden"
          >
            <form action="/" method="GET" className="relative">
              <label htmlFor="busca-mobile" className="sr-only">
                Pesquisar produtos
              </label>

              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M16.5 16.5L21 21" />
              </svg>

              <input
                id="busca-mobile"
                name="q"
                type="search"
                autoComplete="off"
                autoFocus
                placeholder="Buscar produto, marca ou categoria"
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-12 pr-14 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
              />

              <button
                type="submit"
                aria-label="Pesquisar"
                className="absolute right-1 top-1 flex h-9 w-11 items-center justify-center rounded-lg bg-[#087A55] text-white transition hover:bg-[#066747]"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M16.5 16.5L21 21" />
                </svg>
              </button>
            </form>
          </div>
        )}

        {menuAberto && (
          <div
            id="menu-mobile"
            className="border-t border-slate-200 py-3 xl:hidden"
          >
            <nav className="grid gap-1.5 sm:grid-cols-2">
              {linksNavegacao.map((link) => {
                const ativo = linkEstaAtivo(link.href);

                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={fecharPaineis}
                    className={`rounded-xl px-4 py-3 text-sm font-bold transition ${
                      ativo
                        ? "bg-emerald-50 text-emerald-700"
                        : "text-slate-700 hover:bg-slate-50 hover:text-emerald-700"
                    }`}
                  >
                    {link.nome}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-3 grid gap-2 border-t border-slate-200 pt-3 sm:grid-cols-2">
              <Link
                href="/sobre"
                onClick={fecharPaineis}
                className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm font-bold text-slate-700"
              >
                Sobre o Ofertano
              </Link>

              <a
                href="https://www.instagram.com/ofertano.br/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={fecharPaineis}
                className="rounded-xl border border-pink-200 bg-pink-50 px-4 py-3 text-center text-sm font-bold text-pink-700"
              >
                Seguir no Instagram
              </a>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
