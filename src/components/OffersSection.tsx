import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import AnalyticsListingScope from "@/components/analytics/AnalyticsListingScope";
import ProductImpression from "@/components/analytics/ProductImpression";
import SearchAnalytics from "@/components/analytics/SearchAnalytics";
import {
  listarMarketplacesComparaveis,
  type PublicOfferLike,
} from "@/services/publicVisibility/multiStoreVisibility";
import type { DicasPublicas } from "@/services/publicVisibility/publicDiscoveryHints";

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
  offers?: PublicOfferLike[];
};

type OffersSectionProps = {
  produtos: Produto[];
  busca: string;
  searchMeta?: {
    durationMs?: number;
    source?: string;
    productIds?: string[];
  };
  dicas?: DicasPublicas;
};

export default function OffersSection({
  produtos,
  busca,
  searchMeta,
  dicas,
}: OffersSectionProps) {
  const possuiBusca = busca.length > 0;
  const categoriasDica = dicas?.categorias ?? [];
  const buscasDica = dicas?.buscas ?? [];
  const temDicas = categoriasDica.length + buscasDica.length > 0;

  return (
    <section
      id="ofertas"
      className="mx-auto w-full max-w-[1600px] scroll-mt-20 px-2.5 py-4 sm:px-5 sm:py-6 lg:px-8 lg:py-8"
    >
      <AnalyticsListingScope
        surface={possuiBusca ? "search" : "home"}
        scope={busca}
      >
        <div className="mb-3 flex items-end justify-between gap-3 sm:mb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-[0.16em] text-emerald-700 sm:text-[10px]">
                {possuiBusca ? "Resultado da pesquisa" : "Catálogo inteligente"}
              </span>
              {!possuiBusca && produtos.length > 0 && (
                <span className="hidden rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700 sm:inline-flex">
                  atualizado agora
                </span>
              )}
            </div>

            <h2 className="mt-1 text-[21px] font-black tracking-[-0.035em] text-slate-950 sm:text-2xl lg:text-[30px]">
              {possuiBusca ? `Resultados para “${busca}”` : "Ofertas recentes"}
            </h2>

            <p className="mt-0.5 text-[11px] font-medium text-slate-500 sm:text-sm">
              {possuiBusca
                ? `${produtos.length} produto${produtos.length === 1 ? "" : "s"} encontrado${produtos.length === 1 ? "" : "s"}.`
                : "Mais produtos visíveis, menos rolagem e comparação direta."}
            </p>
          </div>

          {possuiBusca ? (
            <Link
              href="/"
              className="hidden shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-600 transition hover:border-emerald-200 hover:text-emerald-700 sm:inline-flex"
            >
              Limpar
            </Link>
          ) : (
            produtos.length > 0 && (
              <Link
                href="/ofertas"
                className="hidden shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 sm:inline-flex"
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
          <div className="rounded-[24px] border border-slate-200 bg-white p-7 text-center shadow-[0_10px_40px_rgba(15,23,42,0.05)] sm:p-10">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-xl ring-1 ring-emerald-100">
              🔍
            </div>

            <h3 className="mt-4 text-lg font-black text-slate-950 sm:text-xl">
              {possuiBusca ? "Nenhum produto encontrado" : "Nenhum produto cadastrado"}
            </h3>

            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">
              {possuiBusca
                ? `Não encontramos produtos relacionados a “${busca}”. Tente um termo abaixo ou navegue por categoria.`
                : "Importe o primeiro produto pelo painel administrativo para começar a exibir ofertas."}
            </p>

            {possuiBusca && temDicas ? (
              <div className="mx-auto mt-6 grid max-w-3xl gap-5 text-left sm:grid-cols-2">
                {categoriasDica.length > 0 ? (
                  <div>
                    <h4 className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                      Categorias relacionadas
                    </h4>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {categoriasDica.map((categoria) => (
                        <li key={`categoria-${categoria.nome}`}>
                          <Link
                            href={`/?q=${encodeURIComponent(categoria.nome)}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                          >
                            {categoria.nome}
                            <span className="text-[10px] font-black text-slate-400">
                              {categoria.quantidade}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {buscasDica.length > 0 ? (
                  <div>
                    <h4 className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                      Sugestões de busca
                    </h4>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {buscasDica.map((sugestao) => (
                        <li key={`busca-${sugestao.termo}`}>
                          <Link
                            href={`/?q=${encodeURIComponent(sugestao.termo)}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800"
                          >
                            {sugestao.termo}
                            <span className="text-[10px] font-black text-slate-400">
                              {sugestao.quantidade}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Link
                href={possuiBusca ? "/" : "/admin"}
                className="inline-flex rounded-xl bg-[#087A55] px-5 py-2.5 text-sm font-black text-white transition hover:bg-[#066747]"
              >
                {possuiBusca ? "Ver todas as ofertas" : "Cadastrar produto"}
              </Link>

              {possuiBusca ? (
                <Link
                  href="/categorias"
                  className="inline-flex rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-black text-slate-800 transition hover:border-emerald-300 hover:text-emerald-800"
                >
                  Ver categorias
                </Link>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-3 md:gap-3.5 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {produtos.map((produto, index) => (
              <ProductImpression
                key={produto.id}
                productId={produto.id}
                position={index + 1}
                query={possuiBusca ? busca : null}
                surface={possuiBusca ? "search" : "home"}
                marketplaces={listarMarketplacesComparaveis(produto.offers)}
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
