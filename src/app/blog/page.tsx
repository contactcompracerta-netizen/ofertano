import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function BlogPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <Header />

      <section className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16">
          <p className="text-sm font-black uppercase tracking-widest text-green-700">
            Conteúdo Ofertano
          </p>

          <h1 className="mt-3 text-4xl font-black tracking-tight text-gray-900 sm:text-5xl">
            Blog
          </h1>

          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-600">
            Guias de compra, comparativos, dicas para economizar e informações
            para ajudar você a escolher produtos com mais segurança.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16">
        <div className="rounded-3xl border border-gray-200 bg-white p-10 text-center shadow-sm sm:p-14">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-green-100 text-3xl">
            📝
          </div>

          <p className="mt-6 text-sm font-black uppercase tracking-widest text-green-700">
            Em preparação
          </p>

          <h2 className="mt-3 text-3xl font-black tracking-tight text-gray-900">
            Novos conteúdos serão publicados em breve
          </h2>

          <p className="mx-auto mt-4 max-w-2xl leading-7 text-gray-600">
            O blog do Ofertano terá artigos sobre produtos, comparações de
            preços, cuidados antes da compra e oportunidades encontradas nas
            lojas parceiras.
          </p>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              href="/ofertas"
              className="rounded-xl bg-green-600 px-7 py-4 font-black text-white transition hover:bg-green-700"
            >
              Ver ofertas
            </Link>

            <Link
              href="/categorias"
              className="rounded-xl border border-gray-300 bg-white px-7 py-4 font-black text-gray-800 transition hover:border-green-300 hover:bg-green-50 hover:text-green-700"
            >
              Explorar categorias
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}