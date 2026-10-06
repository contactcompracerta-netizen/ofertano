import ImageSearchButton from "@/components/ImageSearchButton";
import HeroComparison, {
  type HeroComparisonProduct,
} from "@/components/HeroComparison";

type HeroProps = {
  produtos: HeroComparisonProduct[];
};
export default function Hero({
  produtos,
}: HeroProps) {
  return (
    <section className="relative overflow-hidden border-b border-slate-200 bg-[#F7FAF9]">
      <div className="pointer-events-none absolute -left-20 top-0 h-56 w-56 rounded-full bg-emerald-200/35 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 top-0 h-64 w-64 rounded-full bg-teal-200/35 blur-3xl" />

      <div className="relative mx-auto grid w-full max-w-[1440px] items-center gap-2 px-3 py-4 sm:px-5 sm:py-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)] lg:gap-12 lg:px-8 lg:py-12 xl:gap-16">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
            </span>

            <span className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-emerald-800 sm:text-xs">
              Inteligência para comprar melhor
            </span>
          </div>

          <h1 className="mt-3 text-[30px] font-black leading-[1.02] tracking-[-0.04em] text-slate-950 sm:mt-5 sm:text-5xl lg:text-[56px] xl:text-[64px]">
            Compare antes.
            <span className="block bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-500 bg-clip-text text-transparent">
              Economize melhor.
            </span>
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 sm:mt-4 sm:text-base sm:leading-7 lg:text-lg lg:leading-8">
            Encontre ofertas e descubra onde comprar com mais segurança.
          </p>

          <form
            action="/"
            method="GET"
            className="mt-3 w-full min-w-0 max-w-2xl rounded-xl border border-slate-200 bg-white p-0.5 shadow-[0_10px_30px_rgba(15,23,42,0.09)] sm:mt-6 sm:rounded-2xl sm:p-1.5"
          >
            <label htmlFor="busca-hero" className="sr-only">
              Pesquisar produtos
            </label>

            <div className="flex gap-1.5 sm:gap-2">
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
                  className="h-8 w-full min-w-0 rounded-lg bg-slate-50 pl-8 pr-1 text-[10px] font-semibold text-slate-900 outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 sm:h-12 sm:rounded-xl sm:pl-12 sm:pr-4 sm:text-sm lg:h-14 lg:text-base"
                />
              </div>

              <ImageSearchButton />

              <button
                type="submit"
                className="flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg bg-[#087A55] px-2 text-[9px] font-black text-white shadow-md shadow-emerald-800/20 transition hover:bg-[#066747] sm:h-12 sm:gap-1.5 sm:rounded-xl sm:px-6 sm:text-sm lg:h-14 lg:px-7 lg:text-base"
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
        </div>

        <HeroComparison produtos={produtos} />

      </div>
    </section>
  );
}
