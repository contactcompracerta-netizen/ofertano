import Link from "next/link";

type HeroProps = {
  busca: string;
};

export default function Hero({ busca }: HeroProps) {
  return (
    <section className="relative overflow-hidden border-b border-slate-200 bg-[#F7FAF9]">
      {/* Elementos decorativos */}
      <div className="pointer-events-none absolute -left-32 top-8 h-80 w-80 rounded-full bg-emerald-200/40 blur-3xl" />

      <div className="pointer-events-none absolute -right-32 top-0 h-96 w-96 rounded-full bg-teal-200/40 blur-3xl" />

      <div className="pointer-events-none absolute bottom-0 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-green-100/60 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 py-14 sm:py-16 lg:py-20">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Conteúdo principal */}
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-4 py-2 shadow-sm backdrop-blur">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />

                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
              </span>

              <span className="text-xs font-extrabold uppercase tracking-[0.12em] text-emerald-800 sm:text-sm">
                Inteligência para comprar melhor
              </span>
            </div>

            <h1 className="mt-7 max-w-3xl text-4xl font-black leading-[1.05] tracking-[-0.04em] text-slate-950 sm:text-5xl lg:text-6xl xl:text-7xl">
              Compare antes.
              <span className="block bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-500 bg-clip-text text-transparent">
                Economize melhor.
              </span>
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">
              Pesquise produtos, encontre ofertas e descubra onde comprar com
              mais segurança. O Ofertano organiza as informações para facilitar
              sua decisão.
            </p>

            {/* Busca principal */}
            <form
              action="/"
              method="GET"
              className="mt-8 max-w-2xl rounded-[22px] border border-slate-200 bg-white p-2 shadow-[0_24px_70px_rgba(15,23,42,0.12)]"
            >
              <label
                htmlFor="busca-hero"
                className="sr-only"
              >
                Pesquisar produtos
              </label>

              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <circle
                      cx="11"
                      cy="11"
                      r="7"
                    />

                    <path d="M16.5 16.5L21 21" />
                  </svg>

                  <input
                    id="busca-hero"
                    name="q"
                    type="search"
                    defaultValue={busca}
                    autoComplete="off"
                    placeholder="Ex.: Smart TV, celular ou ferramenta"
                    className="h-14 w-full rounded-2xl bg-slate-50 pl-12 pr-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:font-medium placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-emerald-500/10 sm:text-base"
                  />
                </div>

                <button
                  type="submit"
                  className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#087A55] px-7 text-sm font-black text-white shadow-lg shadow-emerald-800/20 transition hover:-translate-y-0.5 hover:bg-[#066747] hover:shadow-xl active:translate-y-0 sm:text-base"
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
                    <circle
                      cx="11"
                      cy="11"
                      r="7"
                    />

                    <path d="M16.5 16.5L21 21" />
                  </svg>

                  Comparar agora
                </button>
              </div>
            </form>

            {/* Buscas populares */}
            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
              <span className="font-semibold text-slate-500">
                Buscas populares:
              </span>

              <Link
                href="/?q=notebook"
                className="rounded-full bg-white px-3 py-1.5 font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:text-emerald-700 hover:ring-emerald-200"
              >
                Notebook
              </Link>

              <Link
                href="/?q=celular"
                className="rounded-full bg-white px-3 py-1.5 font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:text-emerald-700 hover:ring-emerald-200"
              >
                Celular
              </Link>

              <Link
                href="/?q=televisão"
                className="rounded-full bg-white px-3 py-1.5 font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:text-emerald-700 hover:ring-emerald-200"
              >
                Televisão
              </Link>

              <Link
                href="/?q=air fryer"
                className="rounded-full bg-white px-3 py-1.5 font-bold text-slate-700 shadow-sm ring-1 ring-slate-200 transition hover:text-emerald-700 hover:ring-emerald-200"
              >
                Air Fryer
              </Link>
            </div>

            {/* Botões secundários */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/ofertas"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-6 text-sm font-extrabold text-white transition hover:-translate-y-0.5 hover:bg-slate-800"
              >
                Ver melhores ofertas

                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12H19" />
                  <path d="M13 6L19 12L13 18" />
                </svg>
              </Link>

              <Link
                href="/categorias"
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white/70 px-6 text-sm font-extrabold text-slate-700 backdrop-blur transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-white hover:text-emerald-700"
              >
                Explorar categorias
              </Link>
            </div>

            {/* Indicadores de confiança */}
            <div className="mt-10 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/70 p-3 backdrop-blur">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
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
                    <path d="M4 18L9 13L13 16L20 8" />
                    <path d="M15 8H20V13" />
                  </svg>
                </div>

                <div>
                  <p className="text-sm font-black text-slate-900">
                    Compare
                  </p>

                  <p className="text-xs font-medium text-slate-500">
                    Informações organizadas
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/70 p-3 backdrop-blur">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
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
                    <path d="M12 3L4.5 6V11.5C4.5 16.2 7.7 20.4 12 21.5C16.3 20.4 19.5 16.2 19.5 11.5V6L12 3Z" />
                    <path d="M8.7 12L10.8 14.1L15.5 9.4" />
                  </svg>
                </div>

                <div>
                  <p className="text-sm font-black text-slate-900">
                    Compre seguro
                  </p>

                  <p className="text-xs font-medium text-slate-500">
                    Dentro da loja parceira
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/70 p-3 backdrop-blur">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
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
                    <path d="M12 2V22" />
                    <path d="M17 6.5C17 4.6 15.2 3 12.5 3H10.8C8.7 3 7 4.4 7 6.2C7 8 8.4 9.1 10.5 9.7L13.6 10.6C15.7 11.2 17 12.4 17 14.3C17 16.4 15.1 18 12.4 18H10.6C8 18 6 16.5 6 14.5" />
                  </svg>
                </div>

                <div>
                  <p className="text-sm font-black text-slate-900">
                    Use grátis
                  </p>

                  <p className="text-xs font-medium text-slate-500">
                    Sem cobrança para comparar
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Demonstração visual do comparador */}
          <div className="relative mx-auto w-full max-w-[540px] lg:mx-0 lg:ml-auto">
            <div className="absolute -inset-3 rounded-[36px] bg-gradient-to-br from-emerald-300/50 via-teal-200/30 to-transparent blur-2xl" />

            <div className="relative overflow-hidden rounded-[30px] border border-white/80 bg-white/80 p-4 shadow-[0_35px_100px_rgba(15,23,42,0.18)] backdrop-blur-xl sm:p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-700">
                    Visão do comparador
                  </p>

                  <p className="mt-1 text-sm font-semibold text-slate-500">
                    Demonstração visual
                  </p>
                </div>

                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">
                  Ofertano Horizon
                </span>
              </div>

              {/* Produto */}
              <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-20 w-24 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 text-slate-700">
                    <svg
                      viewBox="0 0 64 48"
                      aria-hidden="true"
                      className="h-12 w-16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect
                        x="4"
                        y="4"
                        width="56"
                        height="35"
                        rx="4"
                      />

                      <path d="M24 44H40" />
                      <path d="M32 39V44" />
                      <path d="M10 10H54V33H10Z" />
                    </svg>
                  </div>

                  <div className="min-w-0">
                    <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-600">
                      Exemplo
                    </span>

                    <h2 className="mt-2 line-clamp-2 text-base font-black leading-5 text-slate-950 sm:text-lg">
                      Smart TV 50″ 4K com tecnologia inteligente
                    </h2>

                    <div className="mt-2 flex items-center gap-1 text-xs font-bold text-amber-500">
                      <span>★</span>
                      <span>★</span>
                      <span>★</span>
                      <span>★</span>
                      <span>★</span>

                      <span className="ml-1 text-slate-500">
                        4,8
                      </span>
                    </div>
                  </div>
                </div>

                {/* Comparação */}
                <div className="mt-5 space-y-3">
                  <div className="relative overflow-hidden rounded-2xl border-2 border-emerald-500 bg-emerald-50/70 p-4">
                    <div className="absolute right-0 top-0 rounded-bl-xl bg-emerald-600 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-white">
                      Melhor preço
                    </div>

                    <div className="flex items-end justify-between gap-4 pt-2">
                      <div>
                        <p className="text-xs font-bold text-slate-500">
                          Mercado Livre
                        </p>

                        <p className="mt-1 text-2xl font-black tracking-tight text-slate-950">
                          R$ 1.899
                        </p>

                        <p className="mt-1 text-xs font-semibold text-emerald-700">
                          Compra na loja parceira
                        </p>
                      </div>

                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white">
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          className="h-5 w-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12H19" />
                          <path d="M13 6L19 12L13 18" />
                        </svg>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div>
                      <p className="text-sm font-black text-slate-700">
                        Amazon
                      </p>

                      <p className="mt-1 text-xs font-semibold text-slate-400">
                        Integração planejada
                      </p>
                    </div>

                    <span className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-500 ring-1 ring-slate-200">
                      Em breve
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div>
                      <p className="text-sm font-black text-slate-700">
                        Shopee
                      </p>

                      <p className="mt-1 text-xs font-semibold text-slate-400">
                        Integração planejada
                      </p>
                    </div>

                    <span className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-500 ring-1 ring-slate-200">
                      Em breve
                    </span>
                  </div>
                </div>
              </div>

              {/* Evolução futura */}
              <div className="mt-4 flex gap-3 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-teal-50 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm">
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
                    <path d="M12 3L13.6 8.4L19 10L13.6 11.6L12 17L10.4 11.6L5 10L10.4 8.4L12 3Z" />
                    <path d="M18.5 15L19.3 17.7L22 18.5L19.3 19.3L18.5 22L17.7 19.3L15 18.5L17.7 17.7L18.5 15Z" />
                  </svg>
                </div>

                <div>
                  <p className="text-sm font-black text-emerald-950">
                    Plataforma preparada para evoluir
                  </p>

                  <p className="mt-1 text-xs leading-5 text-emerald-800">
                    Histórico de preços, alertas e recomendações inteligentes
                    poderão ser adicionados sem reconstruir a Home.
                  </p>
                </div>
              </div>
            </div>

            {/* Card flutuante */}
            <div className="absolute -bottom-5 -left-3 hidden items-center gap-3 rounded-2xl border border-white bg-white/95 p-3 shadow-xl backdrop-blur sm:flex lg:-left-8">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12L10 17L20 7" />
                </svg>
              </div>

              <div>
                <p className="text-xs font-black text-slate-900">
                  Comparação clara
                </p>

                <p className="text-[11px] font-semibold text-slate-500">
                  Sem esconder a loja
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}