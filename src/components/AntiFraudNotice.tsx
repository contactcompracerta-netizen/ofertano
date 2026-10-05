import Link from "next/link";

function ShieldIcon() {
  return (
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
      <path d="M12 3 5 6v5.5c0 4.2 2.8 8 7 9.5 4.2-1.5 7-5.3 7-9.5V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export default function AntiFraudNotice() {
  return (
    <section className="mx-auto w-full max-w-[1600px] px-2.5 pb-3 sm:px-5 sm:pb-5 lg:px-8">
      <div className="flex items-start gap-3 rounded-[18px] border border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50/60 px-3 py-3 shadow-[0_6px_24px_rgba(120,53,15,0.04)] sm:items-center sm:px-4 sm:py-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-white text-amber-700 shadow-sm">
          <ShieldIcon />
        </div>

        <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-amber-700 sm:text-[10px]">
                Segurança Ofertano
              </p>
              <h2 className="text-[13px] font-black tracking-[-0.01em] text-slate-950 sm:text-sm">
                A compra sempre acontece na loja parceira.
              </h2>
            </div>

            <p className="mt-1 line-clamp-2 text-[11px] leading-[1.45] text-slate-600 sm:line-clamp-1 sm:text-xs">
              O Ofertano compara ofertas, mas não recebe pagamentos, transferências ou cobranças por WhatsApp e redes sociais.
            </p>
          </div>

          <Link
            href="/seguranca"
            className="mt-2 inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-[10px] font-black text-amber-900 shadow-sm transition hover:border-amber-300 hover:bg-amber-100 sm:mt-0 sm:text-[11px]"
          >
            Comprar com segurança
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>
    </section>
  );
}
