import Link from "next/link";

export default function Footer() {
  return (
    <footer className="bg-gray-950 text-gray-300">
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="grid gap-10 md:grid-cols-3">
          <div>
            <Link
              href="/"
              className="text-2xl font-black tracking-tight text-white"
            >
              Ofertano
            </Link>

            <p className="mt-3 max-w-sm text-sm leading-6 text-gray-400">
              Compare preços antes de comprar e acesse as ofertas diretamente
              nas lojas parceiras.
            </p>
          </div>

          <div>
            <h2 className="font-black text-white">
              Navegação
            </h2>

            <nav className="mt-4 flex flex-col gap-3 text-sm">
              <Link
                href="/"
                className="transition hover:text-white"
              >
                Início
              </Link>

              <Link
                href="/ofertas"
                className="transition hover:text-white"
              >
                Ofertas
              </Link>

              <Link
                href="/categorias"
                className="transition hover:text-white"
              >
                Categorias
              </Link>

              <Link
                href="/blog"
                className="transition hover:text-white"
              >
                Blog
              </Link>
            </nav>
          </div>

          <div>
            <h2 className="font-black text-white">
              Institucional
            </h2>

            <nav className="mt-4 flex flex-col gap-3 text-sm">
              <Link
                href="/sobre"
                className="transition hover:text-white"
              >
                Sobre
              </Link>

              <Link
                href="/contato"
                className="transition hover:text-white"
              >
                Contato
              </Link>

              <Link
                href="/politica-de-privacidade"
                className="transition hover:text-white"
              >
                Política de privacidade
              </Link>

              <Link
                href="/termos"
                className="transition hover:text-white"
              >
                Termos de uso
              </Link>
            </nav>
          </div>
        </div>

        <div className="mt-10 border-t border-gray-800 pt-6">
          <p className="text-sm leading-6 text-gray-500">
            O Ofertano não vende produtos diretamente. Preços, disponibilidade,
            pagamento, entrega e garantia são de responsabilidade das lojas
            parceiras.
          </p>

          <p className="mt-4 text-sm text-gray-500">
            © {new Date().getFullYear()} Ofertano. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </footer>
  );
}