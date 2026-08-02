import Link from "next/link";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata = {
  title: "Termos de Uso | Ofertano",
  description:
    "Consulte os Termos de Uso do Ofertano e entenda como funciona nossa plataforma de comparação de preços e ofertas.",
};

export default function TermosPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <Header />

      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-14 sm:py-16">
          <span className="text-sm font-black uppercase tracking-[0.14em] text-emerald-700">
            Informações legais
          </span>

          <h1 className="mt-3 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">
            Termos de Uso
          </h1>

          <p className="mt-5 max-w-3xl text-base leading-7 text-slate-600 sm:text-lg">
            Estes Termos de Uso estabelecem as regras para acesso e
            utilização do Ofertano, uma plataforma de comparação de
            preços e divulgação de ofertas de lojas parceiras.
          </p>

          <p className="mt-4 text-sm font-semibold text-slate-500">
            Última atualização: 2 de agosto de 2026.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
        <div className="space-y-8">
          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-black text-slate-950">
              1. Aceitação dos termos
            </h2>

            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600 sm:text-base">
              <p>
                Ao acessar ou utilizar o Ofertano, você declara que
                leu, compreendeu e concorda com estes Termos de Uso.
              </p>

              <p>
                Caso não concorde com alguma condição apresentada
                nesta página, não utilize os serviços disponibilizados
                pelo Ofertano.
              </p>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-black text-slate-950">
              2. Sobre o Ofertano
            </h2>

            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600 sm:text-base">
              <p>
                O Ofertano é uma plataforma informativa que organiza
                produtos, preços, descontos e ofertas divulgadas por
                marketplaces e lojas parceiras.
              </p>

              <p>
                O objetivo da plataforma é ajudar o usuário a comparar
                informações antes de realizar uma compra.
              </p>

              <p>
                O Ofertano não fabrica, armazena, vende, entrega ou
                garante os produtos apresentados no site.
              </p>
            </div>
          </article>

          <article className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-2xl">
                🛡️
              </div>

              <div>
                <h2 className="text-2xl font-black text-slate-950">
                  3. O Ofertano não realiza vendas
                </h2>

                <div className="mt-4 space-y-4 text-sm leading-7 text-slate-700 sm:text-base">
                  <p>
                    Todas as compras são concluídas diretamente nos
                    sites ou aplicativos das lojas parceiras, como
                    Mercado Livre, Amazon e Shopee.
                  </p>

                  <p>
                    O Ofertano não recebe pagamentos, não solicita
                    transferências, não processa cartões e não realiza
                    cobranças por WhatsApp, redes sociais ou outros
                    canais.
                  </p>

                  <p>
                    Pagamento, entrega, troca, devolução, garantia,
                    atendimento e suporte são de responsabilidade da
                    loja onde a compra foi efetivamente realizada.
                  </p>
                </div>
              </div>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-black text-slate-950">
              4. Preços e disponibilidade
            </h2>

            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600 sm:text-base">
              <p>
                Os preços, descontos, condições de pagamento,
                disponibilidade de estoque, frete e prazo de entrega
                podem ser alterados pelas lojas parceiras a qualquer
                momento.
              </p>

              <p>
                Embora o Ofertano busque manter as informações
                atualizadas, podem existir diferenças entre os dados
                exibidos na plataforma e os dados apresentados pela
                loja no momento da compra.
              </p>

              <p>
                O preço válido será sempre aquele informado pela loja
                parceira antes da conclusão do pedido.
              </p>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-black text-slate-950">
              5. Links de afiliados
            </h2>

            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600 sm:text-base">
              <p>
                Alguns links disponibilizados no Ofertano podem ser
                links de afiliados.
              </p>

              <p>
                Isso significa que o Ofertano poderá receber uma
                comissão quando o usuário acessar uma loja parceira e
                realizar uma compra elegível.
              </p>

              <p>
                O uso de links de afiliados não gera cobrança adicional
                ao usuário e não altera o preço definido pela loja.
              </p>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-black text-slate-950">
              6. Responsabilidades do usuário
            </h2>

            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600 sm:text-base">
              <p>Ao utilizar o Ofertano, o usuário concorda em:</p>

              <ul className="list-disc space-y-2 pl-6">
                <li>
                  Verificar o preço e as condições diretamente na loja
                  antes de finalizar a compra.
                </li>

                <li>
                  Conferir a reputação do vendedor, prazo de entrega,
                  garantia e política de devolução.
                </li>

                <li>
                  Não utilizar a plataforma para atividades ilegais,
                  fraudulentas ou que prejudiquem terceiros.
                </li>

                <li>
                  Não tentar invadir, prejudicar, sobrecarregar ou
                  interferir no funcionamento do site.
                </li>

                <li>
                  Manter seus dispositivos e dados de acesso
                  protegidos.
                </li>
              </ul>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-black text-slate-950">
              7. Conteúdo e propriedade intelectual
            </h2>

            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600 sm:text-base">
              <p>
                A marca Ofertano, o layout, os textos institucionais, a
                identidade visual e os elementos próprios da
                plataforma são protegidos pela legislação aplicável.
              </p>

              <p>
                Marcas, nomes, imagens, descrições e informações de
                produtos pertencem aos respectivos fabricantes,
                vendedores ou marketplaces.
              </p>

              <p>
                É proibida a reprodução, cópia, distribuição ou
                exploração comercial do conteúdo próprio do Ofertano
                sem autorização prévia.
              </p>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-black text-slate-950">
              8. Sites de terceiros
            </h2>

            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600 sm:text-base">
              <p>
                O Ofertano possui links que direcionam o usuário para
                páginas externas administradas por terceiros.
              </p>

              <p>
                Após acessar uma loja parceira, o usuário estará sujeito
                aos termos de uso, políticas de privacidade, regras de
                pagamento e demais condições daquela empresa.
              </p>

              <p>
                O Ofertano não controla e não se responsabiliza pelo
                funcionamento, conteúdo, segurança ou práticas dos
                sites externos.
              </p>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-black text-slate-950">
              9. Limitação de responsabilidade
            </h2>

            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600 sm:text-base">
              <p>
                O Ofertano não se responsabiliza por prejuízos causados
                por alterações de preço, indisponibilidade de produtos,
                cancelamentos, atrasos, defeitos, fraudes de terceiros
                ou problemas ocorridos durante uma compra externa.
              </p>

              <p>
                A decisão de compra é de responsabilidade exclusiva do
                usuário.
              </p>

              <p>
                O usuário deve sempre verificar todas as informações na
                página oficial da loja antes de efetuar o pagamento.
              </p>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-black text-slate-950">
              10. Privacidade e dados pessoais
            </h2>

            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600 sm:text-base">
              <p>
                O tratamento de dados pessoais e o uso de cookies são
                descritos na Política de Privacidade do Ofertano.
              </p>

              <Link
                href="/politica-de-privacidade"
                className="inline-flex font-black text-emerald-700 transition hover:text-emerald-900"
              >
                Consultar a Política de Privacidade →
              </Link>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-black text-slate-950">
              11. Alterações nos termos
            </h2>

            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600 sm:text-base">
              <p>
                Estes Termos de Uso poderão ser atualizados sempre que
                necessário para refletir mudanças na plataforma, nos
                serviços ou na legislação.
              </p>

              <p>
                A versão atualizada será publicada nesta página com a
                respectiva data de revisão.
              </p>

              <p>
                A continuidade do uso da plataforma após uma alteração
                representa a aceitação das novas condições.
              </p>
            </div>
          </article>

          <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-black text-slate-950">
              12. Contato
            </h2>

            <div className="mt-4 space-y-4 text-sm leading-7 text-slate-600 sm:text-base">
              <p>
                Dúvidas relacionadas a estes Termos de Uso poderão ser
                enviadas pela página de contato.
              </p>

              <Link
                href="/contato"
                className="inline-flex rounded-xl bg-emerald-700 px-5 py-3 text-sm font-black text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-4 focus:ring-emerald-200"
              >
                Entrar em contato
              </Link>
            </div>
          </article>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-slate-950 p-6 text-center sm:flex-row sm:text-left">
          <div>
            <h2 className="text-xl font-black text-white">
              Continue comparando com segurança
            </h2>

            <p className="mt-2 text-sm leading-6 text-slate-400">
              Consulte as ofertas e finalize suas compras somente nas
              lojas parceiras.
            </p>
          </div>

          <Link
            href="/ofertas"
            className="inline-flex shrink-0 rounded-xl bg-emerald-500 px-6 py-3 text-sm font-black text-slate-950 transition hover:bg-emerald-400"
          >
            Ver ofertas
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}