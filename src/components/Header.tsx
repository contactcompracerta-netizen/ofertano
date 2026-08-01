"use client";

import Link from "next/link";
import { useState } from "react";
import Logo from "@/components/Logo";

export default function Header() {
  const [menuAberto, setMenuAberto] = useState(false);

  function fecharMenu() {
    setMenuAberto(false);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex min-h-20 items-center justify-between gap-4">
          <div onClick={fecharMenu}>
            <Logo />
          </div>

          <nav className="hidden items-center gap-7 lg:flex">
            <Link
              href="/"
              className="font-semibold text-green-700 transition hover:text-green-800"
            >
              Início
            </Link>

            <Link
              href="/ofertas"
              className="font-semibold text-gray-600 transition hover:text-green-700"
            >
              Ofertas
            </Link>

            <Link
              href="/categorias"
              className="font-semibold text-gray-600 transition hover:text-green-700"
            >
              Categorias
            </Link>

            <Link
              href="/blog"
              className="font-semibold text-gray-600 transition hover:text-green-700"
            >
              Blog
            </Link>
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <a
              href="https://www.instagram.com/ofertano.br/"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 transition hover:border-pink-300 hover:bg-pink-50 hover:text-pink-700"
            >
              Instagram
            </a>
          </div>

          <button
            type="button"
            onClick={() => setMenuAberto((estadoAtual) => !estadoAtual)}
            aria-label={menuAberto ? "Fechar menu" : "Abrir menu"}
            aria-expanded={menuAberto}
            aria-controls="menu-mobile"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray-200 bg-white text-gray-900 transition hover:bg-gray-100 lg:hidden"
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

        {menuAberto && (
          <div
            id="menu-mobile"
            className="border-t border-gray-200 py-4 lg:hidden"
          >
            <nav className="flex flex-col gap-2">
              <Link
                href="/"
                onClick={fecharMenu}
                className="rounded-xl bg-green-50 px-4 py-3 font-bold text-green-700"
              >
                Início
              </Link>

              <Link
                href="/ofertas"
                onClick={fecharMenu}
                className="rounded-xl px-4 py-3 font-semibold text-gray-700 transition hover:bg-gray-100 hover:text-green-700"
              >
                Ofertas
              </Link>

              <Link
                href="/categorias"
                onClick={fecharMenu}
                className="rounded-xl px-4 py-3 font-semibold text-gray-700 transition hover:bg-gray-100 hover:text-green-700"
              >
                Categorias
              </Link>

              <Link
                href="/blog"
                onClick={fecharMenu}
                className="rounded-xl px-4 py-3 font-semibold text-gray-700 transition hover:bg-gray-100 hover:text-green-700"
              >
                Blog
              </Link>
            </nav>

            <div className="mt-4 border-t border-gray-200 pt-4">
              <a
                href="https://www.instagram.com/ofertano.br/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={fecharMenu}
                className="block w-full rounded-xl border border-pink-200 bg-pink-50 px-4 py-3 text-center text-sm font-bold text-pink-700 transition hover:bg-pink-100"
              >
                Instagram
              </a>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
