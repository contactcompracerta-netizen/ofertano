function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="6" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10h16" />
      <path d="M5 10 6.5 5h11L19 10" />
      <path d="M6 10v9h12v-9" />
      <path d="M9 19v-5h6v5" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 5 6v5.5c0 4.2 2.8 8 7 9.5 4.2-1.5 7-5.3 7-9.5V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

const items = [
  {
    title: "Compare melhor",
    description: "Preços e condições em um só lugar.",
    icon: <SearchIcon />,
  },
  {
    title: "Compre na loja",
    description: "Checkout sempre no marketplace parceiro.",
    icon: <StoreIcon />,
  },
  {
    title: "Transparência primeiro",
    description: "Sem pagamentos ou cobranças pelo Ofertano.",
    icon: <ShieldIcon />,
  },
];

export default function Benefits() {
  return (
    <section className="mx-auto w-full max-w-[1600px] px-2.5 pb-3 pt-1 sm:px-5 sm:pb-7 lg:px-8">
      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_5px_20px_rgba(15,23,42,0.04)] sm:grid sm:grid-cols-3 sm:rounded-[18px] sm:shadow-[0_8px_30px_rgba(15,23,42,0.04)]">
        {items.map((item, index) => (
          <article
            key={item.title}
            className={`flex min-h-[46px] items-center gap-2 px-2.5 py-1.5 sm:min-h-[70px] sm:gap-3 sm:px-4 sm:py-3 lg:px-5 ${
              index > 0 ? "border-t border-slate-100 sm:border-l sm:border-t-0" : ""
            }`}
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-700 sm:h-9 sm:w-9">
              {item.icon}
            </div>

            <div className="min-w-0">
              <h2 className="text-[11px] font-black tracking-[-0.01em] text-slate-950 sm:text-[13px]">
                {item.title}
              </h2>
              <p className="mt-0.5 text-[9px] leading-[1.3] text-slate-500 sm:text-[11px] sm:leading-[1.4]">
                {item.description}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
