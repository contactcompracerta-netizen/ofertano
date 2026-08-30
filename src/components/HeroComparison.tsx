"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

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

const ROTATION_MS = 5000;
const TRANSITION_MS = 180;

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
    <div className="relative hidden lg:block">
      <div className="absolute -inset-4 rounded-[34px] bg-gradient-to-br from-emerald-300/45 via-teal-200/25 to-transparent blur-2xl" />

      <div className="relative overflow-hidden rounded-[28px] border border-white/80 bg-white/85 p-5 shadow-[0_28px_80px_rgba(15,23,42,0.14)] backdrop-blur-xl xl:p-6">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">
          Comparador Ofertano
        </p>

        <p className="mt-1 text-xs font-semibold text-slate-500">
          Comparações com ofertas reais
        </p>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-bold text-slate-700">
            Nenhuma comparação disponível agora.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function HeroComparison({
  produtos,
}: HeroComparisonProps) {
  const [index, setIndex] = useState(0);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (produtos.length <= 1) {
      return;
    }

    let timeoutId:
      | ReturnType<typeof setTimeout>
      | undefined;

    const intervalId = setInterval(() => {
      setChanging(true);

      timeoutId = setTimeout(() => {
        setIndex(
          (current) =>
            (current + 1) % produtos.length,
        );

        setChanging(false);
      }, TRANSITION_MS);
    }, ROTATION_MS);

    return () => {
      clearInterval(intervalId);

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [produtos.length]);

  if (produtos.length === 0) {
    return <EmptyComparison />;
  }

  const produto =
    produtos[index % produtos.length];

  const melhorOferta = produto.offers[0];

  if (!melhorOferta) {
    return <EmptyComparison />;
  }

  const secundarias =
    produto.offers.slice(1, 3);

  const restantes = Math.max(
    produto.offers.length - 3,
    0,
  );

  return (
    <div className="relative hidden lg:block">
      <div className="absolute -inset-4 rounded-[34px] bg-gradient-to-br from-emerald-300/45 via-teal-200/25 to-transparent blur-2xl" />

      <div className="relative overflow-hidden rounded-[28px] border border-white/80 bg-white/85 p-5 shadow-[0_28px_80px_rgba(15,23,42,0.14)] backdrop-blur-xl xl:p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-emerald-700">
              Comparador Ofertano
            </p>

            <p className="mt-1 text-xs font-semibold text-slate-500">
              Comparações com ofertas reais
            </p>
          </div>

          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] font-black text-emerald-700">
            Dados reais
          </span>
        </div>

        <div
          className={`mt-4 transition-all duration-200 motion-reduce:transition-none ${
            changing
              ? "translate-y-1 opacity-0"
              : "translate-y-0 opacity-100"
          }`}
        >
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <Link
              href={`/produto/${produto.id}`}
              className="flex items-center gap-3"
            >
              <div className="flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 p-1.5">
                <img
                  src={produto.image}
                  alt={produto.name}
                  decoding="async"
                  className="h-full w-full object-contain"
                />
              </div>

              <div className="min-w-0 flex-1">
                <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-slate-600">
                  Produto real
                </span>

                <h2 className="mt-1.5 line-clamp-2 text-sm font-black leading-5 text-slate-950 xl:text-base">
                  {produto.name}
                </h2>

                <div className="mt-1 flex items-center gap-2 text-[11px] font-bold text-slate-500">
                  {produto.rating !== null &&
                  produto.rating > 0 ? (
                    <span className="text-amber-600">
                      Nota {produto.rating.toFixed(1)}
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
              className="mt-4 block rounded-xl border-2 border-emerald-500 bg-emerald-50/70 p-3.5 transition hover:border-emerald-600 hover:bg-emerald-50"
            >
              <div className="flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-bold text-slate-500">
                    {formatMarketplace(
                      melhorOferta.marketplace,
                    )}
                  </p>

                  <p className="mt-1 text-xl font-black tracking-tight text-slate-950 xl:text-2xl">
                    {formatPrice(
                      melhorOferta.price,
                    )}
                  </p>

                  <p className="mt-1 text-[11px] font-semibold text-emerald-700">
                    Melhor preço encontrado
                  </p>
                </div>

                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
                  <ArrowIcon />
                </div>
              </div>
            </Destination>

            {secundarias.length > 0 ? (
              <div
                className={`mt-2.5 grid gap-2.5 ${
                  secundarias.length === 1
                    ? "grid-cols-1"
                    : "grid-cols-2"
                }`}
              >
                {secundarias.map((oferta) => (
                  <Destination
                    key={oferta.marketplace}
                    href={oferta.href}
                    productId={produto.id}
                    className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 transition hover:border-emerald-300 hover:bg-emerald-50/50"
                  >
                    <p className="truncate text-xs font-black text-slate-700">
                      {formatMarketplace(
                        oferta.marketplace,
                      )}
                    </p>

                    <p className="mt-1 truncate text-sm font-black text-slate-950">
                      {formatPrice(
                        oferta.price,
                      )}
                    </p>
                  </Destination>
                ))}
              </div>
            ) : null}

            {restantes > 0 ? (
              <Link
                href={`/produto/${produto.id}`}
                className="mt-2.5 block text-center text-[10px] font-bold text-emerald-700 hover:text-emerald-900"
              >
                +{restantes}{" "}
                {restantes === 1
                  ? "outra oferta"
                  : "outras ofertas"}
              </Link>
            ) : null}
          </div>

          {produtos.length > 1 ? (
            <div className="mt-3 flex items-center justify-center gap-1.5">
              {produtos.map(
                (item, itemIndex) => (
                  <span
                    key={item.id}
                    aria-hidden="true"
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      itemIndex ===
                      index % produtos.length
                        ? "w-5 bg-emerald-600"
                        : "w-1.5 bg-slate-300"
                    }`}
                  />
                ),
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}