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

type PricePostType = Extract<
  SocialPostType,
  "DUEL_PRICE" | "FOUND_DEAL" | "PRICE_COMPARISON"
>;

type EvergreenPostType = Extract<
  SocialPostType,
  "SAVING_TIP" | "ENGAGEMENT_QUESTION" | "SHOPPING_CURIOSITY"
>;

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
