import Link from "next/link";
import SearchBar from "@/components/search/SearchBar";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b bg-white shadow-md">

      <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4">

        {/* Logo */}
        <Link href="/" className="shrink-0">

          <h1 className="text-3xl font-extrabold text-green-600">
            Ofertano
          </h1>

          <p className="text-sm text-gray-500">
            Compare preços e economize
          </p>

        </Link>

        {/* Busca */}
        <div className="flex-1">
          <SearchBar />
        </div>

        {/* Menu */}
        <nav className="hidden items-center gap-8 font-semibold text-gray-700 lg:flex">

          <Link href="/" className="transition hover:text-green-600">
            InÃ­cio
          </Link>

          <Link href="/categoria" className="transition hover:text-green-600">
            Categorias
          </Link>

          <a href="#ofertas" className="transition hover:text-green-600">
            Ofertas
          </a>

          <a href="#contato" className="transition hover:text-green-600">
            Contato
          </a>

          <Link
            href="/admin"
            className="rounded-lg bg-green-600 px-5 py-2 font-bold text-white transition hover:bg-green-700"
          >
            Admin
          </Link>

        </nav>

      </div>

    </header>
  );
}
