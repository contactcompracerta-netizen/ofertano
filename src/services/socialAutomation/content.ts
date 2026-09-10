import { createHash } from "node:crypto";

import {
  formatBRL,
  summarizeText,
  toHashtag,
} from "./format";
import type {
  GeneratedSocialContent,
  ReliableProduct,
  SocialHistoryEntry,
  SocialPostData,
  SocialPostSlot,
  SocialPostType,
} from "./types";
import { SOCIAL_POST_TYPES } from "./types";
import { isEditorialPostType } from "./types";

type PricePostType = Extract<
  SocialPostType,
  "DUEL_PRICE" | "FOUND_DEAL" | "PRICE_COMPARISON"
>;

type EvergreenPostType = Extract<
  SocialPostType,
  "SAVING_TIP" | "ENGAGEMENT_QUESTION" | "SHOPPING_CURIOSITY"
>;

type EditorialPostType = Extract<
  SocialPostType,
  | "EDITORIAL_CURIOSITY"
  | "EDITORIAL_NOSTALGIA"
  | "EDITORIAL_DEBATE"
  | "EDITORIAL_HISTORY"
  | "EDITORIAL_MYSTERY"
  | "EDITORIAL_QUIZ"
>;

export type { EditorialPostType };

const PRICE_POST_TYPES = new Set<PricePostType>([
  "DUEL_PRICE",
  "FOUND_DEAL",
  "PRICE_COMPARISON",
]);

const FALLBACK_TYPES: EvergreenPostType[] = [
  "SAVING_TIP",
  "ENGAGEMENT_QUESTION",
  "SHOPPING_CURIOSITY",
];

const EDITORIAL_POST_TYPES: EditorialPostType[] = [
  "EDITORIAL_CURIOSITY",
  "EDITORIAL_NOSTALGIA",
  "EDITORIAL_DEBATE",
  "EDITORIAL_HISTORY",
  "EDITORIAL_MYSTERY",
  "EDITORIAL_QUIZ",
];

const CTA_OPTIONS = [
  "Comente: você costuma pesquisar em mais de uma loja?",
  "Salve este comparativo para consultar antes de comprar.",
  "Compartilhe com alguém que está pesquisando esse produto.",
  "Qual produto devemos comparar no próximo post?",
  "Confira antes de comprar: comparar pode fazer diferença.",
];

const SAVING_TIPS = [
  {
    headline: "Preço baixo é só o começo.",
    body: "Antes de fechar a compra, compare o valor final, o frete e o prazo de entrega.",
  },
  {
    headline: "Pesquisar primeiro vale a pena.",
    body: "O mesmo produto pode aparecer em lojas diferentes. Compare com calma antes de decidir.",
  },
  {
    headline: "Economizar começa na comparação.",
    body: "Evite comprar no impulso: confira preço, condições de entrega e reputação da loja.",
  },
  {
    headline: "Sua lista de compras agradece.",
    body: "Salve os produtos desejados e compare quando encontrar uma condição melhor.",
  },
  {
    headline: "Nem toda oferta é igual.",
    body: "Leia as condições e compare o preço entre lojas antes de concluir o pedido.",
  },
];

const ENGAGEMENT_QUESTIONS = [
  "Qual produto você quer ver comparado aqui?",
  "Você compara preços antes de comprar online?",
  "Qual loja você sempre consulta antes de fechar uma compra?",
  "O que mais pesa na sua decisão: preço, frete ou prazo?",
  "Qual foi a melhor economia que você já encontrou comparando lojas?",
];

const SHOPPING_CURIOSITIES = [
  {
    headline: "Uma boa compra começa antes do carrinho.",
    body: "Comparar lojas ajuda a enxergar condições diferentes para o mesmo produto.",
  },
  {
    headline: "Pesquisar é parte da compra inteligente.",
    body: "O preço é importante, mas frete, prazo e condições também entram na comparação.",
  },
  {
    headline: "Comparar é um hábito que rende.",
    body: "Uma busca rápida entre lojas pode mudar a sua decisão de compra.",
  },
  {
    headline: "Comprar bem é comprar informado.",
    body: "Antes de decidir, veja se existem outras lojas com condições melhores.",
  },
  {
    headline: "A compra certa pede contexto.",
    body: "Confira as opções disponíveis e escolha com mais segurança.",
  },
];

