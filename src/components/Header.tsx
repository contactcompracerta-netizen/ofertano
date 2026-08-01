"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Logo from "@/components/Logo";

const linksNavegacao = [
  {
    nome: "Início",
    href: "/",
  },
  {
    nome: "Ofertas",
    href: "/ofertas",
  },
  {
    nome: "Categorias",
    href: "/categorias",
  },
  {
    nome: "Blog",
    href: "/blog",
  },
];

export default function Header() {
  const pathname = usePathname();
  const [menuAberto, setMenuAberto] = useState(false);

  function fecharMenu() {
    setMenuAberto(false);
  }

  function linkEstaAtivo(href: string) {
    if (href === "/") {
      return pathname === "/";
    }

    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-50">
      {/* Barra superior de confianÃ§a */}
      <div className="border-b border-emerald-900 bg-[#043B2C] text-white">
        <div className="mx-auto flex min-h-9 max-w-7xl items-center justify-center px-4 text-center sm:justify-between">
          <div className="flex items-center gap-2 text-[11px] font-semibold sm:text-xs">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-emerald-300"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3L4.5 6V11.5C4.5 16.2 7.7 20.4 12 21.5C16.3 20.4 19.5 16.2 19.5 11.5V6L12 3Z" />
              <path d="M8.7 12L10.8 14.1L15.5 9.4" />
            </svg>

            <span>
              Compare preÃ§os e compre diretamente em lojas parceiras.
            </span>
          </div>

          <div className="hidden items-center gap-5 text-xs font-semibold text-emerald-100 sm:flex">
            <Link
              href="/sobre"
              className="transition hover:text-white"
            >
              Sobre o Ofertano
            </Link>

            <Link
              href="/seguranca"
              className="transition hover:text-white"
            >
              Compra segura
            </Link>
          </div>
        </div>
      </div>

      {/* CabeÃ§alho principal */}
      <div className="border-b border-slate-200/80 bg-white/95 shadow-[0_10px_35px_rgba(15,23,42,0.05)] backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex min-h-[76px] items-center gap-4 lg:gap-6">
            <div
              className="shrink-0"
              onClick={fecharMenu}
            >
              <Logo />
            </div>

            {/* Busca desktop */}
            <form
              action="/"
              method="GET"
              className="relative hidden min-w-0 flex-1 md:block"
            >
              <label
                htmlFor="busca-header"
                className="sr-only"
              >
                Pesquisar produtos
              </label>

              <div className="group relative">
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 transition group-focus-within:text-emerald-600"
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
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-12 pr-28 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
                />

                <button
                  type="submit"
                  className="absolute right-1.5 top-1.5 h-9 rounded-xl bg-[#087A55] px-5 text-sm font-extrabold text-white transition hover:bg-[#066747] active:scale-[0.98]"
                >
                  Buscar
                </button>
              </div>
            </form>

            {/* NavegaÃ§Ã£o desktop */}
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

            {/* Instagram desktop */}
            <a
              href="https://www.instagram.com/ofertano.br/"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-extrabold text-slate-700 transition hover:border-pink-200 hover:bg-pink-50 hover:text-pink-700 lg:flex"
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
                <rect
                  x="3"
                  y="3"
                  width="18"
                  height="18"
                  rx="5"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="4"
                />
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

            {/* BotÃ£o do menu mobile */}
            <button
              type="button"
              onClick={() => setMenuAberto((estadoAtual) => !estadoAtual)}
              aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
              aria-expanded={menuAberto}
              aria-controls="menu-mobile"
              className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-800 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 xl:hidden"
            >
              {menuAberto ? (
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-6 w-6"
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

          {/* Busca mobile */}
          <form
            action="/"
            method="GET"
            className="pb-4 md:hidden"
          >
            <label
              htmlFor="busca-mobile"
              className="sr-only"
            >
              Pesquisar produtos
            </label>

            <div className="relative">
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
                placeholder="O que vocÃª estÃ¡ procurando?"
                className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-12 pr-20 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
              />

              <button
                type="submit"
                aria-label="Pesquisar"
                className="absolute right-1.5 top-1.5 flex h-9 w-12 items-center justify-center rounded-xl bg-[#087A55] text-white transition hover:bg-[#066747]"
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
            </div>
          </form>

          {/* Menu mobile e tablet */}
          {menuAberto && (
            <div
              id="menu-mobile"
              className="border-t border-slate-200 py-4 xl:hidden"
            >
              <nav className="grid gap-2 sm:grid-cols-2">
                {linksNavegacao.map((link) => {
                  const ativo = linkEstaAtivo(link.href);

                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      onClick={fecharMenu}
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

              <div className="mt-4 grid gap-2 border-t border-slate-200 pt-4 sm:grid-cols-2">
                <Link
                  href="/sobre"
                  onClick={fecharMenu}
                  className="rounded-xl bg-slate-50 px-4 py-3 text-center text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                >
                  Sobre o Ofertano
                </Link>

                <a
                  href="https://www.instagram.com/ofertano.br/"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={fecharMenu}
                  className="rounded-xl border border-pink-200 bg-pink-50 px-4 py-3 text-center text-sm font-bold text-pink-700 transition hover:bg-pink-100"
                >
                  Seguir no Instagram
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

