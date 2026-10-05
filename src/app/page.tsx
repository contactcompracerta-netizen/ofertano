import type { Metadata } from "next";
import prisma from "@/lib/prisma";
import { after } from "next/server";

import { serializeJsonLd } from "@/lib/seo/serialize";
import { buildWebSiteStructuredData } from "@/lib/seo/website";
import { agoraEmMs } from "@/lib/agoraEmMs";

import Header from "@/components/Header";
import Hero from "@/components/Hero";
import OffersSection from "@/components/OffersSection";
import FlashDealsSection from "@/components/flashDeals/FlashDealsSection";
import { getHomeFlashDeals } from "@/services/flashDeals/flashDeals";
import AntiFraudNotice from "@/components/AntiFraudNotice";
import Benefits from "@/components/Benefits";
import Footer from "@/components/Footer";

import { searchCatalogOrDiscover } from "@/services/search/searchCatalogOrDiscover";
import {
  hasPublicMultiStore,
  multiStorePublicWhere,
} from "@/services/publicVisibility/multiStoreVisibility";
import { listarDicasPublicas } from "@/services/publicVisibility/publicDiscoveryHints";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type HomePageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

function extrairBusca(parametros: { q?: string }): string {
  return (
    parametros.q
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || ""
  );
}

/*
 * Home sem busca: metadata própria, canonical limpa e WebSite schema.
 * Home com busca (?q=): resultados dinâmicos/thin não devem indexar;
 * mantém follow para os links de produto continuarem sendo rastreados.
 */
export async function generateMetadata({
  searchParams,
}: HomePageProps): Promise<Metadata> {
  const parametros = await searchParams;
  const busca = extrairBusca(parametros);

  if (busca) {
    return {
      title: "Pesquisa de preços",
      robots: {
        index: false,
        follow: true,
      },
    };
  }

  return {
    title: "Compare preços antes de comprar",
    description:
      "Compare preços, encontre ofertas e compre diretamente em lojas parceiras como Mercado Livre, Amazon, Shopee e AliExpress.",
    alternates: {
      canonical: "/",
    },
    openGraph: {
      type: "website",
      url: "/",
      siteName: "Ofertano",
      locale: "pt_BR",
      title: "Ofertano | Compare preços antes de comprar",
      description:
        "Compare preços, encontre ofertas e compre diretamente em lojas parceiras como Mercado Livre, Amazon, Shopee e AliExpress.",
    },
    twitter: {
      card: "summary_large_image",
      title: "Ofertano | Compare preços antes de comprar",
      description:
        "Compare preços, encontre ofertas e compre diretamente em lojas parceiras como Mercado Livre, Amazon, Shopee e AliExpress.",
    },
  };
}

export default async function HomePage({
  searchParams,
}: HomePageProps) {
  const parametros = await searchParams;

  const busca = extrairBusca(parametros);

  /*
   * Sem pesquisa:
   * mantém o comportamento normal da Home,
   * exibindo os produtos já publicados.
   */
  if (!busca) {
    const produtos =
      await prisma.product.findMany({
        where: {
          active: true,

          price: {
            gt: 0,
          },

          image: {
            not: "",
          },

          AND: multiStorePublicWhere().AND,
        },

        include: {
          offers: {
            where: {
              active: true,
              matchStatus: "EXACT",
            },
            select: {
              id: true,
              title: true,
              image: true,
              oldPrice: true,
              rawPayload: true,
              marketplace: true,
              price: true,
              status: true,
              available: true,
              affiliateLink: true,
              /*
               * LISTING-FIRST: sem `externalId`/`sourceUrl` a Home não
               * consegue provar a identidade do anúncio do Mercado Livre e
               * a oferta de CATÁLOGO (`/p/...`) entrava no comparador do
               * Hero como se fosse uma loja comprável.
               */
              externalId: true,
              sourceUrl: true,
            },
          },
        },

        orderBy: {
          updatedAt: "desc",
        },
      });

    const produtosMultiLoja = produtos.filter(hasPublicMultiStore);

    return (
      <main className="min-h-screen bg-slate-50">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(buildWebSiteStructuredData()),
          }}
        />

        <Header />

        <Hero />

        <FlashDealsSection deals={getHomeFlashDeals(produtosMultiLoja)} />

        <FlashDealsSection deals={getHomeFlashDeals(produtosMultiLoja)} />

        <OffersSection
          produtos={produtosMultiLoja}
          busca=""
        />

        <AntiFraudNotice />

        <Benefits />

        <Footer />
      </main>
    );
  }

  /*
   * Com pesquisa:
   * busca e clustering no caminho da resposta; persistencia Prisma
   * so depois, via after(), sem prender o HTML.
   */
  const pesquisaIniciadaEm = agoraEmMs();
  const resultado =
    await searchCatalogOrDiscover(
      busca,
      5,
      {
        schedulePersist: (task) => {
          after(task);
        },
      },
    );
  const searchDurationMs = agoraEmMs() - pesquisaIniciadaEm;

  /*
   * Dicas do estado "0 resultado": só custam uma consulta quando a busca
   * NÃO retornou nada, e cada sugestão é uma categoria/marca de produto
   * realmente público. Busca com resultado não precisa delas.
   */
  const dicas =
    resultado.products.length === 0
      ? await listarDicasPublicas()
      : undefined;

  return (
    <main className="min-h-screen bg-slate-50">
      <Header />

      <OffersSection
        produtos={resultado.products}
        busca={busca}
        dicas={dicas}
        searchMeta={{
          durationMs: searchDurationMs,
          source: resultado.source,
          productIds: resultado.products.map((produto) => produto.id),
        }}
      />

      <Benefits />

      <Footer />
    </main>
  );
}