const EDITORIAL_CURIOSITY_ITEMS = [
  {
    headline: "Por que o mesmo produto tem preços tão diferentes?",
    body: "Impostos, logística, margem da loja e até o canal de venda mudam o preço final.",
  },
  {
    headline: "O segredo dos 'preços anteriores' nas ofertas.",
    body: "Muitas vezes o preço riscado nunca foi praticado. Compare o histórico real.",
  },
  {
    headline: "Frete grátis nem sempre é grátis.",
    body: "O custo do frete costuma estar embutido no preço do produto. Compare o total.",
  },
  {
    headline: "Marketplace vs loja própria: onde sai mais barato?",
    body: "O mesmo vendedor pode cobrar menos no site próprio por não pagar comissão ao marketplace.",
  },
  {
    headline: "Cupons de desconto: vale a pena caçar?",
    body: "Às vezes o cupom só funciona em itens com preço inflado. Compare o valor final.",
  },
];

const EDITORIAL_NOSTALGIA_ITEMS = [
  {
    headline: "Lembra quando pesquisar preço era ir de loja em loja?",
    body: "Hoje comparamos 50 lojas em segundos. A economia de tempo também é economia.",
  },
  {
    headline: "A primeira compra online que você fez.",
    body: "Muita coisa mudou: frete, prazo, segurança. O hábito de comparar permanece essencial.",
  },
  {
    headline: "Catálogos de papel e a espera pelo correio.",
    body: "Antes levava semanas para saber o preço. Hoje a comparação é instantânea.",
  },
  {
    headline: "Quando 'promoção' significava liquidação de verdade.",
    body: "Hoje o termo é usado o ano todo. Comparar histórico evita falsas promoções.",
  },
  {
    headline: "O vendedor que conhecia seu nome e seu orçamento.",
    body: "A tecnologia substituiu o atendimento pessoal, mas o poder de escolha ficou com você.",
  },
];

const EDITORIAL_DEBATE_ITEMS = [
  {
    headline: "Vale a pena esperar a Black Friday ou comprar agora?",
    body: "Produtos de alta rotação costumam ter preço similar o ano todo. Compare antes de esperar.",
  },
  {
    headline: "Marca famosa vs marca desconhecida: a diferença justifica o preço?",
    body: "Às vezes paga-se pelo nome, outras pela qualidade. Reviews e comparações ajudam a decidir.",
  },
  {
    headline: "Comprar no exterior sai mais barato mesmo com taxas?",
    body: "IOF, ICMS, frete internacional e tempo de entrega mudam a conta. Simule o total.",
  },
  {
    headline: "Parcelado sem juros ou à vista com desconto: o que compensa?",
    body: "Depende da taxa que seu dinheiro rende. Compare o valor total pago em cada cenário.",
  },
  {
    headline: "Fidelidade a uma loja vale a pena ou é melhor trocar sempre?",
    body: "Programas de pontos podem compensar, mas comparar garante que não está pagando a mais.",
  },
];

const EDITORIAL_HISTORY_ITEMS = [
  {
    headline: "A evolução do preço dos smartphones nos últimos 10 anos.",
    body: "O que custava um carro hoje cabe no bolso. A tecnologia barateou, mas comparar segue valendo.",
  },
  {
    headline: "Como o e-commerce mudou o varejo brasileiro.",
    body: "De desconfiança total a líder de vendas. O consumidor ganhou poder de comparação.",
  },
  {
    headline: "O fim das lojas de departamento e o rise dos marketplaces.",
    body: "A concentração em plataformas trouxe variedade, mas também exige mais atenção aos preços.",
  },
  {
    headline: "Pix, boleto, cartão: como o pagamento moldou o preço final.",
    body: "Descontos no Pix viraram padrão. Quem não compara perde a economia automática.",
  },
  {
    headline: "Da vitrine para a tela: 20 anos de transformação do varejo.",
    body: "O produto é o mesmo. A forma de comparar mudou radicalmente. Quem adapta, economiza.",
  },
];

