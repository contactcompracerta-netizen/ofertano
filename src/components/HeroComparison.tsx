import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

export type HeroComparisonOffer = {
  marketplace: string;
  price: number;
  href: string | null;
};

export type HeroComparisonProduct = {
  id: string;
  name: string;
  image: string;
  rating: number | null;
  offers: HeroComparisonOffer[];
};

type HeroComparisonProps = {
  produtos: HeroComparisonProduct[];
};

type DestinationProps = {
  href: string | null;
  productId: string;
  className: string;
  children: ReactNode;
};

const SECONDS_PER_PRODUCT = 5;

const MARKETPLACE_NAMES: Record<string, string> = {
  MERCADO_LIVRE: "Mercado Livre",
  MERCADOLIVRE: "Mercado Livre",
  AMAZON: "Amazon",
  SHOPEE: "Shopee",
  MAGALU: "Magazine Luiza",
  MAGAZINE_LUIZA: "Magazine Luiza",
  MAGAZINELUIZA: "Magazine Luiza",
  ALIEXPRESS: "AliExpress",
  ALI_EXPRESS: "AliExpress",
};

function formatMarketplace(value: string) {
  const key = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (MARKETPLACE_NAMES[key]) {
    return MARKETPLACE_NAMES[key];
  }

  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatPrice(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function ArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-3.5 w-3.5 sm:h-4 sm:w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12H19" />
      <path d="M13 6L19 12L13 18" />
    </svg>
  );
}

function Destination({
  href,
  productId,
  className,
  children,
}: DestinationProps) {
  if (
    href &&
    (href.startsWith("https://") ||
      href.startsWith("http://"))
  ) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer sponsored"
        className={className}
      >
        {children}
      </a>
    );
  }

  return (
    <Link
      href={href || `/produto/${productId}`}
      className={className}
    >
      {children}
    </Link>
  );
}

function EmptyComparison() {
  return (
    <div className="relative w-full min-w-0">
      <div className="relative overflow-hidden rounded-[20px] border border-white/80 bg-white/90 p-3 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700">
          Comparador Ofertano
        </p>

        <p className="mt-1 text-[11px] font-semibold text-slate-500">
          Comparações com ofertas reais
        </p>
      </div>
    </div>
  );
}

