import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function SegurancaPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <Header />

      <section className="border-b border-amber-200 bg-amber-50">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <span className="inline-flex rounded-full bg-amber-100 px-4 py-2 text-sm font-black uppercase tracking-widest text-amber-800">
            Segurança no Ofertano
          </span>

          <h1 className="mt-5 text-4xl font-black tracking-tight text-gray-900 sm:text-5xl">
            Compre somente nas lojas parceiras
          </h1>

          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-700">
            O Ofertano ajuda você a encontrar e comparar ofertas, mas não vende
            produtos, não recebe pagamentos e não realiza entregas.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-14">
        <div className="grid gap-6 md:grid-cols-2">
          <article className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-100 text-2xl">
              🛒
            </div>

            <h2 className="mt-5 text-xl font-black text-gray-900">
              Finalize a compra no marketplace
            </h2>

            <p className="mt-3 leading-7 text-gray-600">
              Ao clicar em uma oferta, confirme que você foi direcionado para o
              site ou aplicativo oficial da loja parceira.
            </p>
          </article>

          <article className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-2xl">
              💳
            </div>

            <h2 className="mt-5 text-xl font-black text-gray-900">
              Não pague diretamente ao Ofertano
            </h2>

            <p className="mt-3 leading-7 text-gray-600">
              O Ofertano não solicita Pix, transferência bancária, depósito,
              dados de cartão ou pagamento por mensagem.
            </p>
          </article>

          <article className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-2xl">
              🔗
            </div>

            <h2 className="mt-5 text-xl font-black text-gray-900">
              Verifique o endereço da página
            </h2>

            <p className="mt-3 leading-7 text-gray-600">
              Antes de informar seus dados, confira o domínio, o cadeado de
              segurança e a identidade da loja onde a compra será concluída.
            </p>
          </article>

          <article className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 text-2xl">
              💬
            </div>

            <h2 className="mt-5 text-xl font-black text-gray-900">
              Desconfie de cobranças por mensagens
            </h2>

            <p className="mt-3 leading-7 text-gray-600">
              Não envie dinheiro para pessoas que afirmem representar o
              Ofertano por WhatsApp, Instagram, Facebook ou outros canais.
            </p>
          </article>
        </div>

        <div className="mt-10 rounded-3xl border border-amber-200 bg-amber-50 p-7">
          <h2 className="text-2xl font-black text-gray-900">
            Responsabilidade das lojas parceiras
          </h2>

          <p className="mt-4 leading-7 text-gray-700">
            Preços, estoque, parcelamento, pagamento, entrega, troca, devolução
            e garantia são definidos e administrados pela loja responsável pela
            oferta.
          </p>

          <p className="mt-4 leading-7 text-gray-700">
            As condições podem mudar após a publicação. Sempre confirme todas
            as informações na página oficial da loja antes de comprar.
          </p>
        </div>

        <div className="mt-10 text-center">
          <Link
            href="/"
            className="inline-flex rounded-xl bg-green-600 px-7 py-4 font-black text-white transition hover:bg-green-700"
          >
            Voltar para as ofertas
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}