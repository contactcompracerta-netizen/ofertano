export default function Benefits() {
    return (
      <section className="border-y border-gray-200 bg-white">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 md:grid-cols-3">
          <article className="rounded-2xl border border-gray-100 bg-slate-50 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 text-xl">
              🔎
            </div>
  
            <h2 className="mt-5 text-lg font-black text-gray-900">
              Compare antes de comprar
            </h2>
  
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Consulte preços, descontos e condições antes de escolher uma
              oferta.
            </p>
          </article>
  
          <article className="rounded-2xl border border-gray-100 bg-slate-50 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 text-xl">
              🏪
            </div>
  
            <h2 className="mt-5 text-lg font-black text-gray-900">
              Lojas parceiras
            </h2>
  
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Os produtos são vendidos, cobrados e entregues pelos próprios
              marketplaces.
            </p>
          </article>
  
          <article className="rounded-2xl border border-gray-100 bg-slate-50 p-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-green-100 text-xl">
              🛡️
            </div>
  
            <h2 className="mt-5 text-lg font-black text-gray-900">
              Transparência e segurança
            </h2>
  
            <p className="mt-2 text-sm leading-6 text-gray-600">
              O Ofertano não recebe pagamentos e não realiza vendas diretamente.
            </p>
          </article>
        </div>
      </section>
    );
  }