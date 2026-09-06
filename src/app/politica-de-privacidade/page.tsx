import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description:
    "Consulte a Política de Privacidade do Ofertano e entenda como as informações relacionadas ao uso da plataforma podem ser tratadas.",
  alternates: {
    canonical: "/politica-de-privacidade",
  },
  openGraph: {
    type: "website",
    url: "/politica-de-privacidade",
    title: "Política de Privacidade | Ofertano",
    description:
      "Consulte a Política de Privacidade do Ofertano e entenda como as informações relacionadas ao uso da plataforma podem ser tratadas.",
  },
};

export default function PoliticaDePrivacidadePage() {
  return (
    <main className="min-h-screen bg-slate-50">
      <Header />

      <section className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-16">
          <p className="text-sm font-black uppercase tracking-widest text-green-700">
            Informações legais
          </p>

          <h1 className="mt-3 text-4xl font-black tracking-tight text-gray-900 sm:text-5xl">
            Política de Privacidade
          </h1>

          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-600">
            Esta política explica como o Ofertano poderá coletar, utilizar e
            proteger informações relacionadas ao uso da plataforma.
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
              1. Sobre o Ofertano
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              O Ofertano é uma plataforma de descoberta e comparação de
              ofertas. Os produtos exibidos são vendidos por lojas e
              marketplaces parceiros.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              O Ofertano não processa pagamentos, não armazena dados de cartão
              e não conclui vendas diretamente em sua plataforma.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              2. Informações que poderão ser coletadas
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              Dependendo dos recursos utilizados no site, poderão ser coletadas
              informações como:
            </p>

            <ul className="mt-4 list-disc space-y-3 pl-6 leading-7 text-gray-600">
              <li>termos pesquisados dentro da plataforma;</li>
              <li>páginas, produtos e ofertas acessados;</li>
              <li>informações técnicas do navegador e do dispositivo;</li>
              <li>endereço IP e dados aproximados de localização;</li>
              <li>dados fornecidos voluntariamente em formulários;</li>
              <li>informações de navegação coletadas por cookies.</li>
            </ul>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              3. Uso das informações
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              As informações poderão ser utilizadas para:
            </p>

            <ul className="mt-4 list-disc space-y-3 pl-6 leading-7 text-gray-600">
              <li>manter e melhorar o funcionamento do site;</li>
              <li>aprimorar a pesquisa e a exibição de ofertas;</li>
              <li>identificar erros, abusos e riscos de segurança;</li>
              <li>produzir estatísticas de utilização da plataforma;</li>
              <li>responder mensagens enviadas pelos usuários;</li>
              <li>cumprir obrigações legais e regulatórias.</li>
            </ul>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              4. Cookies e tecnologias semelhantes
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              O site poderá utilizar cookies para lembrar preferências,
              analisar o tráfego, medir o desempenho de páginas e entender como
              os visitantes utilizam a plataforma.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              O usuário poderá controlar ou bloquear cookies pelas
              configurações do navegador. Alguns recursos poderão não funcionar
              corretamente quando determinados cookies forem desativados.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              5. Links de afiliados e lojas parceiras
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              Alguns links do Ofertano poderão ser links de afiliados. Quando
              uma compra é realizada por meio desses links, o Ofertano poderá
              receber uma comissão, sem custo adicional para o usuário.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              Ao acessar uma loja parceira, o usuário estará sujeito às
              políticas de privacidade, termos e práticas do respectivo
              marketplace.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              6. Compartilhamento de informações
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              O Ofertano poderá utilizar prestadores de serviços responsáveis
              por hospedagem, análise de tráfego, segurança, comunicação e
              infraestrutura técnica.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              Informações também poderão ser disponibilizadas quando exigidas
              por lei, ordem judicial ou autoridade competente.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              7. Armazenamento e segurança
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              Serão adotadas medidas técnicas e administrativas razoáveis para
              proteger as informações contra acesso não autorizado, alteração,
              perda ou divulgação indevida.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              Nenhum sistema é completamente invulnerável. Por isso, não é
              possível garantir segurança absoluta na transmissão ou no
              armazenamento de informações.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              8. Direitos do usuário
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              O usuário poderá solicitar informações sobre seus dados,
              correção, exclusão ou esclarecimentos sobre o tratamento realizado
              pelo Ofertano, quando aplicável.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              Solicitações poderão ser enviadas pela página de contato da
              plataforma.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              9. Alterações nesta política
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              Esta política poderá ser atualizada para refletir mudanças na
              plataforma, na legislação ou nos serviços utilizados.
            </p>

            <p className="mt-4 leading-7 text-gray-600">
              A data de atualização será informada no início desta página.
            </p>
          </section>

          <section className="border-t border-gray-200 pt-8">
            <h2 className="text-2xl font-black text-gray-900">
              10. Contato
            </h2>

            <p className="mt-4 leading-7 text-gray-600">
              Dúvidas relacionadas a esta política poderão ser enviadas pela
              página de contato do Ofertano.
            </p>
          </section>
        </div>
      </section>

      <Footer />
    </main>
  );
}