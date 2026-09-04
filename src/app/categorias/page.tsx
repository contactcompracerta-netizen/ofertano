import Link from "next/link";
import prisma from "@/lib/prisma";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { hasPublicMultiStore, PUBLIC_OFFER_SELECT } from "@/services/publicVisibility/multiStoreVisibility";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    <main className="min-h-screen bg-slate-50">
      <Header />

      <section className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14">
          <p className="text-sm font-black uppercase tracking-widest text-green-700">
            Navegue por assunto
          </p>

          <h1 className="mt-3 text-4xl font-black tracking-tight text-gray-900 sm:text-5xl">
            Categorias
          </h1>

          <p className="mt-4 max-w-2xl text-lg leading-8 text-gray-600">
            Escolha uma categoria para encontrar produtos relacionados.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14">
        {categorias.length === 0 ? (
          <div className="rounded-3xl border border-gray-200 bg-white p-12 text-center shadow-sm">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-2xl">
              🏷️
            </div>

            <h2 className="mt-6 text-2xl font-black text-gray-900">
              Nenhuma categoria disponível
            </h2>

            <p className="mx-auto mt-3 max-w-lg text-gray-600">
              As categorias aparecerão quando houver produtos ativos
              cadastrados.
            </p>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {categorias.map((categoria) => (
              <Link
                key={categoria.nome}
                href={`/?q=${encodeURIComponent(categoria.nome)}`}
                className="group flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:border-green-300 hover:bg-green-50 hover:shadow-lg"
              >
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-green-50 text-2xl transition group-hover:scale-105">
                  {obterIconeCategoria(categoria.nome)}
                </div>

                <div className="min-w-0">
                  <h2 className="truncate font-black text-gray-900 transition group-hover:text-green-700">
                    {categoria.nome}
                  </h2>

                  <p className="mt-1 text-sm text-gray-500">
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