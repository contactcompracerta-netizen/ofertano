import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function SobrePage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <Header />

      <section className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <p className="text-sm font-black uppercase tracking-widest text-green-700">
            Sobre o Ofertano
          </p>

          <h1 className="mt-3 max-w-4xl text-4xl font-black tracking-tight text-gray-900 sm:text-5xl">
            Compare preços antes de comprar
          </h1>

          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-600">
            O Ofertano reúne produtos e ofertas de lojas parceiras para ajudar
            você a pesquisar preços, comparar condições e tomar decisões de
            compra com mais informação.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-6 md:grid-cols-3">
          <article className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-100 text-2xl">
              🔎
            </div>

            <h2 className="mt-5 text-xl font-black text-gray-900">
              Pesquisa simplificada
            </h2>

            <p className="mt-3 leading-7 text-gray-600">
              Organizamos produtos e informações para facilitar a busca por
              ofertas relevantes.
            </p>
          </article>

          <article className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-2xl">
              📊
            </div>

            <h2 className="mt-5 text-xl font-black text-gray-900">
              Comparação de ofertas
            </h2>

            <p className="mt-3 leading-7 text-gray-600">
              O objetivo é apresentar preços e condições de diferentes
              marketplaces em um só lugar.
            </p>
          </article>

          <article className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-2xl">
              🛡️
            </div>

            <h2 className="mt-5 text-xl font-black text-gray-900">
              Compra nas lojas parceiras
            </h2>

            <p className="mt-3 leading-7 text-gray-600">
              O pagamento e a entrega são realizados diretamente pelo
              marketplace responsável pela oferta.
            </p>
          </article>
        </div>

        <div className="mt-10 rounded-3xl border border-gray-200 bg-white p-8 shadow-sm sm:p-10">
          <h2 className="text-3xl font-black tracking-tight text-gray-900">
            O que o Ofertano faz
          </h2>

          <div className="mt-6 space-y-4 text-base leading-7 text-gray-600">
            <p>
              O Ofertano funciona como uma plataforma de descoberta e comparação
              de ofertas. Os produtos exibidos podem estar disponíveis em lojas
              como Mercado Livre, Amazon, Shopee e outros parceiros.
            </p>

            <p>
              Ao escolher uma oferta, o usuário é direcionado para o site ou
              aplicativo da loja correspondente, onde poderá conferir preço,
              estoque, parcelamento, entrega, garantia e demais condições.
            </p>

            <p>
              O Ofertano não fabrica, armazena, vende ou entrega produtos e não
              recebe pagamentos referentes às compras realizadas nas lojas
              parceiras.
            </p>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/ofertas"
            className="rounded-xl bg-green-600 px-7 py-4 text-center font-black text-white transition hover:bg-green-700"
          >
            Ver ofertas
          </Link>

          <Link
            href="/seguranca"
            className="rounded-xl border border-gray-300 bg-white px-7 py-4 text-center font-black text-gray-800 transition hover:border-green-300 hover:bg-green-50 hover:text-green-700"
          >
            Comprar com segurança
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}