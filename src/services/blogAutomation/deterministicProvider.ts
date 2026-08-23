import { criarEspecificacaoDeCapa } from "./cover";
import { ctaPadraoEditorial, sugerirLinksInternos } from "./links";
import { descreverProdutoEditorial } from "./products";
import {
  intencaoDeBuscaDoObjetivo,
  limitarMetaDescription,
  limitarSeoTitle,
} from "./seo";
import { criarSlugEditorial } from "./slug";
import {
  hashtagsDaPauta,
  montarLegendaFacebook,
  NOTA_LINK_INSTAGRAM,
} from "./social";
import type {
  EditorialFaqItem,
  NormalizedEditorialInput,
  SanitizedEditorialProduct,
} from "./types";
import type { EditorialAiProvider } from "./provider";

function tituloDoArtigo(
  input: NormalizedEditorialInput,
): string {
  const topic = input.topic;
  const year = String(input.year);
  const jaTemAno = topic.includes(year);

  if (
    topic.length >= 18 &&
    (topic.split(" ").length >= 5 || /[?:]/.test(topic))
  ) {
    return jaTemAno ? topic : `${topic} em ${year}`;
  }

  switch (input.objective) {
    case "melhores":
      return jaTemAno
        ? topic
        : `Melhores opções de ${topic} para ${year}`;
    case "comparativo":
    case "diferencas":
      return topic.includes(" ou ") || topic.includes(" vs")
        ? topic
        : `${topic}: o que muda na prática`;
    case "custo_beneficio":
      return `Como avaliar o custo-benefício de ${topic}`;
    case "como_escolher":
      return `Como escolher ${topic} sem gastar além da conta`;
    case "economia":
      return `Quando vale esperar uma queda de preço em ${topic}`;
    case "faq":
      return `Dúvidas frequentes antes de comprar ${topic}`;
    case "lista":
      return `Checklist para comparar ${topic} com segurança`;
    case "tendencia":
      return `O que observa em ${topic} em ${year}`;
    default:
      return `Guia de compra: ${topic}`;
  }
}

function resumoDoArtigo(
  input: NormalizedEditorialInput,
  title: string,
): string {
  if (input.products.length > 0) {
    return `Um guia objetivo para avaliar ${title.toLocaleLowerCase("pt-BR")} com base nos produtos informados, nos critérios que realmente mudam o uso e na comparação de ofertas no Ofertano.`;
  }

  return `Um guia objetivo para avaliar ${title.toLocaleLowerCase("pt-BR")} pelos critérios certos, sem inventar modelo, preço ou ranking. No fim, o Ofertano ajuda a comparar ofertas equivalentes.`;
}

function paragrafoProdutos(
  products: SanitizedEditorialProduct[],
): string {
  if (products.length === 0) {
    return "Neste guia não há uma lista fechada de modelos. Por isso, o texto não inventa ranking, preço ou ficha técnica. Use os critérios abaixo e compare no Ofertano só as ofertas que forem realmente do mesmo produto.";
  }

  if (products.length === 1) {
    return `O ponto de partida desta pauta é ${descreverProdutoEditorial(products[0]!)}. Qualquer outro modelo só entra na comparação se a ficha confirmar que é o mesmo produto, não apenas um nome parecido.`;
  }

  const nomes = products
    .map((product) => descreverProdutoEditorial(product))
    .join("; ");

  return `Os produtos usados nesta pauta são: ${nomes}. A comparação abaixo usa somente esses itens e os dados que vieram com eles. Se preço ou loja não aparecem, é porque essa informação não foi informada.`;
}

function faqDoObjetivo(
  input: NormalizedEditorialInput,
): EditorialFaqItem[] {
  const produtos =
    input.products.length > 0
      ? "os produtos informados nesta pauta"
      : "ofertas equivalentes no Ofertano";

  return [
    {
      question: `O menor preço resolve a escolha de ${input.topic}?`,
      answer:
        "Não. Preço baixo só é vantagem quando o modelo, a capacidade, a garantia e o custo final batem. Compare o valor à vista, o frete e o que vem na caixa antes de decidir.",
    },
    {
      question: "Posso comparar anúncios só pelo título?",
      answer:
        "Não. Título de marketplace muda o tempo todo. Confirme modelo, versão e itens inclusos. Só então compare as lojas.",
    },
    {
      question: "Onde conferir as ofertas depois de ler o guia?",
      answer: `No Ofertano. Depois de definir o critério, compare ${produtos} e abra a loja somente quando a oferta for do item certo.`,
    },
  ];
}

