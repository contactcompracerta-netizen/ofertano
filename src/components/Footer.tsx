import Link from "next/link";

const linkClassName =
  "inline-flex min-h-10 items-center text-[14px] text-slate-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 md:min-h-0 md:py-1";

export default function Footer() {
  return (
    <footer className="bg-slate-950 text-slate-300">
      <div className="ofertano-container pt-9 pb-7 lg:pt-10 lg:pb-8">
        <div className="grid gap-8 md:grid-cols-3 md:items-start md:gap-10">
          <div>
            <Link
              href="/"
              className="text-[1.375rem] font-black tracking-tight text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              Ofertano
            </Link>

            <p className="mt-2.5 max-w-sm text-[14px] leading-6 text-slate-400">
              Compare preços antes de comprar e acesse as
              ofertas diretamente nas lojas parceiras.
            </p>
          </div>

          <div>
            <p className="text-[15px] font-bold text-white">
              Navegação
            </p>

            <nav
              aria-label="Navegação do rodapé"
              className="mt-3 flex flex-col"
            >
              <Link href="/" className={linkClassName}>
                Início
              </Link>
              <Link href="/ofertas" className={linkClassName}>
                Ofertas
              </Link>
              <Link
                href="/categorias"
                className={linkClassName}
              >
                Categorias
              </Link>
              <Link href="/blog" className={linkClassName}>
                Blog
              </Link>
            </nav>
          </div>

          <div>
            <p className="text-[15px] font-bold text-white">
              Institucional
            </p>

            <nav
              aria-label="Institucional"
              className="mt-3 flex flex-col"
            >
              <Link href="/sobre" className={linkClassName}>
                Sobre
              </Link>
              <Link href="/contato" className={linkClassName}>
                Contato
              </Link>
              <Link
                href="/politica-de-privacidade"
                className={linkClassName}
              >
                Política de privacidade
              </Link>
              <Link href="/termos" className={linkClassName}>
                Termos de uso
              </Link>
            </nav>
          </div>
        </div>

        <div className="mt-7 border-t border-white/10 pt-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <p className="max-w-2xl text-[13px] leading-5 text-slate-500">
              O Ofertano não vende produtos diretamente.
              Preços, disponibilidade, pagamento, entrega e
              garantia são de responsabilidade das lojas
              parceiras.
            </p>

            <p className="shrink-0 text-[13px] text-slate-500">
              © {new Date().getFullYear()} Ofertano. Todos os
              direitos reservados.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
