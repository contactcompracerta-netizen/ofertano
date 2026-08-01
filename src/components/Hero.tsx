import Link from "next/link";

type HeroProps = {
  busca: string;
};

export default function Hero({ busca }: HeroProps) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-green-800 via-green-700 to-emerald-600 px-4 py-20 text-white">
      <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-white/10" />

      <div className="absolute -bottom-40 left-1/3 h-96 w-96 rounded-full bg-black/10" />

      <div className="relative mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-2">
        <div>
          <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-bold text-green-50 backdrop-blur">
            Ofertas selecionadas em lojas confiáveis
          </span>

          <h1 className="mt-6 max-w-3xl text-4xl font-black leading-tight tracking-tight sm:text-5xl lg:text-6xl">
            Compare preços antes de comprar
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-8 text-green-50">
            Pesquise produtos, encontre boas ofertas e compre diretamente nas
            lojas parceiras.
          </p>

          <form
            action="/"
            method="GET"
            className="mt-8 flex max-w-2xl flex-col gap-3 rounded-2xl bg-white p-2 shadow-2xl sm:flex-row"
          >
            <label htmlFor="busca" className="sr-only">
              Pesquisar produtos
            </label>

            <input
              id="busca"
              name="q"
              type="search"
              defaultValue={busca}
              placeholder="O que você está procurando?"
              autoComplete="off"
              className="min-h-14 min-w-0 flex-1 rounded-xl px-5 text-base font-medium text-gray-900 outline-none placeholder:text-gray-400"
            />

            <button
              type="submit"
              className="min-h-14 rounded-xl bg-green-600 px-8 font-black text-white transition hover:bg-green-700"
            >
              Buscar
            </button>
          </form>

          <div className="mt-5 flex flex-wrap gap-2 text-sm">
            <span className="text-green-100">Buscas populares:</span>

            <Link
              href="/?q=notebook"
              className="font-bold text-white hover:underline"
            >
              Notebook
            </Link>

            <span className="text-green-200">•</span>

            <Link
              href="/?q=celular"
              className="font-bold text-white hover:underline"
            >
              Celular
            </Link>

            <span className="text-green-200">•</span>

            <Link
              href="/?q=televisão"
              className="font-bold text-white hover:underline"
            >
              Televisão
            </Link>

            <span className="text-green-200">•</span>

            <Link
              href="/?q=air fryer"
              className="font-bold text-white hover:underline"
            >
              Air Fryer
            </Link>
          </div>

          <div className="mt-10 grid max-w-xl grid-cols-3 gap-4">
            <div>
              <p className="text-2xl font-black">100%</p>

              <p className="mt-1 text-sm text-green-100">
                Compra nas lojas
              </p>
            </div>

            <div>
              <p className="text-2xl font-black">Grátis</p>

              <p className="mt-1 text-sm text-green-100">
                Para comparar
              </p>
            </div>

            <div>
              <p className="text-2xl font-black">Seguro</p>

              <p className="mt-1 text-sm text-green-100">
                Sem venda direta
              </p>
            </div>
          </div>
        </div>

        <div className="hidden lg:block">
          <div className="rounded-3xl border border-white/20 bg-white/10 p-8 shadow-2xl backdrop-blur-md">
            <div className="rounded-2xl bg-white p-6 text-gray-900 shadow-xl">
              <p className="text-sm font-bold uppercase tracking-wide text-green-700">
                Como funciona
              </p>

              <div className="mt-6 space-y-6">
                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 font-black text-green-700">
                    1
                  </div>

                  <div>
                    <h2 className="font-black">Pesquise o produto</h2>

                    <p className="mt-1 text-sm leading-6 text-gray-600">
                      Digite o nome, marca, categoria ou loja.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 font-black text-green-700">
                    2
                  </div>

                  <div>
                    <h2 className="font-black">Compare as ofertas</h2>

                    <p className="mt-1 text-sm leading-6 text-gray-600">
                      Confira preços, descontos e condições.
                    </p>
                  </div>
                </div>

                <div className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 font-black text-green-700">
                    3
                  </div>

                  <div>
                    <h2 className="font-black">
                      Compre na loja parceira
                    </h2>

                    <p className="mt-1 text-sm leading-6 text-gray-600">
                      Finalize a compra diretamente no marketplace.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}