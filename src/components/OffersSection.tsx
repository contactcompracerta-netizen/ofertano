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
  /*
   * Só é lido no estado "0 resultado": cada sugestão aponta para dado
   * real do catálogo público, então a tela nunca oferece caminho morto.
   */
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
              ? `Não encontramos produtos relacionados a “${busca}”. Tente um termo abaixo ou navegue por categoria.`
              : "Importe o primeiro produto pelo painel administrativo para começar a exibir ofertas."}
          </p>

          {/*
            Estado vazio útil: cada link abaixo é dado REAL do catálogo
            público (categoria ou marca de produto visível), nunca uma
            palavra literal. Nada é inventado para preencher a tela.
          */}
          {possuiBusca && temDicas ? (
            <div className="mx-auto mt-8 grid max-w-3xl gap-6 text-left sm:grid-cols-2">
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

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={possuiBusca ? "/" : "/admin"}
              className="inline-flex rounded-xl bg-emerald-600 px-6 py-3 text-sm font-black text-white transition hover:bg-emerald-700"
            >
              {possuiBusca ? "Ver todas as ofertas" : "Cadastrar produto"}
            </Link>

            {possuiBusca ? (
              <Link
                href="/categorias"
                className="inline-flex rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-black text-slate-800 transition hover:border-emerald-300 hover:text-emerald-800"
              >
                Ver categorias
              </Link>
            ) : null}
          </div>
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
              marketplaces={listarMarketplacesComparaveis(
                produto.offers,
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
