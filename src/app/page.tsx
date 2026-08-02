import prisma from "@/lib/prisma";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import OffersSection from "@/components/OffersSection";
import AntiFraudNotice from "@/components/AntiFraudNotice";
import Benefits from "@/components/Benefits";
import Footer from "@/components/Footer";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type HomePageProps = {
  searchParams: Promise<{
    q?: string;
  }>;
};

export default async function HomePage({
  searchParams,
}: HomePageProps) {
  const parametros = await searchParams;
  const busca = parametros.q?.trim() || "";

  const produtos = await prisma.product.findMany({
    where: {
      active: true,

      price: {
        gt: 0,
      },

      image: {
        not: "",
      },

      ...(busca
        ? {
            OR: [
              {
                name: {
                  contains: busca,
                  mode: "insensitive",
                },
              },
              {
                brand: {
                  contains: busca,
                  mode: "insensitive",
                },
              },
              {
                category: {
                  contains: busca,
                  mode: "insensitive",
                },
              },
              {
                store: {
                  contains: busca,
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    },

    orderBy: {
      updatedAt: "desc",
    },
  });

  return (
    <main className="min-h-screen bg-slate-50">
      <Header />

      {!busca && <Hero />}

      <OffersSection
        produtos={produtos}
        busca={busca}
      />

      {!busca && <AntiFraudNotice />}

      <Benefits />

      <Footer />
    </main>
  );
}
