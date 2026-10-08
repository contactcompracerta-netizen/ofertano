import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import Header from "@/components/Header";
import ProductCard from "@/components/ProductCard";
import AnalyticsListingScope from "@/components/analytics/AnalyticsListingScope";
import ProductImpression from "@/components/analytics/ProductImpression";
import Footer from "@/components/Footer";
import { hasPublicMultiStore, PUBLIC_OFFER_SELECT } from "@/services/publicVisibility/multiStoreVisibility";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Ofertas",
  description:
    "Confira todas as ofertas do Ofertano, compare preços entre lojas parceiras e compre diretamente no marketplace.",
  alternates: {
    canonical: "/ofertas",
  },
  openGraph: {
    type: "website",
    url: "/ofertas",
    title: "Ofertas | Ofertano",
    description:
      "Confira todas as ofertas do Ofertano, compare preços entre lojas parceiras e compre diretamente no marketplace.",
  },
};

export default async function OfertasPage() {
  const produtos = await prisma.product.findMany({
    where: {
      active: true,

      price: {
        gt: 0,
      },

      image: {
        not: "",
      },
    },

    include: {
      offers: {
        where: {
          active: true,
          matchStatus: "EXACT",
        },
        ...PUBLIC_OFFER_SELECT,
      },
    },

    orderBy: [
      {
        featured: "desc",
      },
      {
        createdAt: "desc",
      },
    ],
  });

  const produtosMultiLoja = produtos.filter(hasPublicMultiStore);

  return (
    <main className="of-page">
      <Header />

      <section className="of-page-intro">
        <div className="of-page-intro__inner">
          <p className="of-eyebrow">
            Catálogo Ofertano
          </p>

          <h1 className="of-page-title">
            Todas as ofertas
          </h1>

          <p className="of-page-lead">
            Confira todos os produtos disponíveis e acesse cada oferta
            diretamente na loja parceira.
          </p>
        </div>
      </section>

      <section className="of-section">
        <div className="mb-5 flex flex-col justify-between gap-3 sm:mb-6 sm:flex-row sm:items-end">
          <div>
            <h2 className="of-section-title">
              Produtos disponíveis
            </h2>

            <p className="mt-1.5 text-sm leading-6 text-slate-600">
              {produtosMultiLoja.length}{" "}
              {produtosMultiLoja.length === 1
                ? "produto encontrado"
                : "produtos encontrados"}
              .
            </p>
          </div>
        </div>

        {produtosMultiLoja.length === 0 ? (
          <div className="of-empty">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-sm font-black text-emerald-700">
              —
            </div>

            <h2 className="mt-4 of-section-title">
              Nenhuma oferta disponível
            </h2>

            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">
              Ainda não existem produtos ativos disponíveis no catálogo.
            </p>
          </div>
        ) : (
          <AnalyticsListingScope surface="ofertas">
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {produtosMultiLoja.map((produto, index) => (
              <ProductImpression
                key={produto.id}
                productId={produto.id}
                position={index + 1}
                surface="ofertas"
              >
                <ProductCard produto={produto} />
              </ProductImpression>
            ))}
            </div>
          </AnalyticsListingScope>
        )}
      </section>

      <Footer />
    </main>
  );
}