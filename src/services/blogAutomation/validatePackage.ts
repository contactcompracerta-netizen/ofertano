import { normalizarSecoes } from "@/services/blog/format";
import type { BlogPostSection } from "@/services/blog/types";

import {
  criarEspecificacaoDeCapa,
  normalizarEspecificacaoDeCapa,
} from "./cover";
import { EditorialError } from "./errors";
import {
  ctaPadraoEditorial,
  filtrarLinksInternos,
  sugerirLinksInternos,
} from "./links";
import { reconciliarProdutosDoPacote } from "./products";
import {
  conteudoComComprimentoMinimo,
  estimarTempoDeLeitura,
} from "./readingTime";
import {
  intencaoDeBuscaDoObjetivo,
  limitarMetaDescription,
  limitarSeoTitle,
  normalizarFaq,
  temaEditorialDaCategoria,
  termosRelacionados,
} from "./seo";
import {
  garantirSlugEditorial,
  slugEditorialValido,
} from "./slug";
import {
  facebookEInstagramSaoDistintos,
  montarLegendaInstagram,
  normalizarConteudoFacebook,
  normalizarConteudoInstagram,
} from "./social";
import type {
  EditorialPackage,
  FacebookContent,
  InstagramContent,
  NormalizedEditorialInput,
} from "./types";

function textoObrigatorio(
  value: unknown,
  min: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length >= min ? normalized : null;
}

