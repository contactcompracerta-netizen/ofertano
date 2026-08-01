import Link from "next/link";

type ProductCardProps = {
  produto: {
    id: string;
    name: string;
    image: string;
    price: number;
    oldPrice: number | null;
    discount: number | null;
    store: string;
    brand?: string | null;
    installments?: string | null;
    rating?: number | null;
    reviews?: number | null;
    sales?: number | null;
    stock?: number | null;
    featured?: boolean;
  };
};

function formatarPreco(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatarQuantidade(valor: number) {
  return new Intl.NumberFormat("pt-BR").format(valor);
}

export default function ProductCard({ produto }: ProductCardProps) {
  const possuiPrecoAnterior =
    produto.oldPrice !== null && produto.oldPrice > produto.price;

  const possuiDesconto =
    produto.discount !== null && produto.discount > 0;

  const possuiAvaliacao =
    produto.rating !== null &&
    produto.rating !== undefined &&
    produto.rating > 0;

  const possuiVendas =
    produto.sales !== null &&
    produto.sales !== undefined &&
    produto.sales > 0;

  const estoqueBaixo =
    produto.stock !== null &&
    produto.stock !== undefined &&
    produto.stock > 0 &&
    produto.stock <= 5;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:border-green-200 hover:shadow-xl">
      <Link
        href={`/produto/${produto.id}`}
        className="relative flex h-64 items-center justify-center overflow-hidden bg-white p-7"
      >
        <div className="absolute left-4 top-4 z-10 flex flex-col items-start gap-2">
          {possuiDesconto && (
            <span className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-black text-white shadow">
              {produto.discount}% OFF
            </span>
          )}

          {produto.featured && (
            <span className="rounded-full bg-amber-400 px-3 py-1.5 text-xs font-black text-amber-950 shadow">
              Destaque
            </span>
          )}
        </div>

        {estoqueBaixo && (
          <span className="absolute right-4 top-4 z-10 rounded-full bg-orange-100 px-3 py-1.5 text-xs font-black text-orange-700">
            Últimas unidades
          </span>
        )}

        <img
          src={produto.image}
          alt={produto.name}
          loading="lazy"
          className="h-full w-full object-contain transition duration-300 group-hover:scale-105"
        />
      </Link>

      <div className="flex flex-1 flex-col border-t border-gray-100 p-5">
        <div className="flex min-h-6 items-center justify-between gap-3">
          <p className="truncate text-sm font-bold text-green-700">
            {produto.store}
          </p>

          {produto.brand && (
            <p className="max-w-28 truncate text-xs font-semibold uppercase tracking-wide text-gray-400">
              {produto.brand}
            </p>
          )}
        </div>

        <Link href={`/produto/${produto.id}`}>
          <h2 className="mt-2 line-clamp-2 min-h-12 font-bold leading-6 text-gray-900 transition group-hover:text-green-700">
            {produto.name}
          </h2>
        </Link>

        <div className="mt-3 flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {possuiAvaliacao && (
            <div className="flex items-center gap-1">
              <span aria-hidden="true" className="text-amber-500">
                ★
              </span>

              <span className="font-bold text-gray-800">
                {produto.rating?.toFixed(1)}
              </span>

              {produto.reviews !== null &&
                produto.reviews !== undefined &&
                produto.reviews > 0 && (
                  <span className="text-gray-500">
                    ({formatarQuantidade(produto.reviews)})
                  </span>
                )}
            </div>
          )}

          {possuiVendas && (
            <span className="text-gray-500">
              {formatarQuantidade(produto.sales!)} vendidos
            </span>
          )}
        </div>

        <div className="mt-auto pt-5">
          {possuiPrecoAnterior && produto.oldPrice !== null && (
            <p className="text-sm font-medium text-gray-400 line-through">
              {formatarPreco(produto.oldPrice)}
            </p>
          )}

          <p className="mt-1 text-2xl font-black tracking-tight text-green-700">
            {formatarPreco(produto.price)}
          </p>

          {produto.installments && (
            <p className="mt-1 line-clamp-1 text-sm font-semibold text-gray-600">
              {produto.installments}
            </p>
          )}

          <Link
            href={`/produto/${produto.id}`}
            className="mt-5 block rounded-xl bg-green-600 py-3.5 text-center font-black text-white transition hover:bg-green-700 focus:outline-none focus:ring-4 focus:ring-green-200"
          >
            Ver oferta
          </Link>

          <p className="mt-3 text-center text-xs text-gray-400">
            Compra finalizada na loja parceira
          </p>
        </div>
      </div>
    </article>
  );
}