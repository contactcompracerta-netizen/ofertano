import prisma from "@/lib/prisma";
import Header from "@/components/Header";
import ProductCard from "@/components/ProductCard";
import Footer from "@/components/Footer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OfertasPage() {
  const produtos = await prisma.product.findMany({
    where: {
      active: true,

      price: {
        gt: 0,
      },

      image: {
        not: "",
      },
    },

    orderBy: [
      {
        featured: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
  });

  return (
    <main className="min-h-screen bg-slate-50">
      <Header />

      <section className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14">
          <p className="text-sm font-black uppercase tracking-widest text-green-700">
            Catálogo Ofertano
          </p>

          <h1 className="mt-3 text-4xl font-black tracking-tight text-gray-900 sm:text-5xl">
            Todas as ofertas
          </h1>

          <p className="mt-4 max-w-2xl text-lg leading-8 text-gray-600">
            Confira todos os produtos disponíveis e acesse cada oferta
            diretamente na loja parceira.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <h2 className="text-2xl font-black text-gray-900">
              Produtos disponíveis
            </h2>

            <p className="mt-2 text-gray-600">
              {produtos.length}{" "}
              {produtos.length === 1
                ? "produto encontrado"
                : "produtos encontrados"}
              .
            </p>
          </div>
        </div>

        {produtos.length === 0 ? (
          <div className="rounded-3xl border border-gray-200 bg-white p-12 text-center shadow-sm">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-sm font-black text-green-800">
              —
            </div>

            <h2 className="mt-6 text-2xl font-black text-gray-900">
              Nenhuma oferta disponível
            </h2>

            <p className="mx-auto mt-3 max-w-lg text-gray-600">
              Ainda não existem produtos ativos disponíveis no catálogo.
            </p>
          </div>
        ) : (
          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {produtos.map((produto) => (
              <ProductCard key={produto.id} produto={produto} />
            ))}
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}