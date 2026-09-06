import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Contato",
  description:
    "Entre em contato com o Ofertano para dúvidas, sugestões e solicitações relacionadas à plataforma de comparação de preços.",
  alternates: {
    canonical: "/contato",
  },
  openGraph: {
    type: "website",
    url: "/contato",
    title: "Contato | Ofertano",
    description:
      "Entre em contato com o Ofertano para dúvidas, sugestões e solicitações relacionadas à plataforma de comparação de preços.",
  },
};

export default function ContatoPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <Header />

      <section className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <p className="text-sm font-black uppercase tracking-widest text-green-700">
            Fale com o Ofertano
          </p>

          <h1 className="mt-3 text-4xl font-black tracking-tight text-gray-900 sm:text-5xl">
            Contato
          </h1>

          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-600">
            Use esta página para entrar em contato sobre informações do site,
            problemas com links, correções de produtos ou assuntos comerciais.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-6">
            <article className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-100 text-2xl">
                ✉️
              </div>

              <h2 className="mt-5 text-xl font-black text-gray-900">
                Atendimento
              </h2>

              <p className="mt-3 leading-7 text-gray-600">
                Envie sua mensagem pelo formulário. O canal poderá ser usado
                para dúvidas, sugestões e solicitações relacionadas ao Ofertano.
              </p>
            </article>

            <article className="rounded-3xl border border-amber-200 bg-amber-50 p-7">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-2xl">
                🛡️
              </div>

              <h2 className="mt-5 text-xl font-black text-gray-900">
                Problemas com compras
              </h2>

              <p className="mt-3 leading-7 text-gray-700">
                Pagamento, entrega, troca, devolução e garantia devem ser
                tratados diretamente com a loja onde a compra foi realizada.
              </p>
            </article>
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-7 shadow-sm sm:p-9">
            <h2 className="text-2xl font-black text-gray-900">
              Envie uma mensagem
            </h2>

            <p className="mt-3 text-sm leading-6 text-gray-600">
              O formulário visual já ficará pronto. O envio será conectado a um
              serviço de e-mail em uma etapa futura.
            </p>

            <form className="mt-8 space-y-5">
              <div>
                <label
                  htmlFor="nome"
                  className="mb-2 block text-sm font-black text-gray-800"
                >
                  Nome
                </label>

                <input
                  id="nome"
                  name="nome"
                  type="text"
                  placeholder="Digite seu nome"
                  className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-green-500 focus:ring-4 focus:ring-green-100"
                />
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-black text-gray-800"
                >
                  E-mail
                </label>

                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="Digite seu e-mail"
                  className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-green-500 focus:ring-4 focus:ring-green-100"
                />
              </div>

              <div>
                <label
                  htmlFor="assunto"
                  className="mb-2 block text-sm font-black text-gray-800"
                >
                  Assunto
                </label>

                <select
                  id="assunto"
                  name="assunto"
                  defaultValue=""
                  className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition focus:border-green-500 focus:ring-4 focus:ring-green-100"
                >
                  <option value="" disabled>
                    Selecione um assunto
                  </option>

                  <option value="duvida">Dúvida sobre o site</option>
                  <option value="produto">Problema com produto ou link</option>
                  <option value="parceria">Parceria comercial</option>
                  <option value="sugestao">Sugestão</option>
                  <option value="outro">Outro assunto</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="mensagem"
                  className="mb-2 block text-sm font-black text-gray-800"
                >
                  Mensagem
                </label>

                <textarea
                  id="mensagem"
                  name="mensagem"
                  rows={6}
                  placeholder="Escreva sua mensagem"
                  className="w-full resize-y rounded-xl border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-green-500 focus:ring-4 focus:ring-green-100"
                />
              </div>

              <button
                type="button"
                className="w-full rounded-xl bg-green-600 px-6 py-4 font-black text-white transition hover:bg-green-700"
              >
                Enviar mensagem
              </button>

              <p className="text-center text-xs leading-5 text-gray-500">
                O envio ainda será ativado. Nesta etapa, o botão não transmite
                dados.
              </p>
            </form>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}