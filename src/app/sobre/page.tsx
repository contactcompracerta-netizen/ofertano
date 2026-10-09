import type { Metadata } from "next";
import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Sobre",
  description:
    "Conheça o Ofertano, a plataforma que reúne produtos e ofertas de lojas parceiras para você comparar preços antes de comprar.",
  alternates: {
    canonical: "/sobre",
  },
  openGraph: {
    type: "website",
    url: "/sobre",
    title: "Sobre | Ofertano",
    description:
      "Conheça o Ofertano, a plataforma que reúne produtos e ofertas de lojas parceiras para você comparar preços antes de comprar.",
  },
};

export default function SobrePage() {
  return (
    <main className="of-page">
      <Header />

      <section className="of-page-intro">
        <div className="of-page-intro__inner">
          <p className="of-eyebrow">
            Sobre o Ofertano
          </p>

          <h1 className="of-page-title max-w-4xl">
            Compare preços antes de comprar
          </h1>

          <p className="of-page-lead max-w-3xl">
            O Ofertano reúne produtos e ofertas de lojas parceiras para ajudar
            você a pesquisar preços, comparar condições e tomar decisões de
            compra com mais informação.
          </p>
        </div>
      </section>

      <section className="of-section">
        <div className="grid gap-3 sm:gap-4 md:grid-cols-3">
          <article className="of-card of-card-pad of-mobile-icon-card">
            <div className="of-icon-tile bg-emerald-50 text-lg">
              🔎
            </div>

            <h2 className="mt-3 of-card-title">
              Pesquisa simplificada
            </h2>

            <p className="mt-2 of-body of-card-body">
              Organizamos produtos e informações para facilitar a busca por
              ofertas relevantes.
            </p>
          </article>

          <article className="of-card of-card-pad of-mobile-icon-card">
            <div className="of-icon-tile bg-blue-50 text-lg">
              📊
            </div>

            <h2 className="mt-3 of-card-title">
              Comparação de ofertas
            </h2>

            <p className="mt-2 of-body of-card-body">
              O objetivo é apresentar preços e condições de diferentes
              marketplaces em um só lugar.
            </p>
          </article>

          <article className="of-card of-card-pad of-mobile-icon-card">
            <div className="of-icon-tile bg-amber-50 text-lg">
              🛡️
            </div>

            <h2 className="mt-3 of-card-title">
              Compra nas lojas parceiras
            </h2>

            <p className="mt-2 of-body of-card-body">
              O pagamento e a entrega são realizados diretamente pelo
              marketplace responsável pela oferta.
            </p>
          </article>
        </div>

        <div className="mt-5 of-card p-5 sm:mt-6 sm:p-6">
          <h2 className="of-section-title">
            O que o Ofertano faz
          </h2>

          <div className="mt-4 space-y-3 of-body">
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

        <div className="mt-5 flex flex-col gap-2 sm:mt-6 sm:flex-row">
          <Link
            href="/ofertas"
            className="of-control inline-flex items-center justify-center bg-[#087A55] px-5 text-sm font-black text-white transition hover:bg-[#066747]"
          >
            Ver ofertas
          </Link>

          <Link
            href="/seguranca"
            className="of-control inline-flex items-center justify-center border border-slate-300 bg-white px-5 text-sm font-black text-slate-800 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
          >
            Comprar com segurança
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}