import Link from "next/link";
import ProductCard from "@/components/ProductCard";

type Produto = {
  id: string;
  name: string;
  image: string;
  price: number;
  oldPrice: number | null;
  discount: number | null;
  store: string;
};

type OffersSectionProps = {
  produtos: Produto[];
  busca: string;
};

export default function OffersSection({
  produtos,
  busca,
}: OffersSectionProps) {
  const possuiBusca = busca.length > 0;

  return (
    <section
      id="ofertas"
      className="mx-auto max-w-7xl scroll-mt-24 px-4 py-16"
    >
      <div className="mb-10 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <span className="text-sm font-black uppercase tracking-widest text-green-700">
            {possuiBusca
              ? "Resultado da pesquisa"
              : "Produtos selecionados"}
          </span>

          <h2 className="mt-2 text-3xl font-black tracking-tight text-gray-900 sm:text-4xl">
            {possuiBusca
              ? `Resultados para “${busca}”`
              : "Ofertas recentes"}
          </h2>

          <p className="mt-3 max-w-2xl text-gray-600">
            {possuiBusca
              ? `${produtos.length} produto${
                  produtos.length === 1 ? "" : "s"
                } encontrado${produtos.length === 1 ? "" : "s"}.`
              : "Confira os últimos produtos adicionados ao Ofertano."}
          </p>
        </div>

        {possuiBusca ? (
          <Link
            href="/"
            className="font-bold text-green-700 transition hover:text-green-900"
          >
            Limpar pesquisa
          </Link>
        ) : (
          produtos.length > 0 && (
            <Link
              href="/ofertas"
              className="font-bold text-green-700 transition hover:text-green-900"
            >
              Ver todas as ofertas →
            </Link>
          )
        )}
      </div>

      {produtos.length === 0 ? (
        <div className="rounded-3xl border border-gray-200 bg-white p-12 text-center shadow-sm">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-2xl">
            🔍
          </div>

          <h3 className="mt-6 text-2xl font-black text-gray-900">
            {possuiBusca
              ? "Nenhum produto encontrado"
              : "Nenhum produto cadastrado"}
          </h3>

          <p className="mx-auto mt-3 max-w-lg text-gray-600">
            {possuiBusca
              ? `Não encontramos produtos relacionados a “${busca}”. Tente pesquisar usando outro termo.`
              : "Importe o primeiro produto pelo painel administrativo para começar a exibir ofertas."}
          </p>

          {possuiBusca ? (
            <Link
              href="/"
              className="mt-7 inline-flex rounded-xl bg-green-600 px-7 py-4 font-black text-white transition hover:bg-green-700"
            >
              Ver todas as ofertas
            </Link>
          ) : (
            <Link
              href="/admin"
              className="mt-7 inline-flex rounded-xl bg-green-600 px-7 py-4 font-black text-white transition hover:bg-green-700"
            >
              Cadastrar produto
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {produtos.map((produto) => (
            <ProductCard
              key={produto.id}
              produto={produto}
            />
          ))}
        </div>
      )}
    </section>
  );
}