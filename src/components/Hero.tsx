import ImageSearchButton from "@/components/ImageSearchButton";

export default function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-slate-200/80 bg-[#F7FAF9]">
      <div className="pointer-events-none absolute left-[-7rem] top-[-9rem] h-72 w-72 rounded-full bg-emerald-200/30 blur-3xl" />
      <div className="pointer-events-none absolute right-[-7rem] top-[-8rem] h-80 w-80 rounded-full bg-cyan-200/25 blur-3xl" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-300/70 to-transparent" />

      <div className="relative mx-auto grid w-full max-w-[1600px] grid-cols-1 items-center gap-5 px-3 py-4 sm:px-5 sm:py-7 md:gap-7 lg:px-8 lg:py-9">
        <div className="mx-auto w-full max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/90 bg-white/75 px-2.5 py-1 shadow-sm backdrop-blur-xl">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
            </span>
            <span className="text-[9px] font-black uppercase tracking-[0.14em] text-emerald-800 sm:text-[10px]">
              Comparação inteligente em tempo real
            </span>
          </div>

          <h1 className="mt-3 max-w-3xl text-[31px] font-black leading-[0.98] tracking-[-0.052em] text-slate-950 sm:text-[42px] md:text-[46px] lg:text-[54px] xl:text-[60px]">
            Descubra o melhor preço.
            <span className="mt-1 block bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-500 bg-clip-text text-transparent">
              Sem perder tempo.
            </span>
          </h1>

          <p className="mt-3 max-w-2xl text-[13px] leading-5 text-slate-600 sm:text-sm sm:leading-6 lg:text-base">
            O Ofertano organiza ofertas reais de diferentes lojas para você comparar com clareza e comprar direto no marketplace.
          </p>

          <form
            action="/"
            method="GET"
            className="mt-3 w-full min-w-0 max-w-2xl rounded-[14px] border border-slate-200/90 bg-white/95 p-0.5 shadow-[0_8px_24px_rgba(15,23,42,0.07)] backdrop-blur-xl sm:mt-5 sm:rounded-[16px] sm:p-1.5 sm:shadow-[0_12px_36px_rgba(15,23,42,0.08)]"
          >
            <label htmlFor="busca-hero" className="sr-only">
              Pesquisar produtos
            </label>

            <div className="flex items-center gap-1 sm:gap-2">
              <div className="relative min-w-0 flex-1">
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 sm:left-4 sm:h-5 sm:w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M16.5 16.5L21 21" />
                </svg>

                <input
                  id="busca-hero"
                  name="q"
                  type="search"
                  autoComplete="off"
                  placeholder="Produto, marca ou categoria"
                  className="h-9 w-full min-w-0 rounded-lg bg-slate-50/80 pl-9 pr-1.5 text-[11px] font-semibold text-slate-900 outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 sm:h-12 sm:rounded-xl sm:pl-12 sm:pr-4 sm:text-sm lg:h-[52px]"
                />
              </div>

              <ImageSearchButton />

              <button
                type="submit"
                className="flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg bg-[#087A55] px-2.5 text-[10px] font-black text-white shadow-[0_5px_14px_rgba(8,122,85,0.18)] transition hover:bg-[#066747] focus:outline-none focus:ring-4 focus:ring-emerald-200 sm:h-12 sm:rounded-xl sm:px-5 sm:text-sm sm:shadow-[0_8px_20px_rgba(8,122,85,0.20)] lg:h-[52px] lg:px-6"
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-4 w-4 sm:h-5 sm:w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M16.5 16.5L21 21" />
                </svg>
                <span className="sm:hidden">Comparar</span>
                <span className="hidden sm:inline">Comparar agora</span>
              </button>
            </div>
          </form>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[9px] font-bold text-slate-500 sm:text-[10px]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Ofertas reais
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Compra na loja
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Comparação transparente
            </span>
          </div>
        </div>

      </div>
    </section>
  );
}
