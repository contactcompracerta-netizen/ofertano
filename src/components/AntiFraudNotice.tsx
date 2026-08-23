import Link from "next/link";

export default function AntiFraudNotice() {
  return (
    <section className="mx-auto max-w-7xl px-4 pb-8 md:pb-16">
      <div className="flex flex-col gap-3 rounded-[22px] border border-amber-200 bg-amber-50 p-5 shadow-sm md:flex-row md:items-start md:gap-5 md:rounded-3xl md:p-6">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-xl md:h-12 md:w-12 md:rounded-2xl md:text-2xl">
          🛡️
        </div>

        <div className="flex-1">
          <p className="text-xs font-black uppercase tracking-widest text-amber-800 md:text-sm">
            Aviso de segurança
          </p>

          <h2 className="mt-1.5 text-lg font-black leading-tight text-gray-900 md:mt-2 md:text-xl">
            O Ofertano não vende produtos diretamente
          </h2>

          <p className="mt-2 max-w-4xl text-sm leading-5 text-gray-700 md:mt-3 md:leading-6">
            Todas as compras são realizadas exclusivamente nos sites e
            aplicativos das lojas parceiras, como Mercado Livre, Amazon e
            Shopee. O Ofertano não recebe pagamentos, não solicita transferências
            e não realiza cobranças por WhatsApp ou redes sociais.
          </p>

          <Link
            href="/seguranca"
            className="mt-3 inline-flex text-sm font-black text-amber-900 transition hover:text-amber-700 md:mt-4"
          >
            Saiba como comprar com segurança →
          </Link>
        </div>
      </div>
    </section>
  );
}
