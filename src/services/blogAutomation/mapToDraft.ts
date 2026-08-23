import type { EditorialPackage } from "./types";

export function mapearPacoteParaRascunho(
  pacote: EditorialPackage,
): Record<string, unknown> {
  const sections = [...pacote.blog.sections];
  const jaTemFaq = sections.some((section) =>
    section.title.toLocaleLowerCase("pt-BR").includes(
      "perguntas frequentes",
    ),
  );

  if (pacote.blog.faq.length > 0 && !jaTemFaq) {
    sections.push({
      title: "Perguntas frequentes",
      paragraphs: [
        "Antes de decidir, vale responder às dúvidas que mais aparecem nesse tipo de compra. Use as respostas como checklist, não como atalho para pular a comparação.",
      ],
      bullets: pacote.blog.faq.map(
        (item) => `${item.question} ${item.answer}`,
      ),
    });
  }

  return {
    title: pacote.blog.title,
    slug: pacote.blog.slug,
    excerpt: pacote.blog.excerpt,
    category: pacote.blog.category,
    author: "Ofertano",
    readingTime: pacote.blog.readingTime,
    theme: pacote.blog.theme,
    coverImage: null,
    sections,
    status: "DRAFT",
    featured: false,
    seoTitle: pacote.seo.title,
    seoDescription: pacote.seo.description,
    socialCaption: pacote.social.facebook.caption,
    scheduledAt: null,
    publishedAt: null,
  };
}
