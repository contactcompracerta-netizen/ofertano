import type {
  FacebookContent,
  InstagramContent,
} from "./types";
import { criarSlugEditorial } from "./slug";

const NOTA_LINK_INSTAGRAM =
  "O Instagram não torna links da legenda clicáveis. Use o link na bio, um story com sticker de link ou direcione o leitor ao Ofertano pelo nome do artigo.";

function texto(
  value: unknown,
): string {
  return typeof value === "string" ? value.trim() : "";
}

function hashtags(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const tags = value
    .filter(
      (item): item is string =>
        typeof item === "string",
    )
    .map((item) => {
      const tag = item.trim().replace(/^#+/, "");
      return tag ? `#${tag.replace(/\s+/g, "")}` : "";
    })
    .filter(Boolean);

  return Array.from(new Set(tags)).slice(0, 12);
}

export function montarLegendaFacebook(input: {
  hook: string;
  mainBenefit: string;
  summary: string;
  cta: string;
  articleLinkPlaceholder: string;
}): string {
  return [
    input.hook,
    "",
    input.mainBenefit,
    "",
    input.summary,
    "",
    input.cta,
    input.articleLinkPlaceholder,
  ].join("\n");
}

export function montarLegendaInstagram(input: {
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
}): string {
  const tags = input.hashtags.join(" ");

  return [input.hook, "", input.caption, "", input.cta, "", tags]
    .join("\n")
    .trim();
}

export function hashtagsDaPauta(
  topic: string,
  category: string,
): string[] {
  const base = [
    "#Ofertano",
    "#Ofertas",
    "#CompararPrecos",
    "#GuiaDeCompra",
    "#CustoBeneficio",
  ];
  const extra = criarSlugEditorial(topic)
    .split("-")
    .filter((token) => token.length >= 4)
    .slice(0, 4)
    .map(
      (token) =>
        `#${token.charAt(0).toUpperCase()}${token.slice(1)}`,
    );
  const categoria = criarSlugEditorial(category)
    .split("-")
    .filter((token) => token.length >= 4)
    .slice(0, 2)
    .map(
      (token) =>
        `#${token.charAt(0).toUpperCase()}${token.slice(1)}`,
    );

  return Array.from(
    new Set([...base, ...extra, ...categoria]),
  ).slice(0, 10);
}

export function normalizarConteudoFacebook(
  value: unknown,
  fallback: FacebookContent,
): FacebookContent {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  const hook = texto(record.hook) || fallback.hook;
  const mainBenefit =
    texto(record.mainBenefit) || fallback.mainBenefit;
  const summary = texto(record.summary) || fallback.summary;
  const cta = texto(record.cta) || fallback.cta;
  const articleLinkPlaceholder =
    texto(record.articleLinkPlaceholder) ||
    fallback.articleLinkPlaceholder;
  const caption =
    texto(record.caption) ||
    montarLegendaFacebook({
      hook,
      mainBenefit,
      summary,
      cta,
      articleLinkPlaceholder,
    });

  return {
    hook,
    mainBenefit,
    summary,
    cta,
    articleLinkPlaceholder,
    caption,
  };
}

export function normalizarConteudoInstagram(
  value: unknown,
  fallback: InstagramContent,
): InstagramContent {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const record = value as Record<string, unknown>;
  const hook = texto(record.hook) || fallback.hook;
  const cta = texto(record.cta) || fallback.cta;
  const tags = hashtags(record.hashtags);
  const finalTags =
    tags.length >= 3 ? tags : fallback.hashtags;
  const captionBody =
    texto(record.caption) || texto(fallback.caption);
  const linkStrategy =
    record.linkStrategy === "story" ||
    record.linkStrategy === "not_in_caption" ||
    record.linkStrategy === "bio"
      ? record.linkStrategy
      : fallback.linkStrategy;

  return {
    hook,
    caption: captionBody,
    cta,
    hashtags: finalTags,
    linkStrategy,
    linkNote:
      texto(record.linkNote) || NOTA_LINK_INSTAGRAM,
  };
}

export function facebookEInstagramSaoDistintos(
  facebook: FacebookContent,
  instagram: InstagramContent,
): boolean {
  const fb = facebook.caption.replace(/\s+/g, " ").trim();
  const ig = montarLegendaInstagram({
    hook: instagram.hook,
    caption: instagram.caption,
    cta: instagram.cta,
    hashtags: instagram.hashtags,
  })
    .replace(/\s+/g, " ")
    .trim();

  if (!fb || !ig) {
    return false;
  }

  return fb !== ig;
}

export { NOTA_LINK_INSTAGRAM };
