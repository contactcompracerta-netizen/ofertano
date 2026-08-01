import Link from "next/link";

export default function AntiFraudNotice() {
  return (
    <section className="mx-auto max-w-7xl px-4 pb-16">
      <div className="flex flex-col gap-5 rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm sm:flex-row sm:items-start">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-2xl">
          🛡️
        </div>

        <div className="flex-1">
          <p className="text-sm font-black uppercase tracking-widest text-amber-800">
            Aviso de segurança
          </p>

          <h2 className="mt-2 text-xl font-black text-gray-900">
            O Ofertano não vende produtos diretamente
          </h2>

          <p className="mt-3 max-w-4xl text-sm leading-6 text-gray-700">
            Todas as compras são realizadas exclusivamente nos sites e
            aplicativos das lojas parceiras, como Mercado Livre, Amazon e
            Shopee. O Ofertano não recebe pagamentos, não solicita transferências
            e não realiza cobranças por WhatsApp ou redes sociais.
          </p>

          <Link
            href="/seguranca"
            className="mt-4 inline-flex text-sm font-black text-amber-900 transition hover:text-amber-700"
          >
            Saiba como comprar com segurança →
          </Link>
        </div>
      </div>
    </section>
  );
}