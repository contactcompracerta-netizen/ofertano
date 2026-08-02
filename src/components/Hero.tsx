export default function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-slate-200 bg-[#F7FAF9]">
      <div className="pointer-events-none absolute -left-24 top-0 h-64 w-64 rounded-full bg-emerald-200/35 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 top-0 h-72 w-72 rounded-full bg-teal-200/35 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 py-7 sm:px-6 sm:py-10 lg:grid lg:grid-cols-[1fr_430px] lg:items-center lg:gap-12 lg:py-12">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/80 px-3 py-1.5 shadow-sm backdrop-blur">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
            </span>

            <span className="text-[10px] font-extrabold uppercase tracking-[0.11em] text-emerald-800 sm:text-xs">
              Inteligência para comprar melhor
            </span>
          </div>

          <h1 className="mt-4 text-3xl font-black leading-[1.02] tracking-[-0.04em] text-slate-950 sm:text-5xl lg:text-6xl">
            Compare antes.
            <span className="block bg-gradient-to-r from-emerald-700 via-emerald-600 to-teal-500 bg-clip-text text-transparent">
              Economize melhor.
            </span>
          </h1>

          <p className="mt-4 max-w-xl text-sm leading-6 text-slate-600 sm:text-base sm:leading-7 lg:text-lg lg:leading-8">
            Pesquise produtos, encontre ofertas e descubra onde comprar com
            mais segurança.
          </p>
        </div>

        <div className="relative hidden lg:block">
          <div className="absolute -inset-3 rounded-[30px] bg-gradient-to-br from-emerald-300/45 via-teal-200/25 to-transparent blur-2xl" />

          <div className="relative overflow-hidden rounded-[26px] border border-white/80 bg-white/85 p-5 shadow-[0_25px_70px_rgba(15,23,42,0.14)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">
                  Comparador Ofertano
                </p>

                <p className="mt-1 text-xs font-semibold text-slate-500">
                  Exemplo de comparação
                </p>
              </div>

              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-black text-emerald-700">
                Horizon
              </span>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                  <svg
                    viewBox="0 0 64 48"
                    aria-hidden="true"
                    className="h-10 w-14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="4" y="4" width="56" height="35" rx="4" />
                    <path d="M24 44H40" />
                    <path d="M32 39V44" />
                    <path d="M10 10H54V33H10Z" />
                  </svg>
                </div>

                <div className="min-w-0">
                  <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-600">
                    Exemplo
                  </span>

                  <h2 className="mt-1.5 line-clamp-2 text-sm font-black leading-5 text-slate-950">
                    Smart TV 50″ 4K com tecnologia inteligente
                  </h2>

                  <div className="mt-1 flex items-center gap-1 text-[11px] font-bold text-amber-500">
                    <span>★★★★★</span>
                    <span className="text-slate-500">4,8</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-xl border-2 border-emerald-500 bg-emerald-50/70 p-3.5">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-bold text-slate-500">
                      Mercado Livre
                    </p>

                    <p className="mt-1 text-xl font-black tracking-tight text-slate-950">
                      R$ 1.899
                    </p>

                    <p className="mt-1 text-[11px] font-semibold text-emerald-700">
                      Melhor preço encontrado
                    </p>
                  </div>

                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
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
                  </div>
                </div>
              </div>

              <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-black text-slate-700">Amazon</p>
                  <p className="mt-0.5 text-[10px] font-semibold text-slate-400">
                    Em breve
                  </p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-black text-slate-700">Shopee</p>
                  <p className="mt-0.5 text-[10px] font-semibold text-slate-400">
                    Em breve
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
