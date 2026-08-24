import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import AnalyticsListingScope from "@/components/analytics/AnalyticsListingScope";
import ProductImpression from "@/components/analytics/ProductImpression";
import SearchAnalytics from "@/components/analytics/SearchAnalytics";

type Produto = {
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
    offers?: Array<{
      marketplace: string;
    }>;
  };

type OffersSectionProps = {
  produtos: Produto[];
  busca: string;
  searchMeta?: {
    durationMs?: number;
    source?: string;
    productIds?: string[];
  };
};

export default function OffersSection({
  produtos,
  busca,
  searchMeta,
}: OffersSectionProps) {
  const possuiBusca = busca.length > 0;

  return (
    <section
      id="ofertas"
      className="mx-auto w-full max-w-[1440px] scroll-mt-20 px-2.5 py-4 sm:px-5 sm:py-8 lg:px-8 lg:py-10"
    >
    <AnalyticsListingScope
      surface={possuiBusca ? "search" : "home"}
      scope={busca}
    >
      <div className="mb-3 flex items-end justify-between gap-3 sm:mb-6">
        <div className="min-w-0">
          <span className="text-[9px] font-black uppercase tracking-[0.14em] text-emerald-700 sm:text-xs">
            {possuiBusca
              ? "Resultado da pesquisa"
              : "Produtos selecionados"}
          </span>

          <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950 sm:text-3xl lg:text-4xl">
            {possuiBusca
              ? `Resultados para “${busca}”`
              : "Ofertas recentes"}
          </h2>

          <p className="mt-1 text-xs text-slate-600 sm:mt-2 sm:text-base">
            {possuiBusca
              ? `${produtos.length} produto${
                  produtos.length === 1 ? "" : "s"
                } encontrado${produtos.length === 1 ? "" : "s"}.`
              : "Confira os últimos produtos adicionados."}
          </p>
        </div>

        {possuiBusca ? (
          <Link
            href="/"
            className="hidden shrink-0 text-sm font-bold text-emerald-700 transition hover:text-emerald-900 sm:block"
          >
            Limpar pesquisa
          </Link>
        ) : (
          produtos.length > 0 && (
            <Link
              href="/ofertas"
              className="hidden shrink-0 text-sm font-bold text-emerald-700 transition hover:text-emerald-900 sm:block"
            >
              Ver todas →
            </Link>
          )
        )}
      </div>

      {possuiBusca ? (
        <SearchAnalytics
          query={busca}
          resultCount={produtos.length}
          durationMs={searchMeta?.durationMs}
          searchSource={searchMeta?.source}
          productIds={searchMeta?.productIds ?? produtos.map((produto) => produto.id)}
        />
      ) : null}

      {produtos.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm sm:p-12">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl sm:h-16 sm:w-16">
            🔍
          </div>

          <h3 className="mt-5 text-xl font-black text-slate-900 sm:text-2xl">
            {possuiBusca
              ? "Nenhum produto encontrado"
              : "Nenhum produto cadastrado"}
          </h3>

          <p className="mx-auto mt-3 max-w-lg text-sm text-slate-600 sm:text-base">
            {possuiBusca
              ? `Não encontramos produtos relacionados a “${busca}”. Tente pesquisar usando outro termo.`
              : "Importe o primeiro produto pelo painel administrativo para começar a exibir ofertas."}
          </p>

          <Link
            href={possuiBusca ? "/" : "/admin"}
            className="mt-6 inline-flex rounded-xl bg-emerald-600 px-6 py-3 text-sm font-black text-white transition hover:bg-emerald-700"
          >
            {possuiBusca ? "Ver todas as ofertas" : "Cadastrar produto"}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:gap-4 md:grid-cols-3 lg:gap-5 xl:grid-cols-4 2xl:grid-cols-5">
          {produtos.map((produto, index) => (
            <ProductImpression
              key={produto.id}
              productId={produto.id}
              position={index + 1}
              query={possuiBusca ? busca : null}
              surface={possuiBusca ? "search" : "home"}
              marketplaces={(produto.offers ?? []).map(
                (oferta) => oferta.marketplace,
              )}
            >
              <ProductCard produto={produto} />
            </ProductImpression>
          ))}
        </div>
      )}
    </AnalyticsListingScope>
    </section>
  );
}
