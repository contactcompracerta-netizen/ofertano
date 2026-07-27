import Link from "next/link";

export default function Hero() {
  return (
    <section className="bg-gradient-to-r from-gray-900 via-gray-800 to-green-700">

      <div className="mx-auto grid max-w-7xl items-center gap-16 px-6 py-20 lg:grid-cols-2">

        {/* Texto */}
        <div>

          <span className="rounded-full bg-green-500 px-4 py-2 text-sm font-bold text-white">
            🔥 Ofertas Atualizadas Todos os Dias
          </span>

          <h1 className="mt-8 text-5xl font-extrabold leading-tight text-white lg:text-6xl">
            Encontre o menor preço antes de comprar.
          </h1>

          <p className="mt-6 text-xl text-gray-300">
            Compare ofertas do Mercado Livre e compre com segurança, rapidez e economia.
          </p>

          <div className="mt-10 flex gap-4">

            <Link
              href="#ofertas"
              className="rounded-xl bg-green-600 px-8 py-4 font-bold text-white transition hover:bg-green-700"
            >
              Ver Ofertas
            </Link>

            <Link
              href="/categoria"
              className="rounded-xl border border-white px-8 py-4 font-bold text-white transition hover:bg-white hover:text-black"
            >
              Categorias
            </Link>

          </div>

          <div className="mt-12 flex gap-10 text-white">

            <div>
              <p className="text-4xl font-extrabold">1000+</p>
              <span className="text-gray-300">Produtos</span>
            </div>

            <div>
              <p className="text-4xl font-extrabold">24h</p>
              <span className="text-gray-300">Atualizações</span>
            </div>

            <div>
              <p className="text-4xl font-extrabold">100%</p>
              <span className="text-gray-300">Seguro</span>
            </div>

          </div>

        </div>

        {/* Imagem */}
        <div className="flex justify-center">

          <img
            src="/hero.png"
            alt="Compra Certa"
            className="max-h-[500px] w-full object-contain"
          />

        </div>

      </div>

    </section>
  );
}