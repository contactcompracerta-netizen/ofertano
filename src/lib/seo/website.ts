import { SITE_URL } from "./site";

/*
 * JSON-LD do WebSite para a Home.
 *
 * A busca pública do Ofertano usa o formulário GET com ?q= apontado para
 * "/" (ver Header e Hero). SearchAction reflete esse comportamento real:
 * https://ofertano.vercel.app/?q={search_term_string}
 *
 * Não registra Organization nem dados empresariais não confirmados.
 */
export function buildWebSiteStructuredData(): object {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Ofertano",
    url: SITE_URL + "/",
    inLanguage: "pt-BR",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE_URL}/?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}