export default function HeroComparison({
  produtos,
}: HeroComparisonProps) {
  if (produtos.length === 0) {
    return <EmptyComparison />;
  }

  const count = produtos.length;
  const duration = count * SECONDS_PER_PRODUCT;
  const visiblePercent = 100 / count;
  const fadeStart = Math.max(
    0,
    visiblePercent - Math.min(0.8, visiblePercent / 5),
  );

  const animationCss =
    count > 1
      ? `
@keyframes ofertanoHeroSlide {
  0% {
    opacity: 1;
    visibility: visible;
  }

  ${fadeStart}% {
    opacity: 1;
    visibility: visible;
  }

  ${visiblePercent}% {
    opacity: 0;
    visibility: hidden;
  }

  100% {
    opacity: 0;
    visibility: hidden;
  }
}

@keyframes ofertanoHeroDot {
  0% {
    width: 20px;
    background: rgb(5 150 105);
  }

  ${fadeStart}% {
    width: 20px;
    background: rgb(5 150 105);
  }

  ${visiblePercent}% {
    width: 6px;
    background: rgb(203 213 225);
  }

  100% {
    width: 6px;
    background: rgb(203 213 225);
  }
}
`
      : "";

  return (
    <div className="relative w-full min-w-0 lg:mt-0">
      {count > 1 ? (
        <style>{animationCss}</style>
      ) : null}

      <div className="absolute -inset-1 rounded-[24px] bg-gradient-to-br from-emerald-300/25 via-teal-200/15 to-transparent blur-lg lg:-inset-4 lg:rounded-[34px] lg:blur-2xl" />

      <div className="relative w-full min-w-0 overflow-hidden rounded-[20px] border border-white/80 bg-white/90 p-2.5 shadow-[0_12px_32px_rgba(15,23,42,0.09)] backdrop-blur-xl sm:rounded-[24px] sm:p-4 lg:rounded-[28px] lg:bg-white/85 lg:p-5 xl:p-6">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-black uppercase tracking-[0.14em] text-emerald-700 sm:text-[11px]">
              Comparador Ofertano
            </p>

            <p className="mt-0.5 truncate text-[11px] font-semibold text-slate-500 sm:mt-1 sm:text-xs">
              Comparações com ofertas reais
            </p>
          </div>

          <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[9px] font-black text-emerald-700 sm:px-3 sm:py-1.5 sm:text-[10px]">
            Dados reais
          </span>
        </div>

        <div className="mt-2 grid min-w-0">
          {produtos.map((produto, productIndex) => {
            const melhorOferta = produto.offers[0];

            if (!melhorOferta) {
              return null;
            }

            const secundarias =
              produto.offers.slice(1, 4);

            const restantes = Math.max(
              produto.offers.length - 4,
              0,
            );

            const gridClass =
              secundarias.length >= 3
                ? "grid-cols-3"
                : secundarias.length === 2
                  ? "grid-cols-2"
                  : "grid-cols-1";

            const animationStyle: CSSProperties =
              count > 1
                ? {
                    animationName:
                      "ofertanoHeroSlide",
                    animationDuration:
                      `${duration}s`,
                    animationTimingFunction:
                      "linear",
                    animationIterationCount:
                      "infinite",
                    animationDelay:
                      `-${(count - productIndex) * SECONDS_PER_PRODUCT}s`,
                  }
                : {};

            return (
              <div
                key={produto.id}
                className="ofertano-hero-slide col-start-1 row-start-1 min-w-0"
                style={animationStyle}
              >
                <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-2 shadow-sm sm:rounded-2xl sm:p-4">
                  <Link
                    href={`/produto/${produto.id}`}
                    className="flex min-w-0 items-center gap-2"
                  >
                    <div className="flex h-11 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 p-1 sm:h-16 sm:w-20 sm:rounded-xl sm:p-1.5">
                      <img
                        src={produto.image}
                        alt={produto.name}
                        decoding="async"
                        className="h-full w-full object-contain"
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <h2 className="line-clamp-2 text-[11px] font-black leading-[1.3] text-slate-950 sm:text-sm sm:leading-5 xl:text-base">
                        {produto.name}
                      </h2>

                      <div className="mt-0.5 flex items-center gap-2 text-[10px] font-bold text-slate-500 sm:mt-1 sm:text-[11px]">
                        {produto.rating !== null &&
                        produto.rating > 0 ? (
                          <span className="text-amber-600">
                            {produto.rating.toFixed(1)}
                          </span>
                        ) : null}

                        <span>
                          {produto.offers.length}{" "}
                          {produto.offers.length === 1
                            ? "loja"
                            : "lojas"}
                        </span>
                      </div>
                    </div>
                  </Link>

                  <Destination
                    href={melhorOferta.href}
                    productId={produto.id}
                    className="mt-2 block min-w-0 rounded-lg border-2 border-emerald-500 bg-emerald-50/70 px-2 py-1.5 transition hover:border-emerald-600 hover:bg-emerald-50 sm:mt-4 sm:rounded-xl sm:p-3.5"
                  >
                    <div className="flex min-w-0 items-center gap-1.5 sm:items-end sm:justify-between sm:gap-4">
                      <p className="min-w-0 flex-1 truncate text-[9px] font-bold text-slate-500 sm:text-[11px]">
                        {formatMarketplace(
                          melhorOferta.marketplace,
                        )}
                      </p>

                      <p className="shrink-0 text-[14px] font-black tracking-tight text-slate-950 sm:text-xl xl:text-2xl">
                        {formatPrice(
                          melhorOferta.price,
                        )}
                      </p>

                      <p className="min-w-0 flex-1 truncate text-right text-[8px] font-semibold text-emerald-700 sm:mt-1 sm:text-left sm:text-[11px]">
                        <span className="sm:hidden">
                          Melhor preço
                        </span>

                        <span className="hidden sm:inline">
                          Melhor preço encontrado
                        </span>
                      </p>

                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white sm:h-9 sm:w-9 sm:rounded-lg">
                        <ArrowIcon />
                      </span>
                    </div>
                  </Destination>

                  {secundarias.length > 0 ? (
                    <div
                      className={`mt-1.5 grid min-w-0 ${gridClass} gap-1.5 sm:mt-2.5 sm:gap-2.5`}
                    >
                      {secundarias.map(
                        (oferta) => (
                          <Destination
                            key={
                              oferta.marketplace
                            }
                            href={oferta.href}
                            productId={produto.id}
                            className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-1.5 py-1.5 transition hover:border-emerald-300 hover:bg-emerald-50/50 sm:rounded-xl sm:p-3"
                          >
                            <p className="truncate text-[9px] font-black leading-3 text-slate-700 sm:text-xs">
                              {formatMarketplace(
                                oferta.marketplace,
                              )}
                            </p>

                            <p className="mt-0.5 truncate text-[11px] font-black leading-4 text-slate-950 sm:mt-1 sm:text-sm">
                              {formatPrice(
                                oferta.price,
                              )}
                            </p>
                          </Destination>
                        ),
                      )}
                    </div>
                  ) : null}

                  {restantes > 0 ? (
                    <Link
                      href={`/produto/${produto.id}`}
                      className="mt-1.5 block text-center text-[9px] font-bold text-emerald-700 hover:text-emerald-900 sm:mt-2.5 sm:text-[10px]"
                    >
                      +{restantes}{" "}
                      {restantes === 1
                        ? "outra oferta"
                        : "outras ofertas"}
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        {count > 1 ? (
          <div className="mt-1.5 flex h-2 items-center justify-center gap-1">
            {produtos.map(
              (produto, productIndex) => {
                const dotStyle: CSSProperties = {
                  width: 6,
                  height: 6,
                  borderRadius: 9999,
                  background:
                    "rgb(203 213 225)",
                  animationName:
                    "ofertanoHeroDot",
                  animationDuration:
                    `${duration}s`,
                  animationTimingFunction:
                    "linear",
                  animationIterationCount:
                    "infinite",
                  animationDelay:
                    `-${(count - productIndex) * SECONDS_PER_PRODUCT}s`,
                };

                return (
                  <span
                    key={produto.id}
                    aria-hidden="true"
                    style={dotStyle}
                  />
                );
              },
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}