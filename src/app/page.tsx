import prisma from "@/lib/prisma";
import { after } from "next/server";

import Header from "@/components/Header";
import Hero from "@/components/Hero";
import OffersSection from "@/components/OffersSection";
import AntiFraudNotice from "@/components/AntiFraudNotice";
import Benefits from "@/components/Benefits";
import Footer from "@/components/Footer";

import { searchCatalogOrDiscover } from "@/services/search/searchCatalogOrDiscover";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

type HomePageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

export default async function HomePage({
  searchParams,
}: HomePageProps) {
  const parametros = await searchParams;

  const busca =
    parametros.q
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, 160) || "";

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
        },

        include: {
          offers: {
            where: {
              active: true,
              matchStatus: "EXACT",
            },
            select: {
              marketplace: true,
            },
          },
        },

        orderBy: {
          updatedAt: "desc",
        },
      });

    return (
      <main className="min-h-screen bg-slate-50">
        <Header />

        <Hero />

        <OffersSection
          produtos={produtos}
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
  const pesquisaIniciadaEm = Date.now();
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
  const searchDurationMs = Date.now() - pesquisaIniciadaEm;

  return (
    <main className="min-h-screen bg-slate-50">
      <Header />

      <OffersSection
        produtos={resultado.products}
        busca={busca}
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