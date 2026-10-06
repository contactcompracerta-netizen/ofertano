import Link from "next/link";

function ShieldIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4 sm:h-5 sm:w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3 5 6v5.5c0 4.2 2.8 8 7 9.5 4.2-1.5 7-5.3 7-9.5V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export default function AntiFraudNotice() {
  return (
    <section className="mx-auto w-full max-w-[1600px] px-2.5 pb-2 sm:px-5 sm:pb-5 lg:px-8">
      <div className="flex items-start gap-2 rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50/60 px-2.5 py-2 shadow-[0_4px_16px_rgba(120,53,15,0.04)] sm:items-center sm:gap-3 sm:rounded-[18px] sm:px-4 sm:py-3.5 sm:shadow-[0_6px_24px_rgba(120,53,15,0.04)]">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-white text-amber-700 shadow-sm sm:h-9 sm:w-9 sm:rounded-xl">
          <ShieldIcon />
        </div>

        <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-amber-700 sm:text-[10px]">
                Segurança Ofertano
              </p>
              <h2 className="text-[12px] font-black tracking-[-0.01em] text-slate-950 sm:text-sm">
                A compra sempre acontece na loja parceira.
              </h2>
            </div>

            <p className="mt-0.5 line-clamp-2 text-[10px] leading-[1.4] text-slate-600 sm:mt-1 sm:line-clamp-1 sm:text-xs">
              O Ofertano compara ofertas, mas não recebe pagamentos, transferências ou cobranças por WhatsApp e redes sociais.
            </p>
          </div>

          <Link
            href="/seguranca"
            className="mt-1 inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-white px-2 py-1 text-[9px] font-black text-amber-900 shadow-sm transition hover:border-amber-300 hover:bg-amber-100 sm:mt-0 sm:min-h-0 sm:px-3 sm:py-1.5 sm:text-[11px]"
          >
            Comprar com segurança
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
