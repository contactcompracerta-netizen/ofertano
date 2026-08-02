import prisma from "@/lib/prisma";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import CategoriesSection from "@/components/CategoriesSection";
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

type CategoriaContagem = {
  nome: string;
  quantidade: number;
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

  const produtosParaCategorias = busca
    ? await prisma.product.findMany({
        where: {
          active: true,

          price: {
            gt: 0,
          },

          image: {
            not: "",
          },
        },

        select: {
          category: true,
        },
      })
    : produtos;

  const categoriasMap = new Map<string, number>();

  produtosParaCategorias.forEach((produto) => {
    const categoria = produto.category?.trim();

    if (!categoria) {
      return;
    }

    categoriasMap.set(
      categoria,
      (categoriasMap.get(categoria) || 0) + 1
    );
  });

  const categorias: CategoriaContagem[] = Array.from(
    categoriasMap.entries()
  )
    .map(([nome, quantidade]) => ({
      nome,
      quantidade,
    }))
    .sort((a, b) => {
      if (b.quantidade !== a.quantidade) {
        return b.quantidade - a.quantidade;
      }

      return a.nome.localeCompare(b.nome, "pt-BR");
    });

  return (
    <main className="min-h-screen bg-slate-50">
      <Header />

      <Hero busca={busca} />

      {!busca && (
        <CategoriesSection categorias={categorias} />
      )}

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