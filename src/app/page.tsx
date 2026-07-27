import Link from "next/link";
import prisma from "@/lib/prisma";

function formatarPreco(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export default async function HomePage() {
  const produtos = await prisma.product.findMany({
    where: {
      active: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <main className="min-h-screen bg-gray-100">
      <section className="bg-green-700 px-4 py-16 text-white">
        <div className="mx-auto max-w-7xl">
          <p className="font-semibold text-green-100">
            Ofertas selecionadas
          </p>

          <h1 className="mt-3 max-w-3xl text-4xl font-black md:text-6xl">
            Encontre produtos com bons preços em um só lugar
          </h1>

          <p className="mt-5 max-w-2xl text-lg text-green-100">
            Compare ofertas e compre diretamente nas lojas parceiras.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-black text-gray-900">
              Ofertas recentes
            </h2>

            <p className="mt-2 text-gray-600">
              Produtos cadastrados no Compra Certa.
            </p>
          </div>

          <Link
            href="/admin"
            className="rounded-xl bg-gray-900 px-5 py-3 font-bold text-white hover:bg-gray-700"
          >
            Painel administrativo
          </Link>
        </div>

        {produtos.length === 0 ? (
          <div className="rounded-2xl bg-white p-10 text-center shadow-sm">
            <h3 className="text-xl font-bold text-gray-900">
              Nenhum produto cadastrado
            </h3>

            <p className="mt-2 text-gray-600">
              Importe o primeiro produto pelo painel administrativo.
            </p>

            <Link
              href="/admin"
              className="mt-6 inline-block rounded-xl bg-green-600 px-6 py-3 font-bold text-white hover:bg-green-700"
            >
              Cadastrar produto
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {produtos.map((produto) => (
              <article
                key={produto.id}
                className="group overflow-hidden rounded-2xl bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl"
              >
                <Link href={`/produto/${produto.id}`}>
                  <div className="relative flex h-64 items-center justify-center bg-white p-6">
                    {produto.discount !== null &&
                      produto.discount > 0 && (
                        <span className="absolute left-4 top-4 rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">
                          {produto.discount}% OFF
                        </span>
                      )}

                    <img
                      src={produto.image}
                      alt={produto.name}
                      className="h-full w-full object-contain transition group-hover:scale-105"
                    />
                  </div>
                </Link>

                <div className="p-5">
                  <p className="text-sm font-semibold text-green-700">
                    {produto.store}
                  </p>

                  <Link href={`/produto/${produto.id}`}>
                    <h3 className="mt-2 line-clamp-2 min-h-12 font-bold text-gray-900 hover:text-green-700">
                      {produto.name}
                    </h3>
                  </Link>

                  {produto.oldPrice !== null && (
                    <p className="mt-4 text-sm text-gray-400 line-through">
                      {formatarPreco(produto.oldPrice)}
                    </p>
                  )}

                  <p className="text-2xl font-black text-green-700">
                    {formatarPreco(produto.price)}
                  </p>

                  <Link
                    href={`/produto/${produto.id}`}
                    className="mt-5 block rounded-xl bg-green-600 py-3 text-center font-bold text-white hover:bg-green-700"
                  >
                    Ver oferta
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}