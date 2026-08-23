export default function Benefits() {
  return (
    <section className="border-y border-gray-200 bg-white">
      <div className="mx-auto grid max-w-7xl gap-4 px-4 py-8 md:grid-cols-3 md:gap-8 md:py-12">
        <article className="rounded-2xl border border-gray-100 bg-slate-50 p-4 md:p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100 text-lg md:h-12 md:w-12 md:text-xl">
            🔎
          </div>

          <h2 className="mt-3 text-base font-black leading-tight text-gray-900 md:mt-5 md:text-lg">
            Compare antes de comprar
          </h2>

          <p className="mt-1.5 text-sm leading-5 text-gray-600 md:mt-2 md:leading-6">
            Consulte preços, descontos e condições antes de escolher uma oferta.
          </p>
        </article>

        <article className="rounded-2xl border border-gray-100 bg-slate-50 p-4 md:p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100 text-lg md:h-12 md:w-12 md:text-xl">
            🏪
          </div>

          <h2 className="mt-3 text-base font-black leading-tight text-gray-900 md:mt-5 md:text-lg">
            Lojas parceiras
          </h2>

          <p className="mt-1.5 text-sm leading-5 text-gray-600 md:mt-2 md:leading-6">
            Os produtos são vendidos, cobrados e entregues pelos próprios
            marketplaces.
          </p>
        </article>

        <article className="rounded-2xl border border-gray-100 bg-slate-50 p-4 md:p-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-100 text-lg md:h-12 md:w-12 md:text-xl">
            🛡️
          </div>

          <h2 className="mt-3 text-base font-black leading-tight text-gray-900 md:mt-5 md:text-lg">
            Transparência e segurança
          </h2>

          <p className="mt-1.5 text-sm leading-5 text-gray-600 md:mt-2 md:leading-6">
            O Ofertano não recebe pagamentos e não realiza vendas diretamente.
          </p>
        </article>
      </div>
    </section>
  );
}