const EDITORIAL_MYSTERY_ITEMS = [
  {
    headline: "Produto sumiu do estoque? Pode ser estratégia de preço.",
    body: "Lojas retiram itens para relançar com 'desconto' depois. Histórico de preço revela a tática.",
  },
  {
    headline: "Por que o preço muda enquanto você decide?",
    body: "Algoritmos ajustam valores em tempo real. Travar a comparação no momento da decisão evita surpresas.",
  },
  {
    headline: "O mesmo vendedor, preços diferentes no mesmo dia.",
    body: "Canais de venda (app, site, marketplace) podem ter precificação independente. Compare todos.",
  },
  {
    headline: "Frete 'grátis' que some no carrinho: o que aconteceu?",
    body: "Condições de frete mudam por CEP, valor mínimo ou cupom. Simule o checkout completo.",
  },
  {
    headline: "Avaliação 5 estrelas mas preço suspeito: golpe ou oportunidade?",
    body: "Reviews comprados existem. Compare preço, reputação da loja e histórico antes de arriscar.",
  },
];

const EDITORIAL_QUIZ_ITEMS = [
  {
    headline: "Quiz: qual desses fatores NÃO influencia o preço final?",
    body: "A) Impostos estaduais  B) Cor da embalagem  C) Margem do lojista  D) Custo de frete",
  },
  {
    headline: "Quiz: 'Menor preço' sempre significa melhor compra?",
    body: "Considere: frete, prazo, reputação, garantia, política de troca. O menor preço pode sair caro.",
  },
  {
    headline: "Quiz: o que 'preço anterior' legalmente deve representar?",
    body: "Menor preço praticado nos últimos 30 dias. Muitos ignoram a regra. Compare o histórico real.",
  },
  {
    headline: "Quiz: marketplace cobra comissão do vendedor. Quem paga no fim?",
    body: "O consumidor, via preço mais alto. Comprar direto do lojista pode sair mais barato.",
  },
  {
    headline: "Quiz: produto 'esgotado' volta ao estoque no dia seguinte. Por quê?",
    body: "Controle de estoque dinâmico ou estratégia de urgência. Histórico de disponibilidade ajuda.",
  },
];

