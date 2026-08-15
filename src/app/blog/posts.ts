export type BlogPostSection = {
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

export type BlogPost = {
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  publishedAt: string;
  publishedLabel: string;
  readingTime: string;
  theme: "emerald" | "blue" | "amber" | "violet" | "rose" | "cyan";
  featured?: boolean;
  sections: BlogPostSection[];
};

export const blogPosts: BlogPost[] = [
  {
    slug: "como-comparar-precos-antes-de-comprar",
    title: "Como comparar preços de verdade antes de comprar",
    excerpt:
      "Um método simples para conferir o mesmo produto em lojas diferentes, entender o preço final e evitar uma decisão apressada.",
    category: "Guia de compra",
    publishedAt: "2026-08-15T09:00:00-03:00",
    publishedLabel: "15 de agosto de 2026",
    readingTime: "6 min de leitura",
    theme: "emerald",
    featured: true,
    sections: [
      {
        title: "Comece pelo produto exato",
        paragraphs: [
          "Comparar preços só funciona quando as ofertas são realmente do mesmo produto. Nome parecido não basta: modelo, capacidade, tamanho, cor e versão podem alterar bastante o valor.",
          "Antes de olhar o preço, anote as características que não podem mudar. Em um celular, por exemplo, confirme o modelo completo, a memória e a versão. Em um eletrodoméstico, confira a voltagem e a capacidade.",
        ],
        bullets: [
          "Modelo e código do fabricante",
          "Capacidade, tamanho ou quantidade",
          "Cor e versão quando influenciarem no preço",
          "Voltagem e itens incluídos na embalagem",
        ],
      },
      {
        title: "Compare o valor total da compra",
        paragraphs: [
          "O menor número na tela nem sempre representa o menor custo. Frete, prazo, juros do parcelamento e cupons podem mudar o resultado no fechamento do pedido.",
          "Faça a comparação usando o valor que realmente será pago. Se a diferença for pequena, entrega mais rápida, vendedor confiável e uma política de devolução clara podem valer mais do que alguns reais de economia.",
        ],
      },
      {
        title: "Use o histórico a seu favor",
        paragraphs: [
          "Uma oferta parece melhor quando sabemos quanto o produto custava antes. O histórico ajuda a diferenciar uma queda real de preço de um desconto apenas aparente.",
          "No Ofertano, a proposta é reunir ofertas equivalentes e acompanhar mudanças para deixar essa decisão mais transparente. Ainda assim, confirme sempre as condições na página da loja antes de finalizar.",
        ],
      },
    ],
  },
  {
    slug: "preco-baixo-ou-falsa-promocao",
    title: "Preço baixo ou falsa promoção? 7 sinais para conferir",
    excerpt:
      "Aprenda a identificar descontos pouco claros, páginas suspeitas e condições que transformam uma suposta oferta em dor de cabeça.",
    category: "Compra segura",
    publishedAt: "2026-08-14T10:00:00-03:00",
    publishedLabel: "14 de agosto de 2026",
    readingTime: "5 min de leitura",
    theme: "amber",
    sections: [
      {
        title: "Desconfie da urgência exagerada",
        paragraphs: [
          "Contadores que reiniciam, mensagens de última unidade e descontos grandes demais são recursos usados para acelerar a decisão. Uma boa oferta continua sendo boa depois de alguns minutos de verificação.",
        ],
        bullets: [
          "Confira o endereço e o domínio da loja",
          "Pesquise a reputação do vendedor",
          "Compare o preço em outras lojas",
          "Leia as regras do cupom e do frete",
          "Confirme se o produto é novo, usado ou recondicionado",
          "Evite pagamento fora da plataforma",
          "Guarde comprovantes e detalhes do anúncio",
        ],
      },
      {
        title: "O preço precisa fazer sentido",
        paragraphs: [
          "Uma diferença moderada pode acontecer por estoque, campanha ou condição de pagamento. Já um valor muito abaixo de todo o mercado merece atenção redobrada.",
          "O Ofertano direciona a compra para lojas parceiras. A venda e o pagamento acontecem sempre no ambiente da própria loja, nunca dentro do comparador.",
        ],
      },
    ],
  },
  {
    slug: "quando-esperar-uma-queda-de-preco",
    title: "Quando vale a pena esperar uma queda de preço?",
    excerpt:
      "Veja quando comprar agora faz sentido e quando acompanhar o histórico pode trazer uma economia melhor.",
    category: "Economia",
    publishedAt: "2026-08-13T11:00:00-03:00",
    publishedLabel: "13 de agosto de 2026",
    readingTime: "4 min de leitura",
    theme: "blue",
    sections: [
      {
        title: "Urgência e economia precisam estar equilibradas",
        paragraphs: [
          "Se o produto resolve uma necessidade imediata, esperar semanas por uma redução pequena pode não compensar. Quando a compra não é urgente, acompanhar o preço ajuda a escolher um momento melhor.",
          "Produtos recém-lançados costumam cair depois dos primeiros meses. Modelos em troca de geração também podem receber descontos quando o varejo começa a renovar o estoque.",
        ],
      },
      {
        title: "Defina um preço-alvo realista",
        paragraphs: [
          "Em vez de esperar por um desconto indefinido, estabeleça quanto você considera justo pagar. Use preços anteriores e valores de modelos equivalentes como referência.",
        ],
        bullets: [
          "Determine o valor máximo do seu orçamento",
          "Observe o menor preço recente",
          "Considere frete e parcelamento",
          "Revise o alvo se o mercado mudar",
        ],
      },
    ],
  },
  {
    slug: "como-escolher-o-mesmo-modelo-em-lojas-diferentes",
    title: "Como reconhecer o mesmo modelo em lojas diferentes",
    excerpt:
      "Nomes de anúncios mudam bastante. Saiba quais informações confirmam que duas ofertas podem ser comparadas.",
    category: "Comparativos",
    publishedAt: "2026-08-12T09:30:00-03:00",
    publishedLabel: "12 de agosto de 2026",
    readingTime: "6 min de leitura",
    theme: "violet",
    sections: [
      {
        title: "O título do anúncio não é suficiente",
        paragraphs: [
          "Cada marketplace organiza o nome do produto de uma forma. Uma loja destaca a marca, outra começa pelo modelo e uma terceira inclui recursos promocionais no título.",
          "O código do modelo é a referência mais segura. Quando ele não aparece, compare ficha técnica, imagens, capacidade, dimensões e os acessórios incluídos.",
        ],
      },
      {
        title: "Cuidado com acessórios e variações",
        paragraphs: [
          "Capas, suportes, peças de reposição e kits podem usar o nome completo do aparelho compatível. Isso faz com que apareçam em buscas pelo produto principal.",
          "Também confira palavras como Pro, Max, Plus, Ultra e Lite. Elas normalmente indicam versões diferentes, mesmo quando o restante do nome é igual.",
        ],
      },
    ],
  },
  {
    slug: "frete-parcelamento-e-cashback",
    title: "Frete, parcelamento e cashback: qual oferta vence?",
    excerpt:
      "Entenda como comparar benefícios diferentes sem perder de vista o custo real da compra.",
    category: "Guia de compra",
    publishedAt: "2026-08-11T14:00:00-03:00",
    publishedLabel: "11 de agosto de 2026",
    readingTime: "5 min de leitura",
    theme: "cyan",
    sections: [
      {
        title: "Transforme tudo em custo final",
        paragraphs: [
          "Some o preço do produto, o frete e eventuais juros. Depois desconte apenas benefícios que você realmente conseguirá usar, como um cashback com regras claras.",
          "Parcelamento sem juros pode ser útil, mas não deve esconder um preço à vista muito mais alto. Compare as duas condições antes de decidir.",
        ],
      },
      {
        title: "Prazo também tem valor",
        paragraphs: [
          "Uma entrega rápida pode justificar uma pequena diferença quando existe urgência. Para compras planejadas, um prazo maior pode ser aceitável se a economia for relevante e a loja for confiável.",
        ],
      },
    ],
  },
  {
    slug: "checklist-para-comprar-em-marketplaces",
    title: "Checklist para comprar com segurança em marketplaces",
    excerpt:
      "Uma verificação rápida do vendedor, anúncio, entrega e devolução antes de confirmar o pagamento.",
    category: "Compra segura",
    publishedAt: "2026-08-10T08:30:00-03:00",
    publishedLabel: "10 de agosto de 2026",
    readingTime: "5 min de leitura",
    theme: "rose",
    sections: [
      {
        title: "Confira quem está vendendo",
        paragraphs: [
          "Dentro de um marketplace, produtos iguais podem ser oferecidos por vendedores diferentes. Observe avaliações recentes, volume de vendas, tempo de atividade e a clareza das informações.",
        ],
        bullets: [
          "Reputação e avaliações recentes",
          "Descrição completa do produto",
          "Nota fiscal e garantia",
          "Prazo e modalidade de entrega",
          "Política de troca e devolução",
        ],
      },
      {
        title: "Finalize sempre dentro da plataforma",
        paragraphs: [
          "Não aceite propostas para pagar por mensagem, transferência direta ou outro site. Manter todo o processo dentro do marketplace preserva as proteções oferecidas pela plataforma.",
        ],
      },
    ],
  },
];

export function encontrarPostPorSlug(
  slug: string,
): BlogPost | undefined {
  return blogPosts.find(
    (post) => post.slug === slug,
  );
}
