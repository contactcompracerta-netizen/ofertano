import Header from "@/components/Header";
import Footer from "@/components/Footer";

export default function TermosPage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <Header />

      <section className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <p className="text-sm font-black uppercase tracking-widest text-green-700">
            Informações legais
          </p>

          <h1 className="mt-3 text-4xl font-black tracking-tight text-gray-900 sm:text-5xl">
            Termos de Uso
          </h1>

          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-600">
            Estes termos estabelecem as condições para utilização do Ofertano,
            incluindo o acesso a produtos, ofertas, links e conteúdos
            disponibilizados na plataforma.
          </p>

          <p className="mt-4 text-sm font-semibold text-gray-500">
            Última atualização: 1º de agosto de 2026
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16">
        <div className="space-y-8 rounded-3xl border border-gray-200 bg-white p-7 shadow-sm sm:p-10">
          <section>
            <h2 className="text-2xl font-black text-gray-900">
              1. Aceitação dos termos
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              Ao acessar ou utilizar o Ofertano, o usuário declara que leu,
              compreendeu e concorda com estes Termos de Uso e com a Política de
              Privacidade da plataforma.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              Caso não concorde com alguma condição, o usuário deverá
              interromper o uso do site.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              2. Finalidade do Ofertano
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              O Ofertano é uma plataforma de descoberta, organização e
              comparação de ofertas disponibilizadas por lojas e marketplaces
              parceiros.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              A plataforma poderá apresentar preços, descontos, imagens,
              descrições, avaliações, condições de parcelamento e outras
              informações relacionadas aos produtos.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              3. O Ofertano não realiza vendas
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              O Ofertano não fabrica, armazena, comercializa, envia ou entrega
              produtos.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              O pagamento, a confirmação do pedido, a entrega, a troca, a
              devolução, a garantia e o atendimento pós-venda são realizados
              diretamente pela loja ou marketplace responsável pela oferta.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              4. Preços e disponibilidade
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              Os preços, descontos, estoques, prazos de entrega, condições de
              parcelamento e demais informações poderão ser alterados pelas
              lojas parceiras a qualquer momento.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              O usuário deverá confirmar todas as condições diretamente na
              página oficial da loja antes de concluir a compra.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              5. Links externos
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              O Ofertano poderá direcionar o usuário para sites, aplicativos e
              páginas de terceiros.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              O acesso a esses ambientes estará sujeito aos termos, políticas,
              práticas de segurança e regras da respectiva loja ou serviço.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              6. Links de afiliados
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              Alguns links exibidos no Ofertano poderão ser links de afiliados.
              Quando o usuário realiza uma compra por meio desses links, o
              Ofertano poderá receber uma comissão.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              Essa comissão não representa cobrança adicional ao usuário e não
              altera o preço definido pela loja parceira.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              7. Uso adequado da plataforma
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              Ao utilizar o Ofertano, o usuário concorda em não:
            </p>

            <ul className="mt-4 list-disc space-y-3 pl-6 leading-7 text-gray-600">
              <li>utilizar o site para atividades ilegais ou fraudulentas;</li>
              <li>tentar acessar áreas restritas ou sistemas internos;</li>
              <li>interferir no funcionamento, na segurança ou no desempenho;</li>
              <li>copiar ou explorar conteúdo de forma não autorizada;</li>
              <li>distribuir códigos maliciosos ou realizar ataques;</li>
              <li>fornecer informações falsas em formulários.</li>
            </ul>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              8. Conteúdo da plataforma
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              Textos, identidade visual, organização, componentes, marca e
              demais elementos próprios do Ofertano não poderão ser
              reproduzidos ou utilizados indevidamente.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              Imagens, marcas, nomes e descrições de produtos poderão pertencer
              aos respectivos fabricantes, vendedores ou marketplaces.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              9. Limitação de responsabilidade
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              O Ofertano busca apresentar informações úteis e atualizadas, mas
              não garante que todos os dados estejam permanentemente corretos,
              completos ou disponíveis.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              O Ofertano não se responsabiliza por alterações de preços,
              cancelamentos, indisponibilidade de estoque, atrasos, defeitos,
              falhas de entrega ou problemas ocorridos no ambiente das lojas
              parceiras.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              10. Segurança
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              O Ofertano não solicita pagamentos por Pix, depósito,
              transferência bancária, WhatsApp, Instagram, Facebook ou outros
              canais externos.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              O usuário deverá concluir a compra apenas no site ou aplicativo
              oficial da loja parceira.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              11. Suspensão ou alteração de recursos
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              O Ofertano poderá modificar, suspender ou descontinuar recursos,
              páginas, produtos, ofertas ou funcionalidades sem aviso prévio,
              quando necessário.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              12. Alterações nos termos
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              Estes termos poderão ser atualizados para refletir mudanças na
              plataforma, nos serviços utilizados ou na legislação aplicável.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              A versão mais recente permanecerá disponível nesta página com a
              respectiva data de atualização.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              13. Contato
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              Dúvidas relacionadas a estes Termos de Uso poderão ser enviadas
              por meio da página de contato do Ofertano.
            </p>
          </section>
        </div>
      </section>

      <Footer />
    </main>
  );
}