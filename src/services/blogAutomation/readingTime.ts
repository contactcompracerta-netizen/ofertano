import type { BlogPostSection } from "@/services/blog/types";

function contarPalavras(value: string): number {
  return value
    .normalize("NFC")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function contarPalavrasDasSecoes(
  sections: BlogPostSection[],
): number {
  return sections.reduce((total, section) => {
    const paragrafos = section.paragraphs.reduce(
      (sum, paragraph) =>
        sum + contarPalavras(paragraph),
      0,
    );
    const bullets = (section.bullets ?? []).reduce(
      (sum, bullet) => sum + contarPalavras(bullet),
      0,
    );

    return (
      total +
      contarPalavras(section.title) +
      paragrafos +
      bullets
    );
  }, 0);
}

export function estimarTempoDeLeitura(
  sections: BlogPostSection[],
  excerpt = "",
): string {
  const palavras =
    contarPalavrasDasSecoes(sections) +
    contarPalavras(excerpt);
  const minutos = Math.max(
    3,
    Math.min(12, Math.round(palavras / 200)),
  );

  return `${minutos} min de leitura`;
}

export function conteudoComComprimentoMinimo(
  sections: BlogPostSection[],
  minPalavras: number,
): boolean {
  return contarPalavrasDasSecoes(sections) >= minPalavras;
}
