import Link from "next/link";
import { sanitizeProductNameForDisplay } from "@/lib/product/productPresentation";
import {
  listarMarketplacesComparaveis,
  type PublicOfferLike,
} from "@/services/publicVisibility/multiStoreVisibility";

type OfertaCard = PublicOfferLike;

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
    offers?: OfertaCard[];
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
  const displayName = sanitizeProductNameForDisplay(produto.name);
  const lojasComparadas = listarMarketplacesComparaveis(produto.offers);
  const possuiMultiLoja = lojasComparadas.length >= 2;
  const possuiPrecoAnterior =
    produto.oldPrice !== null && produto.oldPrice > produto.price;
  const possuiDesconto = produto.discount !== null && produto.discount > 0;
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
    <article className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-[18px] border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.04)] transition duration-300 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-[0_14px_36px_rgba(5,150,105,0.10)] sm:rounded-[20px]">
      <div className="pointer-events-none absolute inset-x-5 top-0 z-20 h-px bg-gradient-to-r from-transparent via-emerald-400/80 to-transparent opacity-0 transition group-hover:opacity-100" />

      <Link
        href={`/produto/${produto.id}`}
        className="relative flex h-[112px] items-center justify-center overflow-hidden bg-gradient-to-b from-white to-slate-50/80 p-2 sm:h-[152px] sm:p-3 lg:h-[168px]"
      >
        <div className="absolute left-1.5 top-1.5 z-10 flex max-w-[88%] flex-wrap items-center gap-1 sm:left-2.5 sm:top-2.5">
          {possuiDesconto && (
            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[8px] font-black text-white shadow-sm sm:px-2.5 sm:py-1 sm:text-[10px]">
              {produto.discount}% OFF
            </span>
          )}

          {possuiMultiLoja && (
            <span className="rounded-full border border-emerald-200 bg-white/95 px-2 py-0.5 text-[8px] font-black text-emerald-700 shadow-sm backdrop-blur sm:px-2.5 sm:py-1 sm:text-[10px]">
              {lojasComparadas.length} lojas
            </span>
          )}
        </div>

        {estoqueBaixo && (
          <span className="absolute right-2 top-2 z-10 hidden rounded-full border border-orange-200 bg-orange-50 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-orange-700 lg:inline-flex">
            Últimas
          </span>
        )}

        <img
          src={produto.image}
          alt={displayName}
          loading="lazy"
          className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.035]"
        />
      </Link>

      <div className="flex flex-1 flex-col border-t border-slate-100 p-2.5 sm:p-3.5">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="truncate text-[9px] font-black uppercase tracking-[0.04em] text-emerald-700 sm:text-[11px]">
            {produto.store}
          </p>

          {produto.brand && (
            <p className="hidden max-w-20 truncate text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400 lg:block">
              {produto.brand}
            </p>
          )}
        </div>

        <Link href={`/produto/${produto.id}`} className="block">
          <h2 className="mt-1.5 line-clamp-2 min-h-[32px] text-[11px] font-extrabold leading-[1.38] tracking-[-0.01em] text-slate-950 transition group-hover:text-emerald-700 sm:min-h-[38px] sm:text-[13px]">
            {displayName}
          </h2>
        </Link>

        {(possuiAvaliacao || possuiVendas) && (
          <div className="mt-1.5 hidden min-h-4 items-center gap-2 overflow-hidden text-[10px] text-slate-500 sm:flex">
            {possuiAvaliacao && (
              <div className="flex shrink-0 items-center gap-1">
                <span aria-hidden="true" className="text-amber-500">
                  ★
                </span>
                <span className="font-black text-slate-700">
                  {produto.rating?.toFixed(1)}
                </span>
                {produto.reviews !== null &&
                  produto.reviews !== undefined &&
                  produto.reviews > 0 && (
                    <span className="hidden text-slate-400 xl:inline">
                      ({formatarQuantidade(produto.reviews)})
                    </span>
                  )}
              </div>
            )}

            {possuiVendas && (
              <span className="truncate font-medium text-slate-400">
                {formatarQuantidade(produto.sales!)} vendidos
              </span>
            )}
          </div>
        )}

        <div className="mt-auto pt-2 sm:pt-2.5">
          <div className="min-h-[13px] sm:min-h-[16px]">
            {possuiPrecoAnterior && produto.oldPrice !== null && (
              <p className="truncate text-[9px] font-semibold text-slate-400 line-through sm:text-[10px]">
                {formatarPreco(produto.oldPrice)}
              </p>
            )}
          </div>

          <div className="flex min-w-0 items-end justify-between gap-1">
            <p className="truncate text-[16px] font-black tracking-[-0.045em] text-slate-950 sm:text-[20px]">
              {formatarPreco(produto.price)}
            </p>

            {possuiMultiLoja && (
              <span className="mb-0.5 hidden shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black text-emerald-700 xl:inline-flex">
                comparar
              </span>
            )}
          </div>

          {produto.installments && (
            <p className="mt-0.5 hidden truncate text-[10px] font-semibold text-slate-500 sm:block">
              {produto.installments}
            </p>
          )}

          <Link
            href={`/produto/${produto.id}`}
            className="mt-2 flex h-8 items-center justify-center gap-1 rounded-[10px] bg-[#087A55] px-2 text-[10px] font-black text-white shadow-[0_5px_14px_rgba(8,122,85,0.16)] transition hover:bg-[#066747] focus:outline-none focus:ring-4 focus:ring-emerald-200 sm:h-9 sm:rounded-xl sm:text-[11px] lg:h-10 lg:text-xs"
          >
            <span>Ver preços</span>
            <svg
              viewBox="0 0 24 24"
              aria-hidden="true"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12H19" />
              <path d="M13 6L19 12L13 18" />
            </svg>
          </Link>
        </div>
      </div>
    </article>
  );
}
