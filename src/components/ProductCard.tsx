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
    <article className="group relative overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)] transition duration-300 hover:-translate-y-1 hover:border-emerald-300 hover:shadow-[0_22px_55px_rgba(5,150,105,0.13)]">
      {/* Brilho futurista no hover */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-px bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent opacity-0 transition group-hover:opacity-100" />

      {/* Imagem */}
      <Link
        href={`/produto/${produto.id}`}
        className="relative flex h-52 items-center justify-center overflow-hidden bg-gradient-to-b from-white to-slate-50 p-4 sm:h-56"
      >
        <div className="absolute left-3 top-3 z-10 flex flex-col items-start gap-1.5">
          {possuiDesconto && (
            <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-black text-white shadow-lg shadow-red-600/20">
              {produto.discount}% OFF
            </span>
          )}

          {produto.featured && (
            <span className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-[11px] font-black text-amber-800">
              Destaque
            </span>
          )}
        </div>

        {estoqueBaixo && (
          <span className="absolute right-3 top-3 z-10 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-orange-700">
            Últimas unidades
          </span>
        )}

        <img
          src={produto.image}
          alt={produto.name}
          loading="lazy"
          className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.04]"
        />
      </Link>

      {/* Conteúdo */}
      <div className="border-t border-slate-100 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-xs font-black text-emerald-700 sm:text-sm">
            {produto.store}
          </p>

          {produto.brand && (
            <p className="max-w-24 truncate text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
              {produto.brand}
            </p>
          )}
        </div>

        <Link
          href={`/produto/${produto.id}`}
          className="block"
        >
          <h2 className="mt-2 line-clamp-2 min-h-11 text-sm font-extrabold leading-[1.4] text-slate-950 transition group-hover:text-emerald-700 sm:text-[15px]">
            {produto.name}
          </h2>
        </Link>

        {(possuiAvaliacao || possuiVendas) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {possuiAvaliacao && (
              <div className="flex items-center gap-1">
                <span
                  aria-hidden="true"
                  className="text-amber-500"
                >
                  ★
                </span>

                <span className="font-black text-slate-700">
                  {produto.rating?.toFixed(1)}
                </span>

                {produto.reviews !== null &&
                  produto.reviews !== undefined &&
                  produto.reviews > 0 && (
                    <span className="text-slate-400">
                      ({formatarQuantidade(produto.reviews)})
                    </span>
                  )}
              </div>
            )}

            {possuiVendas && (
              <span className="font-medium text-slate-500">
                {formatarQuantidade(produto.sales!)} vendidos
              </span>
            )}
          </div>
        )}

        {/* Preço sem mt-auto */}
        <div className="mt-3 border-t border-slate-100 pt-3">
          {possuiPrecoAnterior && produto.oldPrice !== null && (
            <p className="text-xs font-medium text-slate-400 line-through">
              {formatarPreco(produto.oldPrice)}
            </p>
          )}

          <div className="mt-0.5 flex items-end justify-between gap-2">
            <p className="text-[22px] font-black tracking-[-0.03em] text-emerald-700">
              {formatarPreco(produto.price)}
            </p>

            <span className="mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 transition group-hover:bg-emerald-600 group-hover:text-white">
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12H19" />
                <path d="M13 6L19 12L13 18" />
              </svg>
            </span>
          </div>

          {produto.installments && (
            <p className="mt-1 line-clamp-1 text-xs font-semibold text-slate-500">
              {produto.installments}
            </p>
          )}

          <Link
            href={`/produto/${produto.id}`}
            className="mt-3 flex h-11 items-center justify-center gap-2 rounded-xl bg-[#087A55] px-4 text-sm font-black text-white shadow-md shadow-emerald-900/10 transition hover:bg-[#066747] hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-emerald-200"
          >
            Comparar oferta

            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 7H17" />
              <path d="M14 4L17 7L14 10" />
              <path d="M17 17H7" />
              <path d="M10 14L7 17L10 20" />
            </svg>
          </Link>

          <div className="mt-2 flex items-center justify-center gap-1.5 text-[10px] font-semibold text-slate-400">
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3L4.5 6V11.5C4.5 16.2 7.7 20.4 12 21.5C16.3 20.4 19.5 16.2 19.5 11.5V6L12 3Z" />
              <path d="M8.7 12L10.8 14.1L15.5 9.4" />
            </svg>

            Compra finalizada na loja parceira
          </div>
        </div>
      </div>
    </article>
  );
}