function unique(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function postHashtags(product: ReliableProduct | null, type: SocialPostType): string[] {
  const category = product?.category ? toHashtag(product.category) : null;
  const productName = product ? toHashtag(summarizeText(product.name, 24)) : null;
  const typeTag =
    type === "SAVING_TIP"
      ? "#DicasDeEconomia"
      : type === "ENGAGEMENT_QUESTION"
        ? "#ComprasOnline"
        : type === "EDITORIAL_CURIOSITY"
          ? "#CuriosidadeDeCompra"
          : type === "EDITORIAL_NOSTALGIA"
            ? "#MemoriaDeConsumo"
            : type === "EDITORIAL_DEBATE"
              ? "#DebateDeConsumo"
              : type === "EDITORIAL_HISTORY"
                ? "#HistoriaDoVarejo"
                : type === "EDITORIAL_MYSTERY"
                  ? "#MisterioDoPreco"
                  : type === "EDITORIAL_QUIZ"
                    ? "#QuizDoConsumidor"
                    : "#CompararPrecos";

  return unique(["#Ofertano", "#Ofertas", typeTag, category, productName]).slice(0, 5);
}

function withFooter(lines: string[], hashtags: string[]): string {
  return [
    ...lines,
    "",
    "Ofertano — Compare preços antes de comprar.",
    "",
    hashtags.join(" "),
  ].join("\n");
}

function productData(product: ReliableProduct): SocialPostData["product"] {
  return {
    id: product.id,
    name: product.name,
    shortName: summarizeText(product.name, 54),
    image: product.image,
    category: product.category,
  };
}

function cta(variantIndex: number): string {
  return CTA_OPTIONS[variantIndex % CTA_OPTIONS.length];
}

export function isPricePostType(type: SocialPostType): type is PricePostType {
  return PRICE_POST_TYPES.has(type as PricePostType);
}

export function pricePostTypeForSlot(slot: SocialPostSlot): PricePostType {
  switch (slot) {
    case "MORNING":
      return "FOUND_DEAL";
    case "AFTERNOON":
      return "PRICE_COMPARISON";
    case "EVENING":
      return "DUEL_PRICE";
  }
}

export function fallbackPostTypeForSlot(
  slot: SocialPostSlot,
): EvergreenPostType {
  switch (slot) {
    case "MORNING":
      return "SAVING_TIP";
    case "AFTERNOON":
      return "SHOPPING_CURIOSITY";
    case "EVENING":
      return "ENGAGEMENT_QUESTION";
  }
}

export function prioritizeUnusedProducts(
  products: ReliableProduct[],
  usedProductIds: Set<string>,
): ReliableProduct[] {
  const unused = products.filter(
    (product) => !usedProductIds.has(product.id),
  );

  const alreadyUsed = products.filter(
    (product) => usedProductIds.has(product.id),
  );

  return [...unused, ...alreadyUsed];
}

export function nextSocialPostType(history: SocialHistoryEntry[]): SocialPostType {
  const last = history.at(0)?.type;
  if (!last) return SOCIAL_POST_TYPES[0];

  const index = SOCIAL_POST_TYPES.indexOf(last);
  return SOCIAL_POST_TYPES[(index + 1) % SOCIAL_POST_TYPES.length];
}

export function fallbackSocialPostType(nextType: SocialPostType): EvergreenPostType {
  const currentIndex = SOCIAL_POST_TYPES.indexOf(nextType);

  for (let offset = 1; offset <= SOCIAL_POST_TYPES.length; offset += 1) {
    const candidate = SOCIAL_POST_TYPES[(currentIndex + offset) % SOCIAL_POST_TYPES.length] as SocialPostType;
    if (FALLBACK_TYPES.includes(candidate as EvergreenPostType)) {
      return candidate as EvergreenPostType;
    }
  }

  return "SAVING_TIP";
}

export function variantIndexFor(type: SocialPostType, history: SocialHistoryEntry[]): number {
  return history.filter((entry) => entry.type === type).length;
}

export function hasComparablePrices(product: ReliableProduct): boolean {
  if (product.offers.length < 2) return false;

  const prices = product.offers.map((offer) => offer.price);
  return Math.max(...prices) - Math.min(...prices) > 0.009;
}

export function buildContentFingerprint(input: {
  type: SocialPostType;
  productId: string | null;
  caption: string;
  data: SocialPostData;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

function completeContent(input: Omit<GeneratedSocialContent, "fingerprint">): GeneratedSocialContent {
  return {
    ...input,
    fingerprint: buildContentFingerprint(input),
  };
}

export function buildPriceContent(
  type: PricePostType,
  product: ReliableProduct,
  variantIndex: number,
): GeneratedSocialContent {
  const offers = [...product.offers].sort((left, right) => left.price - right.price);
  const displayedOffers = offers.slice(0, 3);
  const best = offers[0];
  const highest = offers.at(-1)!;
  const savings = highest.price - best.price;
  const productLabel = summarizeText(product.name, 72);
  const action = cta(variantIndex);
  const hashtags = postHashtags(product, type);

  if (type === "FOUND_DEAL") {
    const reportedOldPrice = best.oldPrice && best.oldPrice > best.price ? best.oldPrice : null;
    const comparisonPrice = reportedOldPrice ?? highest.price;
    const comparisonLabel = reportedOldPrice
      ? "Preço anterior informado"
      : "Maior preço entre lojas";
    const actualSavings = comparisonPrice - best.price;
    const caption = withFooter(
      [
        `🔎 Achado do Ofertano: ${productLabel}`,
        "",
        `Menor preço encontrado: ${best.label} — ${formatBRL(best.price)}`,
        `${comparisonLabel}: ${formatBRL(comparisonPrice)}`,
        `Economia possível: ${formatBRL(actualSavings)}`,
        "",
        action,
      ],
      hashtags,
    );

    return completeContent({
      type,
      productId: product.id,
      caption,
      hashtags,
      data: {
        template: "FOUND_DEAL",
        eyebrow: "ACHADO DO OFERTANO",
        headline: productLabel,
        subheadline: `Menor preço na ${best.label}`,
        cta: action,
        product: productData(product),
        offers: displayedOffers,
        bestOfferId: best.id,
        comparisonPrice,
        comparisonLabel,
        savings: actualSavings,
        question: null,
      },
    });
  }

  const title = type === "DUEL_PRICE" ? "⚔️ Duelo de preços" : "🧭 Comparativo de preços";
  const priceLines = displayedOffers.map((offer) => `${offer.label} — ${formatBRL(offer.price)}`);
  const caption = withFooter(
    [
      `${title}: ${productLabel}`,
      "",
      ...priceLines,
      "",
      `Melhor preço: ${best.label} — ${formatBRL(best.price)}`,
      `Economia possível: ${formatBRL(savings)}`,
      "",
      action,
    ],
    hashtags,
  );

  return completeContent({
    type,
    productId: product.id,
    caption,
    hashtags,
    data: {
      template: "DUEL",
      eyebrow: type === "DUEL_PRICE" ? "DUELO DE PREÇOS" : "COMPARATIVO OFERTANO",
      headline: productLabel,
      subheadline: `Menor preço na ${best.label}`,
      cta: action,
      product: productData(product),
      offers: displayedOffers,
      bestOfferId: best.id,
      comparisonPrice: highest.price,
      comparisonLabel: "Maior preço entre lojas",
      savings,
      question: null,
    },
  });
}

export function buildEvergreenContent(
  type: EvergreenPostType,
  variantIndex: number,
): GeneratedSocialContent {
  const hashtags = postHashtags(null, type);

  if (type === "ENGAGEMENT_QUESTION") {
    const question = ENGAGEMENT_QUESTIONS[variantIndex % ENGAGEMENT_QUESTIONS.length];
    const action = cta(Math.floor(variantIndex / ENGAGEMENT_QUESTIONS.length));
    const caption = withFooter(
      ["💬 Pergunta Ofertano", "", question, "", action],
      hashtags,
    );

    return completeContent({
      type,
      productId: null,
      caption,
      hashtags,
      data: {
        template: "ENGAGEMENT",
        eyebrow: "PERGUNTA DO DIA",
        headline: question,
        subheadline: "Conte nos comentários.",
        cta: action,
        product: null,
        offers: [],
        bestOfferId: null,
        comparisonPrice: null,
        comparisonLabel: null,
        savings: null,
        question,
      },
    });
  }

  const sources =
    type === "SAVING_TIP"
      ? SAVING_TIPS[variantIndex % SAVING_TIPS.length]
      : SHOPPING_CURIOSITIES[variantIndex % SHOPPING_CURIOSITIES.length];
  const secondarySource =
    type === "SAVING_TIP"
      ? SAVING_TIPS[Math.floor(variantIndex / SAVING_TIPS.length) % SAVING_TIPS.length]
      : SHOPPING_CURIOSITIES[
          Math.floor(variantIndex / SHOPPING_CURIOSITIES.length) % SHOPPING_CURIOSITIES.length
        ];
  const source = {
    headline: sources.headline,
    body: secondarySource.body,
  };
  const action = cta(
    Math.floor(
      variantIndex /
        (type === "SAVING_TIP"
          ? SAVING_TIPS.length * SAVING_TIPS.length
          : SHOPPING_CURIOSITIES.length * SHOPPING_CURIOSITIES.length),
    ),
  );
  const eyebrow = type === "SAVING_TIP" ? "DICA PARA ECONOMIZAR" : "CURIOSIDADE DE COMPRA";
  const emoji = type === "SAVING_TIP" ? "💡" : "🛒";
  const caption = withFooter(
    [`${emoji} ${source.headline}`, "", source.body, "", action],
    hashtags,
  );

  return completeContent({
    type,
    productId: null,
    caption,
    hashtags,
    data: {
      template: "ENGAGEMENT",
      eyebrow,
      headline: source.headline,
      subheadline: source.body,
      cta: action,
      product: null,
      offers: [],
      bestOfferId: null,
      comparisonPrice: null,
      comparisonLabel: null,
      savings: null,
      question: null,
    },
  });
}

const EDITORIAL_ITEMS: Record<EditorialPostType, Array<{ headline: string; body: string }>> = {
  EDITORIAL_CURIOSITY: EDITORIAL_CURIOSITY_ITEMS,
  EDITORIAL_NOSTALGIA: EDITORIAL_NOSTALGIA_ITEMS,
  EDITORIAL_DEBATE: EDITORIAL_DEBATE_ITEMS,
  EDITORIAL_HISTORY: EDITORIAL_HISTORY_ITEMS,
  EDITORIAL_MYSTERY: EDITORIAL_MYSTERY_ITEMS,
  EDITORIAL_QUIZ: EDITORIAL_QUIZ_ITEMS,
};

const EDITORIAL_EMOJIS: Record<EditorialPostType, string> = {
  EDITORIAL_CURIOSITY: "🔍",
  EDITORIAL_NOSTALGIA: "📜",
  EDITORIAL_DEBATE: "⚖️",
  EDITORIAL_HISTORY: "📚",
  EDITORIAL_MYSTERY: "🕵️",
  EDITORIAL_QUIZ: "❓",
};

const EDITORIAL_EYEBROWS: Record<EditorialPostType, string> = {
  EDITORIAL_CURIOSITY: "CURIOSIDADE DE CONSUMO",
  EDITORIAL_NOSTALGIA: "MEMÓRIA DE CONSUMO",
  EDITORIAL_DEBATE: "DEBATE DO CONSUMIDOR",
  EDITORIAL_HISTORY: "HISTÓRIA DO VAREJO",
  EDITORIAL_MYSTERY: "MISTÉRIO DO PREÇO",
  EDITORIAL_QUIZ: "QUIZ DO CONSUMIDOR",
};

export function buildEditorialContent(
  type: EditorialPostType,
  variantIndex: number,
): GeneratedSocialContent {
  const hashtags = postHashtags(null, type);
  const items = EDITORIAL_ITEMS[type];
  const emoji = EDITORIAL_EMOJIS[type];
  const eyebrow = EDITORIAL_EYEBROWS[type];
  const primary = items[variantIndex % items.length];
  const secondary = items[Math.floor(variantIndex / items.length) % items.length];
  const source = {
    headline: primary.headline,
    body: secondary.body,
  };
  const action = cta(
    Math.floor(variantIndex / (items.length * items.length)),
  );
  const caption = withFooter(
    [`${emoji} ${source.headline}`, "", source.body, "", action],
    hashtags,
  );

  return completeContent({
    type,
    productId: null,
    caption,
    hashtags,
    data: {
      template: "ENGAGEMENT",
      eyebrow,
      headline: source.headline,
      subheadline: source.body,
      cta: action,
      product: null,
      offers: [],
      bestOfferId: null,
      comparisonPrice: null,
      comparisonLabel: null,
      savings: null,
      question: null,
    },
  });
}
