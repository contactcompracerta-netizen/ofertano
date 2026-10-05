"use client";

import { useEffect, useState } from "react";
import { sanitizeProductNameForDisplay } from "@/lib/product/productPresentation";
import type { FlashDeal } from "@/services/flashDeals/flashDeals";
import { formatRemainingTime } from "@/services/flashDeals/countdown";

const currency = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function FlashDealsSection({ deals, marketplaceLabel = "Mercado Livre" }: {
  deals: readonly FlashDeal[];
  marketplaceLabel?: string;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (deals.length === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [deals.length]);
  const visibleDeals = deals.filter(deal => now === null || (
    Date.parse(deal.validUntil) > now && (deal.expiresAt === null || Date.parse(deal.expiresAt) > now)
  )).slice(0, 6);
  if (visibleDeals.length === 0) return null;
  return (
    <section aria-labelledby="flash-deals-heading" className="mx-auto w-full max-w-[1440px] px-2.5 pt-3 sm:px-5 sm:pt-5 lg:px-8">
      <div className="min-w-0 rounded-2xl border border-emerald-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex items-center gap-2">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">⚡</span>
          <div className="min-w-0">
            <h2 id="flash-deals-heading" className="text-sm font-black tracking-tight text-slate-950 sm:text-lg">Ofertas Relâmpago</h2>
            <p className="text-[10px] font-bold text-emerald-700 sm:text-xs">{marketplaceLabel}</p>
          </div>
        </div>
        <ul aria-label="Ofertas relâmpago disponíveis" tabIndex={0} className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1 focus-visible:outline-2 focus-visible:outline-emerald-600 sm:gap-3">
          {visibleDeals.map(deal => {
            const title = sanitizeProductNameForDisplay(deal.title);
            return (
              <li key={deal.id} className="w-[260px] shrink-0 snap-start sm:w-[280px]">
                <a href={deal.affiliateUrl} target="_blank" rel="sponsored noopener noreferrer" aria-label={`Ver oferta: ${title}`} className="group flex h-full flex-col rounded-xl border border-slate-200 bg-white p-2.5 transition-colors hover:border-emerald-400 focus-visible:outline-2 focus-visible:outline-emerald-600">
                  <div className="flex min-w-0 gap-2.5">
                    {/* Match the existing product image pipeline; fixed geometry and lazy loading. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={deal.image} alt={title} width={72} height={72} loading="lazy" decoding="async" className="h-[72px] w-[72px] shrink-0 object-contain" />
                    <div className="min-w-0 flex-1">
                      <h3 className="line-clamp-2 min-h-8 text-xs font-bold leading-4 text-slate-900">{title}</h3>
                      {deal.originalPrice !== null ? <p className="mt-1 text-[10px] text-slate-500 line-through">{currency.format(deal.originalPrice)}</p> : null}
                      <p className="whitespace-nowrap text-base font-black tracking-tight text-emerald-700">{currency.format(deal.currentPrice)}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[10px] font-bold">
                    {deal.discountPercent !== null ? <span className="rounded bg-emerald-50 px-1.5 py-1 text-emerald-800">{deal.discountPercent}% OFF</span> : <span className="text-slate-500">{marketplaceLabel}</span>}
                    <span className="rounded-lg bg-[#087A55] px-2.5 py-2 text-white group-hover:bg-[#066747]">Ver oferta →</span>
                  </div>
                </a>
                {deal.expiresAt !== null ? (
                  <p className="mt-1 h-4 text-center text-[10px] font-bold tabular-nums text-slate-500" aria-label="Tempo restante da promoção">
                    {now === null ? `Termina em ${new Date(deal.expiresAt).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}` : formatRemainingTime(Date.parse(deal.expiresAt) - now)}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