function secoesDoArtigo(
  input: NormalizedEditorialInput,
): Array<{
  title: string;
  paragraphs: string[];
  bullets?: string[];
}> {
  const produtos = paragrafoProdutos(input.products);
  const ano = input.year;

  const contexto = input.extraContext
    ? `Contexto adicional da pauta: ${input.extraContext}`
    : "Se faltar um dado concreto, o caminho mais seguro é deixar a decisão aberta e comparar no site, em vez de completar a história com chute.";

  const base = [
    {
      title: "Comece pelo uso real, não pelo anúncio",
      paragraphs: [
        `${input.topic} só vira uma boa compra quando atende o uso do dia a dia. Antes de olhar desconto, escreva o que não pode faltar: tamanho, potência, capacidade, versão ou o problema que o produto precisa resolver.`,
        produtos,
        contexto,
      ],
    },
    {
      title: "O que realmente muda o custo-benefício",
      paragraphs: [
        `Em ${ano}, o desconto chamativo continua sendo o atalho mais comum para uma escolha ruim. Custo-benefício aparece quando o produto certo custa menos no total, não quando o anúncio grita urgência.`,
        "Some preço, frete, prazo e juros. Se a diferença entre duas ofertas for pequena, reputação da loja, nota fiscal e política de troca pesam mais do que alguns reais.",
      ],
      bullets: [
        "Confirme modelo e versão",
        "Compare o valor final, não só a vitrine",
        "Veja o que está incluso na embalagem",
        "Desconfie de queda grande demais sem histórico",
      ],
    },
    {
      title: "Como comparar no Ofertano sem se perder",
      paragraphs: [
        "Depois de fechar o critério, use o Ofertano para ver ofertas equivalentes. O papel do comparador é reduzir ruído: menos anúncio genérico e mais lado a lado do que realmente importa.",
        input.products.length > 1
          ? "Como há mais de um produto informado, não trate todos como iguais. Confira se a diferença é de geração, capacidade ou apenas de título."
          : "Se ainda não há um modelo escolhido, comece pelas ofertas da categoria e só avance quando o anúncio confirmar o mesmo produto.",
      ],
    },
  ];

  if (
    input.objective === "comparativo" ||
    input.objective === "diferencas"
  ) {
    base.splice(1, 0, {
      title: "Onde as opções costumam divergir",
      paragraphs: [
        "Comparar dois caminhos só funciona se a diferença for prática: capacidade, duração, consumo, tamanho ou o que entra na caixa. Nome parecido não basta.",
        "Se um lado ganha em preço e o outro em uso diário, descreva esse dilema com clareza. A escolha boa é a que reduz arrependimento, não a que rende um clique mais rápido.",
      ],
    });
  }

  if (input.objective === "economia") {
    base.push({
      title: "Comprar agora ou esperar",
      paragraphs: [
        "Esperar faz sentido quando a compra não é urgente e o preço atual está longe do que você considera justo. Se o produto resolve uma necessidade imediata, uma queda pequena daqui a semanas pode não compensar.",
        "Defina um preço-alvo com base no que já foi visto, não em uma promoção imaginária. Sem histórico confiável, não invente o 'melhor dia' para comprar.",
      ],
    });
  }

  return base;
}

export function criarProviderDeterministico(): EditorialAiProvider {
  return {
    kind: "deterministic",
    async gerar(input) {
      const title = tituloDoArtigo(input);
      const excerpt = resumoDoArtigo(input, title);
      const slug = criarSlugEditorial(title);
      const sections = secoesDoArtigo(input);
      const faq = faqDoObjetivo(input);
      const cta = ctaPadraoEditorial(input);
      const cover = criarEspecificacaoDeCapa({
        title,
        excerpt,
        products: input.products,
      });
      const facebook = {
        hook: `Tem gente comprando ${input.topic} no impulso. Dá para escolher com mais critério.`,
        mainBenefit:
          "O ponto não é achar o anúncio mais gritante. É confirmar o produto certo e comparar o custo final.",
        summary: excerpt,
        cta: cta.label,
        articleLinkPlaceholder: `/blog/${slug}`,
        caption: "",
      };
      facebook.caption = montarLegendaFacebook(facebook);

      const instagramCaption =
        input.products.length > 0
          ? `Antes de fechar, confira se é o mesmo modelo e o que entra no preço. Depois compare no Ofertano.`
          : `Ignore urgência falsa. Defina o que você precisa e só então compare ofertas equivalentes.`;

      return {
        blog: {
          title,
          slug,
          excerpt,
          category: input.category,
          sections,
          faq,
          cover,
        },
        seo: {
          searchIntent: intencaoDeBuscaDoObjetivo(
            input.objective,
          ),
          title: limitarSeoTitle(`${title} | Ofertano`),
          description: limitarMetaDescription(excerpt),
          relatedTerms: [
            input.category,
            "custo-benefício",
            "guia de compra",
            "comparar preços",
          ],
          internalLinks: sugerirLinksInternos({
            slug,
            category: input.category,
            products: input.products,
          }),
        },
        social: {
          facebook,
          instagram: {
            hook: `Como escolher ${input.topic} sem cair em anúncio apressado.`,
            caption: instagramCaption,
            cta: "Salve o guia e compare no Ofertano pelo link na bio.",
            hashtags: hashtagsDaPauta(
              input.topic,
              input.category,
            ),
            linkStrategy: "bio",
            linkNote: NOTA_LINK_INSTAGRAM,
          },
        },
        metadata: {
          relatedProducts: input.products,
          warnings:
            input.products.length === 0
              ? [
                  "Nenhum produto real foi informado; o texto não inventa modelos, preços ou lojas.",
                ]
              : [],
        },
      };
    },
  };
}
