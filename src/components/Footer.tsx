import Link from "next/link";

const desktopLinkClassName =
  "text-[12px] font-semibold text-slate-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400";

const mobileLinkClassName =
  "flex min-h-9 items-center text-[12px] font-semibold text-slate-300 transition hover:text-white";

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-white/5 bg-[#07110F] text-slate-300">
      <div className="mx-auto w-full max-w-[1600px] px-3 py-3 sm:px-5 md:px-8 md:py-7">
        <div className="md:hidden">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link
                href="/"
                className="text-base font-black tracking-[-0.03em] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                Ofertano
              </Link>
              <p className="mt-0.5 max-w-[250px] text-[10px] leading-[1.35] text-slate-400">
                Compare preços e vá direto para a melhor oferta nas lojas parceiras.
              </p>
            </div>

            <span className="mt-0.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-emerald-300">
              comparar melhor
            </span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <details className="group rounded-lg border border-white/10 bg-white/[0.035] px-2.5">
              <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between text-[10px] font-black text-white [&::-webkit-details-marker]:hidden">
                Navegação
                <span className="text-slate-500 transition group-open:rotate-45">+</span>
              </summary>
              <nav aria-label="Navegação do rodapé" className="border-t border-white/5 pb-1 pt-0.5">
                <Link href="/" className={mobileLinkClassName}>Início</Link>
                <Link href="/ofertas" className={mobileLinkClassName}>Ofertas</Link>
                <Link href="/categorias" className={mobileLinkClassName}>Categorias</Link>
                <Link href="/blog" className={mobileLinkClassName}>Blog</Link>
              </nav>
            </details>

            <details className="group rounded-lg border border-white/10 bg-white/[0.035] px-2.5">
              <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between text-[10px] font-black text-white [&::-webkit-details-marker]:hidden">
                Institucional
                <span className="text-slate-500 transition group-open:rotate-45">+</span>
              </summary>
              <nav aria-label="Institucional" className="border-t border-white/5 pb-1 pt-0.5">
                <Link href="/sobre" className={mobileLinkClassName}>Sobre</Link>
                <Link href="/contato" className={mobileLinkClassName}>Contato</Link>
                <Link href="/politica-de-privacidade" className={mobileLinkClassName}>Privacidade</Link>
                <Link href="/termos" className={mobileLinkClassName}>Termos</Link>
              </nav>
            </details>
          </div>

          <div className="mt-2 border-t border-white/10 pt-2">
            <p className="text-[9px] leading-[1.35] text-slate-500">
              O Ofertano não vende produtos diretamente. Preços, disponibilidade, pagamento, entrega e garantia são responsabilidade das lojas parceiras.
            </p>
            <p className="mt-1.5 text-[9px] font-semibold text-slate-600">
              © {new Date().getFullYear()} Ofertano. Todos os direitos reservados.
            </p>
          </div>
        </div>

        <div className="hidden md:block">
          <div className="grid grid-cols-[minmax(0,1.6fr)_0.8fr_1fr] gap-10 lg:gap-16">
            <div>
              <Link
                href="/"
                className="text-xl font-black tracking-[-0.03em] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                Ofertano
              </Link>
              <p className="mt-2 max-w-sm text-[12px] leading-5 text-slate-400">
                Compare preços antes de comprar e acesse as ofertas diretamente nas lojas parceiras.
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/[0.07] px-3 py-1.5 text-[10px] font-bold text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Comparação transparente, compra na loja
              </div>
            </div>

            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-white">Navegação</p>
              <nav aria-label="Navegação do rodapé" className="mt-3 grid gap-2.5">
                <Link href="/" className={desktopLinkClassName}>Início</Link>
                <Link href="/ofertas" className={desktopLinkClassName}>Ofertas</Link>
                <Link href="/categorias" className={desktopLinkClassName}>Categorias</Link>
                <Link href="/blog" className={desktopLinkClassName}>Blog</Link>
              </nav>
            </div>

            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.12em] text-white">Institucional</p>
              <nav aria-label="Institucional" className="mt-3 grid gap-2.5">
                <Link href="/sobre" className={desktopLinkClassName}>Sobre</Link>
                <Link href="/contato" className={desktopLinkClassName}>Contato</Link>
                <Link href="/politica-de-privacidade" className={desktopLinkClassName}>Política de privacidade</Link>
                <Link href="/termos" className={desktopLinkClassName}>Termos de uso</Link>
              </nav>
            </div>
          </div>

          <div className="mt-6 flex items-start justify-between gap-8 border-t border-white/10 pt-4">
            <p className="max-w-3xl text-[10px] leading-[1.5] text-slate-500">
              O Ofertano não vende produtos diretamente. Preços, disponibilidade, pagamento, entrega e garantia são responsabilidade das lojas parceiras.
            </p>
            <p className="shrink-0 text-[10px] font-semibold text-slate-600">
              © {new Date().getFullYear()} Ofertano
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
