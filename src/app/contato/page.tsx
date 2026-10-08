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
    <main className="of-page">
      <Header />

      <section className="of-page-intro">
        <div className="of-page-intro__inner">
          <p className="of-eyebrow">
            Fale com o Ofertano
          </p>

          <h1 className="of-page-title">
            Contato
          </h1>

          <p className="of-page-lead max-w-3xl">
            Use esta página para entrar em contato sobre informações do site,
            problemas com links, correções de produtos ou assuntos comerciais.
          </p>
        </div>
      </section>

      <section className="of-section max-w-[1120px]">
        <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr] lg:gap-5">
          <div className="space-y-4">
            <article className="of-card of-card-pad">
              <div className="of-icon-tile bg-emerald-50 text-lg">
                ✉️
              </div>

              <h2 className="mt-3 of-card-title">
                Atendimento
              </h2>

              <p className="mt-2 of-body">
                Envie sua mensagem pelo formulário. O canal poderá ser usado
                para dúvidas, sugestões e solicitações relacionadas ao Ofertano.
              </p>
            </article>

            <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
              <div className="of-icon-tile bg-amber-100 text-lg">
                🛡️
              </div>

              <h2 className="mt-3 of-card-title">
                Problemas com compras
              </h2>

              <p className="mt-2 text-sm leading-6 text-slate-700">
                Pagamento, entrega, troca, devolução e garantia devem ser
                tratados diretamente com a loja onde a compra foi realizada.
              </p>
            </article>
          </div>

          <div className="of-card p-5 sm:p-6">
            <h2 className="of-section-title">
              Envie uma mensagem
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-600">
              O formulário visual já ficará pronto. O envio será conectado a um
              serviço de e-mail em uma etapa futura.
            </p>

            <form className="mt-5 space-y-4">
              <div>
                <label
                  htmlFor="nome"
                  className="mb-1.5 block text-sm font-bold text-slate-700"
                >
                  Nome
                </label>

                <input
                  id="nome"
                  name="nome"
                  type="text"
                  placeholder="Digite seu nome"
                  className="of-control w-full border border-slate-300 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                />
              </div>

              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-sm font-bold text-slate-700"
                >
                  E-mail
                </label>

                <input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="Digite seu e-mail"
                  className="of-control w-full border border-slate-300 bg-white px-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                />
              </div>

              <div>
                <label
                  htmlFor="assunto"
                  className="mb-1.5 block text-sm font-bold text-slate-700"
                >
                  Assunto
                </label>

                <select
                  id="assunto"
                  name="assunto"
                  defaultValue=""
                  className="of-control w-full border border-slate-300 bg-white px-3.5 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
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
                  className="mb-1.5 block text-sm font-bold text-slate-700"
                >
                  Mensagem
                </label>

                <textarea
                  id="mensagem"
                  name="mensagem"
                  rows={6}
                  placeholder="Escreva sua mensagem"
                  className="w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                />
              </div>

              <button
                type="button"
                className="of-control w-full bg-[#087A55] px-5 text-sm font-black text-white transition hover:bg-[#066747]"
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