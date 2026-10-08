import type { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/prisma";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { hasPublicMultiStore, PUBLIC_OFFER_SELECT } from "@/services/publicVisibility/multiStoreVisibility";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Categorias",
  description:
    "Navegue pelas categorias do Ofertano e encontre produtos para comparar preços em lojas como Mercado Livre, Amazon e Shopee.",
  alternates: {
    canonical: "/categorias",
  },
  openGraph: {
    type: "website",
    url: "/categorias",
    title: "Categorias | Ofertano",
    description:
      "Navegue pelas categorias do Ofertano e encontre produtos para comparar preços em lojas como Mercado Livre, Amazon e Shopee.",
  },
};

type Categoria = {
  nome: string;
  quantidade: number;
};

function obterIconeCategoria(nome: string) {
  const categoria = nome.toLocaleLowerCase("pt-BR");

  if (
    categoria.includes("notebook") ||
    categoria.includes("computador") ||
    categoria.includes("informática")
  ) {
    return "💻";
  }

  if (
    categoria.includes("celular") ||
    categoria.includes("smartphone") ||
    categoria.includes("telefone")
  ) {
    return "📱";
  }

  if (
    categoria.includes("televis") ||
    categoria.includes("tv") ||
    categoria.includes("áudio")
  ) {
    return "📺";
  }

  if (
    categoria.includes("eletro") ||
    categoria.includes("cozinha") ||
    categoria.includes("air fryer")
  ) {
    return "🍳";
  }

  if (
    categoria.includes("casa") ||
    categoria.includes("móvel") ||
    categoria.includes("decoração")
  ) {
    return "🏠";
  }

  if (
    categoria.includes("ferramenta") ||
    categoria.includes("construção")
  ) {
    return "🛠️";
  }

  if (
    categoria.includes("bebê") ||
    categoria.includes("infantil") ||
    categoria.includes("criança")
  ) {
    return "🧸";
  }

  if (
    categoria.includes("beleza") ||
    categoria.includes("cuidado")
  ) {
    return "✨";
  }

  return "🏷️";
}

export default async function CategoriasPage() {
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
    select: {
      category: true,
      offers: {
        where: {
          active: true,
          matchStatus: "EXACT",
        },
        ...PUBLIC_OFFER_SELECT,
      },
    },
  });

  const produtosMultiLoja = produtos.filter(hasPublicMultiStore);

  const categoriasMap = new Map<string, number>();

  produtosMultiLoja.forEach((produto) => {
    const categoria = produto.category?.trim();

    if (!categoria) {
      return;
    }

    categoriasMap.set(
      categoria,
      (categoriasMap.get(categoria) || 0) + 1,
    );
  });

  const categorias: Categoria[] = Array.from(categoriasMap.entries())
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
    <main className="of-page">
      <Header />

      <section className="of-page-intro">
        <div className="of-page-intro__inner">
          <p className="of-eyebrow">
            Navegue por assunto
          </p>

          <h1 className="of-page-title">
            Categorias
          </h1>

          <p className="of-page-lead">
            Escolha uma categoria para encontrar produtos relacionados.
          </p>
        </div>
      </section>

      <section className="of-section">
        {categorias.length === 0 ? (
          <div className="of-empty">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-lg">
              🏷️
            </div>

            <h2 className="mt-4 of-section-title">
              Nenhuma categoria disponível
            </h2>

            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">
              As categorias aparecerão quando houver produtos ativos
              cadastrados.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {categorias.map((categoria) => (
              <Link
                key={categoria.nome}
                href={`/?q=${encodeURIComponent(categoria.nome)}`}
                className="group flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-50 hover:shadow-md sm:p-5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-lg transition group-hover:scale-105 sm:h-11 sm:w-11 sm:text-xl">
                  {obterIconeCategoria(categoria.nome)}
                </div>

                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-black text-slate-900 transition group-hover:text-emerald-700">
                    {categoria.nome}
                  </h2>

                  <p className="mt-0.5 text-xs text-slate-500">
                    {categoria.quantidade}{" "}
                    {categoria.quantidade === 1 ? "produto" : "produtos"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <Footer />
    </main>
  );
}