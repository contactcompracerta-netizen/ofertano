import Link from "next/link";

type Categoria = {
  nome: string;
  quantidade: number;
};

type CategoriesSectionProps = {
  categorias: Categoria[];
};

function obterIconeCategoria(nome: string) {
  const categoria = nome.toLowerCase();

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

export default function CategoriesSection({
  categorias,
}: CategoriesSectionProps) {
  if (categorias.length === 0) {
    return null;
  }

  return (
    <section className="border-y border-gray-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-16">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <span className="text-sm font-black uppercase tracking-widest text-green-700">
              Encontre mais rápido
            </span>

            <h2 className="mt-2 text-3xl font-black tracking-tight text-gray-900 sm:text-4xl">
              Explore por categoria
            </h2>

            <p className="mt-3 max-w-2xl text-gray-600">
              Navegue pelas principais categorias disponíveis no Ofertano.
            </p>
          </div>

          <Link
            href="/categorias"
            className="font-bold text-green-700 transition hover:text-green-900"
          >
            Ver todas as categorias →
          </Link>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {categorias.slice(0, 8).map((categoria) => (
            <Link
              key={categoria.nome}
              href={`/?q=${encodeURIComponent(categoria.nome)}`}
              className="group flex items-center gap-4 rounded-2xl border border-gray-200 bg-slate-50 p-5 transition hover:-translate-y-1 hover:border-green-300 hover:bg-green-50 hover:shadow-lg"
            >
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm transition group-hover:scale-105">
                {obterIconeCategoria(categoria.nome)}
              </div>

              <div className="min-w-0">
                <h3 className="truncate font-black text-gray-900 transition group-hover:text-green-700">
                  {categoria.nome}
                </h3>

                <p className="mt-1 text-sm text-gray-500">
                  {categoria.quantidade}{" "}
                  {categoria.quantidade === 1 ? "produto" : "produtos"}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}