function comoRegistro(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function validarSecoes(
  value: unknown,
): BlogPostSection[] {
  return normalizarSecoes(value).filter(
    (section) =>
      section.title.length >= 5 &&
      section.paragraphs.some(
        (paragraph) => paragraph.length >= 40,
      ),
  );
}

export function validarPacoteEditorial(
  value: unknown,
  input: NormalizedEditorialInput,
): EditorialPackage {
  const root = comoRegistro(value);

  if (!root) {
    throw new EditorialError(
      "INVALID_PACKAGE",
      "O pacote editorial precisa ser um objeto JSON.",
    );
  }

  const blog = comoRegistro(root.blog) ?? root;
  const seo = comoRegistro(root.seo) ?? {};
  const social = comoRegistro(root.social) ?? {};
  const metadata = comoRegistro(root.metadata) ?? {};

  const title = textoObrigatorio(blog.title ?? seo.title, 5);
  const excerpt = textoObrigatorio(
    blog.excerpt ?? seo.description,
    40,
  );
  const sections = validarSecoes(blog.sections);
  const problems: string[] = [];

  if (!title) {
    problems.push("O título do artigo está ausente ou é curto demais.");
  }

  if (!excerpt) {
    problems.push("O resumo precisa ter pelo menos 40 caracteres.");
  }

  if (sections.length < 3) {
    problems.push(
      "O artigo precisa de pelo menos três seções com título e parágrafo útil.",
    );
  }

  if (!conteudoComComprimentoMinimo(sections, 220)) {
    problems.push(
      "O texto do artigo está incompleto para um guia editorial.",
    );
  }

  if (problems.length > 0) {
    throw new EditorialError(
      "INCOMPLETE_CONTENT",
      "O conteúdo gerado é insuficiente ou inválido.",
      problems,
    );
  }

  const slug = garantirSlugEditorial(blog.slug ?? seo.slug, title!);

  if (!slugEditorialValido(slug)) {
    throw new EditorialError(
      "INVALID_PACKAGE",
      "O slug gerado é inválido.",
    );
  }

  const products = reconciliarProdutosDoPacote(
    metadata.relatedProducts,
    input.products,
  );
  const category =
    textoObrigatorio(blog.category, 3) ?? input.category;
  const faq = normalizarFaq(blog.faq ?? seo.faq);
  const cta = ctaPadraoEditorial(input);
  const internalLinks = filtrarLinksInternos(
    seo.internalLinks,
    sugerirLinksInternos({
      slug,
      category,
      products,
    }),
  );
  const cover = normalizarEspecificacaoDeCapa(
    blog.cover,
    criarEspecificacaoDeCapa({
      title: title!,
      excerpt: excerpt!,
      products,
    }),
    products,
  );

  const facebookFallback: FacebookContent = {
    hook: `Antes de comprar, vale conferir o que realmente muda em ${input.topic}.`,
    mainBenefit:
      "O Ofertano ajuda a comparar o mesmo tipo de produto com critério, sem pressa artificial.",
    summary: excerpt!,
    cta: cta.label,
    articleLinkPlaceholder: `/blog/${slug}`,
    caption: "",
  };
  facebookFallback.caption = [
    facebookFallback.hook,
    "",
    facebookFallback.mainBenefit,
    "",
    facebookFallback.summary,
    "",
    facebookFallback.cta,
    facebookFallback.articleLinkPlaceholder,
  ].join("\n");

  const instagramFallback: InstagramContent = {
    hook: `Como escolher ${input.topic} sem cair em atalho de anúncio.`,
    caption:
      "Compare o essencial, ignore urgência falsa e use o Ofertano para ver ofertas equivalentes.",
    cta: "Salve este guia e compare no Ofertano pelo link na bio.",
    hashtags: [
      "#Ofertano",
      "#Ofertas",
      "#CompararPrecos",
      "#GuiaDeCompra",
    ],
    linkStrategy: "bio",
    linkNote:
      "O Instagram não torna links da legenda clicáveis. Use o link na bio, um story com sticker de link ou direcione o leitor ao Ofertano pelo nome do artigo.",
  };

  const facebook = normalizarConteudoFacebook(
    social.facebook,
    facebookFallback,
  );
  const instagram = normalizarConteudoInstagram(
    social.instagram,
    instagramFallback,
  );
  const instagramMontada = montarLegendaInstagram({
    hook: instagram.hook,
    caption: instagram.caption,
    cta: instagram.cta,
    hashtags: instagram.hashtags,
  });

  if (facebook.caption.trim().length < 80) {
    throw new EditorialError(
      "INCOMPLETE_CONTENT",
      "O texto de Facebook está incompleto.",
    );
  }

  if (
    instagram.caption.trim().length < 40 ||
    instagramMontada.length > 1800 ||
    instagram.hashtags.length < 3
  ) {
    throw new EditorialError(
      "INCOMPLETE_CONTENT",
      "O texto de Instagram está incompleto, longo demais ou sem hashtags suficientes.",
    );
  }

  if (!facebookEInstagramSaoDistintos(facebook, instagram)) {
    throw new EditorialError(
      "INVALID_PACKAGE",
      "Facebook e Instagram precisam ter conteúdos diferentes.",
    );
  }

  const warnings: string[] = [];

  if (Array.isArray(metadata.warnings)) {
    for (const warning of metadata.warnings) {
      if (typeof warning === "string" && warning.trim()) {
        warnings.push(warning.trim());
      }
    }
  }

  return {
    blog: {
      title: title!,
      slug,
      excerpt: excerpt!,
      category,
      readingTime: estimarTempoDeLeitura(sections, excerpt!),
      theme: temaEditorialDaCategoria(category),
      sections,
      faq,
      cta,
      cover,
    },
    seo: {
      searchIntent:
        textoObrigatorio(seo.searchIntent, 12) ??
        intencaoDeBuscaDoObjetivo(input.objective),
      title: limitarSeoTitle(
        textoObrigatorio(seo.title, 5) ?? title!,
      ),
      description: limitarMetaDescription(
        textoObrigatorio(seo.description, 40) ?? excerpt!,
      ),
      slug,
      headings: sections.map((section) => ({
        level: "h2" as const,
        text: section.title,
      })),
      relatedTerms: termosRelacionados(
        input.topic,
        category,
        seo.relatedTerms,
      ),
      faq,
      internalLinks,
      cta,
    },
    social: {
      facebook: {
        ...facebook,
        articleLinkPlaceholder: `/blog/${slug}`,
      },
      instagram,
    },
    metadata: {
      objective: input.objective,
      relatedProducts: products,
      duplicateCheck: {
        verdict: "OK",
        matches: [],
      },
      generatedAt: new Date().toISOString(),
      provider: "deterministic",
      source: input.source,
      warnings,
    },
  };
}
