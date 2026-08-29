"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import MarketplaceClickAnchor from "@/components/analytics/MarketplaceClickAnchor";
import {
  aindaAguardaAfiliadoMercadoLivre,
  compraPublicaDasOfertas,
  mesclarOfertasAoVivo,
  sanitizarOfertaCompraPublica,
  type LivePublicOffer,
} from "@/lib/affiliates/liveOffers";
import {
  ehMarketplaceMercadoLivre,
  resolverHrefProprioOfertaPublica,
} from "@/lib/affiliates/publicPurchase";
import { supabase } from "@/lib/supabaseClient";

type LivePurchaseContextValue = {
  productId: string;
  offers: LivePublicOffer[];
  compra: ReturnType<typeof compraPublicaDasOfertas>;
  fallbackPrice: number;
  fallbackOldPrice: number | null;
  fallbackStore: string | null;
};

const LivePurchaseContext = createContext<LivePurchaseContextValue | null>(
  null,
);

function formatarPreco(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatarMarketplace(marketplace: string) {
  const nomes: Record<string, string> = {
    MERCADO_LIVRE: "Mercado Livre",
    AMAZON: "Amazon",
    SHOPEE: "Shopee",
    MAGAZINE_LUIZA: "Magazine Luiza",
    CASAS_BAHIA: "Casas Bahia",
    KABUM: "KaBuM!",
    TERABYTE: "Terabyte",
    ALIEXPRESS: "AliExpress",
    CARREFOUR: "Carrefour",
  };

  return (
    nomes[marketplace] ||
    marketplace
      .replaceAll("_", " ")
      .toLowerCase()
      .replace(/\b\w/g, (letra) => letra.toUpperCase())
  );
}

function obterTextoOfertaPendente(status: string, available: boolean) {
  if (!available || status === "UNAVAILABLE") {
    return "Oferta indisponível";
  }

  if (status === "ERROR") {
    return "Oferta em verificação";
  }

  return "Link em revisão";
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path d="M14 5h5v5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m19 5-8 8" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className={className}
    >
      <path
        d="m5 12 4 4L19 6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ProductLivePurchase({
  productId,
  store,
  productAffiliateLink,
  initialOffers,
  fallbackPrice = 0,
  fallbackOldPrice = null,
  children,
}: {
  productId: string;
  store?: string | null;
  productAffiliateLink?: string | null;
  initialOffers: LivePublicOffer[];
  fallbackPrice?: number;
  fallbackOldPrice?: number | null;
  children: ReactNode;
}) {
  const [offers, setOffers] = useState(() =>
    initialOffers.map(sanitizarOfertaCompraPublica),
  );
  const offersRef = useRef(offers);
  offersRef.current = offers;

  useEffect(() => {
    let ativo = true;

    async function atualizar() {
      try {
        const response = await fetch(
          `/api/products/${encodeURIComponent(productId)}/live-offers`,
          { cache: "no-store" },
        );
        const data = (await response.json()) as {
          success?: boolean;
          offers?: LivePublicOffer[];
        };

        if (!ativo || !response.ok || !data.success || !data.offers) {
          return;
        }

        setOffers((atuais) => mesclarOfertasAoVivo(atuais, data.offers ?? []));
      } catch (error) {
        console.error("Falha ao atualizar ofertas ao vivo:", error);
      }
    }

    const channel = supabase
      .channel(`product-offers:${productId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "MarketplaceOffer",
          filter: `productId=eq.${productId}`,
        },
        () => {
          void atualizar();
        },
      )
      .subscribe();

    const intervalo = window.setInterval(() => {
      if (aindaAguardaAfiliadoMercadoLivre(offersRef.current)) {
        void atualizar();
      }
    }, 4000);

    return () => {
      ativo = false;
      window.clearInterval(intervalo);
      void supabase.removeChannel(channel);
    };
  }, [productId]);

  const compra = useMemo(
    () =>
      compraPublicaDasOfertas({
        store,
        affiliateLink: productAffiliateLink,
        ofertas: offers,
      }),
    [offers, productAffiliateLink, store],
  );

  return (
    <LivePurchaseContext.Provider
      value={{
        productId,
        offers,
        compra,
        fallbackPrice,
        fallbackOldPrice,
        fallbackStore: store ?? null,
      }}
    >
      {children}
    </LivePurchaseContext.Provider>
  );
}

function useLivePurchase() {
  const context = useContext(LivePurchaseContext);

  if (!context) {
    throw new Error("Live purchase precisa do ProductLivePurchase.");
  }

  return context;
}

export function LiveMarketplaceBadge() {
  const { compra, fallbackStore } = useLivePurchase();
  const marketplace = compra.ofertaPrincipal
    ? formatarMarketplace(compra.ofertaPrincipal.marketplace)
    : fallbackStore?.trim() || "Loja parceira";

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700 ring-1 ring-inset ring-emerald-200 sm:text-[11px]">
      <CheckIcon className="h-3.5 w-3.5" />
      Oferta em {marketplace}
    </span>
  );
}

export function LivePrimaryPrice({
  parcelamentoInicial,
}: {
  parcelamentoInicial?: string | null;
}) {
  const { compra, fallbackPrice, fallbackOldPrice } = useLivePurchase();
  const oferta = compra.ofertaPrincipal as LivePublicOffer | null;
  const preco = oferta?.price ?? fallbackPrice;
  const precoAnterior = oferta?.oldPrice ?? fallbackOldPrice;
  const possuiPrecoAnterior =
    precoAnterior !== null && precoAnterior > preco;
  const percentualDesconto =
    possuiPrecoAnterior && precoAnterior !== null
      ? Math.round(((precoAnterior - preco) / precoAnterior) * 100)
      : 0;
  const parcelamento = oferta?.installments ?? parcelamentoInicial ?? null;
  const marketplace = oferta
    ? formatarMarketplace(oferta.marketplace)
    : "loja parceira";

  return (
    <div>
      {possuiPrecoAnterior && precoAnterior !== null && (
        <p className="text-xs font-semibold text-slate-400 line-through sm:text-[13px]">
          {formatarPreco(precoAnterior)}
        </p>
      )}

      <div className="mt-0.5 flex flex-wrap items-end gap-2">
        <p className="text-[27px] font-black leading-none tracking-tight text-emerald-700 sm:text-[29px] lg:text-[30px]">
          {formatarPreco(preco)}
        </p>

        {percentualDesconto > 0 && (
          <span className="mb-0.5 rounded-md bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-800 sm:text-[11px]">
            Economize {percentualDesconto}%
          </span>
        )}
      </div>

      {parcelamento && (
        <p className="mt-1.5 text-xs font-semibold text-slate-700 sm:text-[13px]">
          {parcelamento}
        </p>
      )}

      <p className="mt-1.5 text-[11px] leading-4 text-slate-500 sm:text-xs">
        {marketplace === "AliExpress"
          ? "Preço público consultado no AliExpress. Promoções personalizadas, de novo usuário ou exclusivas do app podem apresentar outro valor."
          : "Preço e condições podem mudar na loja parceira."}
      </p>
    </div>
  );
}

export function LivePrimaryBuyButton({ className }: { className: string }) {
  const { productId, compra } = useLivePurchase();
  const oferta = compra.ofertaPrincipal;
  const href = compra.linkPrincipal;
  const marketplace = oferta
    ? formatarMarketplace(oferta.marketplace)
    : "loja parceira";
  const marketplaceKey = (oferta?.marketplace ?? "OUTROS").slice(0, 40);

  if (!href) {
    return (
      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-center">
        <p className="text-sm font-black text-amber-950">Link em revisão</p>
        <p className="mt-1 text-xs leading-4 text-amber-800">
          A oferta já foi encontrada, mas o link individual ainda está sendo
          validado.
        </p>
      </div>
    );
  }

  return (
    <MarketplaceClickAnchor
      href={href}
      target="_blank"
      rel="noopener noreferrer sponsored"
      productId={productId}
      marketplace={marketplaceKey}
      position={1}
      price={oferta?.price}
      className={className}
    >
      Ver oferta em {marketplace}
      <ExternalLinkIcon className="h-4 w-4" />
    </MarketplaceClickAnchor>
  );
}

export function LiveMobilePrice({ compact }: { compact?: boolean }) {
  const { compra, fallbackPrice, fallbackOldPrice } = useLivePurchase();
  const oferta = compra.ofertaPrincipal as LivePublicOffer | null;
  const preco = oferta?.price ?? fallbackPrice;
  const precoAnterior = oferta?.oldPrice ?? fallbackOldPrice;
  const possuiPrecoAnterior =
    precoAnterior !== null && precoAnterior > preco;

  return (
    <div className="min-w-0 flex-1">
      {possuiPrecoAnterior && precoAnterior !== null && (
        <p className="truncate text-[9px] font-semibold text-slate-400 line-through">
          {formatarPreco(precoAnterior)}
        </p>
      )}
      <p
        className={`truncate font-black leading-none text-emerald-700 ${
          compact ? "text-[15px]" : "text-[16px]"
        }`}
      >
        {formatarPreco(preco)}
      </p>
    </div>
  );
}

export function LiveMobileCta({ variant }: { variant: "full" | "compact" }) {
  const { productId, compra } = useLivePurchase();
  const oferta = compra.ofertaPrincipal;
  const href = compra.linkPrincipal;
  const marketplace = oferta
    ? formatarMarketplace(oferta.marketplace)
    : "loja parceira";
  const marketplaceKey = (oferta?.marketplace ?? "OUTROS").slice(0, 40);

  if (!href) {
    return variant === "full" ? (
      <div className="flex min-h-10 w-full items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-center text-[12px] font-black text-amber-800">
        Link em revisão
      </div>
    ) : (
      <div className="flex min-h-10 min-w-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-2 text-center text-[11px] font-black text-amber-800">
        Link em revisão
      </div>
    );
  }

  if (variant === "full") {
    return (
      <MarketplaceClickAnchor
        href={href}
        target="_blank"
        rel="noopener noreferrer sponsored"
        productId={productId}
        marketplace={marketplaceKey}
        position={1}
        price={oferta?.price}
        className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-center text-[13px] font-black text-white shadow-md shadow-emerald-600/15 active:scale-[0.99]"
      >
        Ver oferta em {marketplace}
        <ExternalLinkIcon className="h-3.5 w-3.5 shrink-0" />
      </MarketplaceClickAnchor>
    );
  }

  return (
    <MarketplaceClickAnchor
      href={href}
      target="_blank"
      rel="noopener noreferrer sponsored"
      productId={productId}
      marketplace={marketplaceKey}
      position={1}
      price={oferta?.price}
      className="flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 text-center text-[12px] font-black text-white shadow-md shadow-emerald-600/15 active:scale-[0.99]"
    >
      <span className="truncate">Ver oferta</span>
      <ExternalLinkIcon className="h-3 w-3 shrink-0" />
    </MarketplaceClickAnchor>
  );
}

function useLiveUsesTwoLineMobileBar() {
  const { compra } = useLivePurchase();
  const oferta = compra.ofertaPrincipal;
  const marketplace = oferta
    ? formatarMarketplace(oferta.marketplace)
    : "";
  const preco = oferta?.price ?? 0;

  return (
    marketplace.toLowerCase().includes("amazon") ||
    formatarPreco(preco).length >= 11
  );
}

export function LiveMobileBuyBar({ trailing }: { trailing: ReactNode }) {
  const duasLinhas = useLiveUsesTwoLineMobileBar();

  if (duasLinhas) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="flex min-w-0 items-center gap-1.5">
          <LiveMobilePrice />
          {trailing}
        </div>
        <div className="mt-1.5">
          <LiveMobileCta variant="full" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-2xl grid-cols-[minmax(68px,auto)_36px_36px_minmax(92px,1fr)] items-center gap-1.5">
      <LiveMobilePrice compact />
      {trailing}
      <LiveMobileCta variant="compact" />
    </div>
  );
}

export function LiveComparatorOffers() {
  const { productId, offers } = useLivePurchase();
  const disponiveis = offers.filter(
    (oferta) =>
      oferta.available &&
      oferta.status !== "UNAVAILABLE" &&
      oferta.status !== "ERROR" &&
      Number.isFinite(oferta.price) &&
      oferta.price > 0,
  );
  const menorPreco =
    disponiveis.length > 0
      ? Math.min(...disponiveis.map((oferta) => oferta.price))
      : null;

  if (new Set(offers.map((oferta) => oferta.marketplace)).size <= 1) {
    return null;
  }

  return (
    <section className="mt-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:mt-3 sm:p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700 sm:text-[11px]">
              Comparador Ofertano
            </p>
            <h2 className="mt-0.5 text-lg font-black tracking-tight text-slate-950 sm:text-xl">
              Compare preços em outras lojas
            </h2>
          </div>
          <p className="max-w-xl text-[10px] leading-4 text-slate-500 sm:text-xs">
            O mesmo produto em lojas diferentes. O menor preço encontrado ganha
            destaque.
          </p>
        </div>

        <div
          className={`grid min-w-0 gap-2 ${
            offers.length === 1
              ? "grid-cols-1"
              : "md:grid-cols-2 2xl:grid-cols-3"
          }`}
        >
          {offers.map((oferta, index) => {
            const ofertaMercadoLivre = ehMarketplaceMercadoLivre(
              oferta.marketplace,
            );
            const ofertaDisponivel =
              oferta.available &&
              oferta.status !== "UNAVAILABLE" &&
              oferta.status !== "ERROR";
            const linkMonetizado = resolverHrefProprioOfertaPublica(oferta);
            const linkDestino = ofertaMercadoLivre
              ? ofertaDisponivel
                ? linkMonetizado
                : null
              : linkMonetizado &&
                  oferta.status === "ACTIVE" &&
                  oferta.available
                ? linkMonetizado
                : null;
            const linkAtivo = Boolean(linkDestino);
            const marketplace = formatarMarketplace(oferta.marketplace);
            const menorPrecoEncontrado =
              menorPreco !== null &&
              oferta.available &&
              oferta.status !== "UNAVAILABLE" &&
              oferta.status !== "ERROR" &&
              Math.abs(oferta.price - menorPreco) < 0.01;

            const conteudoOferta = (
              <div className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {menorPrecoEncontrado && (
                      <span className="inline-flex rounded-full bg-emerald-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white shadow-sm sm:text-[10px]">
                        Melhor preço
                      </span>
                    )}
                    <p
                      className={`${
                        menorPrecoEncontrado
                          ? "mt-1 text-xl text-emerald-700 sm:text-2xl"
                          : "text-lg text-slate-950 sm:text-xl"
                      } font-black leading-none tracking-tight`}
                    >
                      {formatarPreco(oferta.price)}
                    </p>
                    {oferta.installments && (
                      <p className="mt-1 text-[10px] font-semibold leading-4 text-slate-500 sm:text-[11px]">
                        {oferta.installments}
                      </p>
                    )}
                  </div>
                  <div className="min-w-0 shrink-0 text-right">
                    <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400 sm:text-[10px]">
                      Disponível em
                    </p>
                    <p className="mt-0.5 max-w-32 truncate text-[12px] font-black text-slate-800 sm:text-sm">
                      {marketplace}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex min-h-7 items-end justify-between gap-2 border-t border-slate-200/80 pt-2">
                  {!linkAtivo ? (
                    <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black text-amber-800 sm:text-[10px]">
                      {obterTextoOfertaPendente(
                        oferta.status,
                        oferta.available,
                      )}
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-500">
                      Comprar na loja
                    </span>
                  )}
                  {linkAtivo && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-700 sm:text-xs">
                      Ver oferta
                      <ExternalLinkIcon className="h-3.5 w-3.5" />
                    </span>
                  )}
                </div>
              </div>
            );

            if (linkAtivo && linkDestino) {
              return (
                <MarketplaceClickAnchor
                  key={oferta.id}
                  href={linkDestino}
                  target="_blank"
                  rel="noopener noreferrer sponsored"
                  productId={productId}
                  marketplace={oferta.marketplace}
                  position={index + 1}
                  price={oferta.price}
                  className={`rounded-xl p-3 transition hover:-translate-y-0.5 hover:shadow-md ${
                    menorPrecoEncontrado
                      ? "border-2 border-emerald-300 bg-emerald-50/60 shadow-sm hover:border-emerald-400"
                      : "border border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40"
                  }`}
                >
                  {conteudoOferta}
                </MarketplaceClickAnchor>
              );
            }

            return (
              <div
                key={oferta.id}
                className={`rounded-xl p-3 ${
                  menorPrecoEncontrado
                    ? "border-2 border-emerald-300 bg-emerald-50/50"
                    : "border border-amber-200 bg-amber-50/60"
                }`}
              >
                {conteudoOferta}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
