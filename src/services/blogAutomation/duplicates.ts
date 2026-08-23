import type {
  DuplicateCheckResult,
  DuplicateMatch,
  DuplicateVerdict,
  EditorialPostCatalog,
  EditorialPostRecord,
  NormalizedEditorialInput,
} from "./types";
import {
  normalizarTituloPauta,
  tokensDaPauta,
} from "./normalize";
import { criarSlugEditorial } from "./slug";

function comoData(
  value: Date | string | null | undefined,
): number | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function jaccard(
  left: string[],
  right: string[],
): number {
  const a = new Set(left);
  const b = new Set(right);

  if (a.size === 0 || b.size === 0) {
    return 0;
  }

  let intersecao = 0;

  for (const token of a) {
    if (b.has(token)) {
      intersecao += 1;
    }
  }

  return intersecao / new Set([...a, ...b]).size;
}

function diasEntre(
  later: number,
  earlier: number,
): number {
  return Math.abs(later - earlier) / (1000 * 60 * 60 * 24);
}

export function avaliarSimilaridadeEditorial(
  input: NormalizedEditorialInput,
  posts: EditorialPostRecord[],
  now = new Date(),
): DuplicateCheckResult {
  const slug = criarSlugEditorial(input.topic);
  const titulo = normalizarTituloPauta(input.topic);
  const tokens = tokensDaPauta(input.topic);
  const agora = now.getTime();
  const matches: DuplicateMatch[] = [];
  let verdict: DuplicateVerdict = "OK";

  for (const post of posts) {
    const postSlug = criarSlugEditorial(post.slug);
    const postTitulo = normalizarTituloPauta(post.title);
    const postTokens = tokensDaPauta(post.title);
    const similaridade = jaccard(tokens, postTokens);
    const criadoEm =
      comoData(post.createdAt) ??
      comoData(post.publishedAt);
    const recente =
      criadoEm !== null && diasEntre(agora, criadoEm) <= 45;
    const muitoRecente =
      criadoEm !== null && diasEntre(agora, criadoEm) <= 14;

    if (postSlug === slug || postTitulo === titulo) {
      verdict = "DUPLICATE";
      matches.push({
        id: post.id,
        slug: post.slug,
        title: post.title,
        reason:
          postSlug === slug
            ? "O slug da pauta já existe."
            : "O título normalizado é idêntico a um artigo existente.",
        score: 1,
      });
      continue;
    }

    if (similaridade >= 0.88) {
      if (verdict !== "DUPLICATE") {
        verdict = "POSSIBLE_DUPLICATE";
      }

      matches.push({
        id: post.id,
        slug: post.slug,
        title: post.title,
        reason:
          "O título usa praticamente as mesmas palavras de um artigo já publicado.",
        score: similaridade,
      });
      continue;
    }

    if (similaridade >= 0.72 && recente) {
      if (verdict !== "DUPLICATE") {
        verdict = "POSSIBLE_DUPLICATE";
      }

      matches.push({
        id: post.id,
        slug: post.slug,
        title: post.title,
        reason:
          "Há um artigo recente com pauta muito parecida.",
        score: similaridade,
      });
      continue;
    }

    if (similaridade >= 0.8 && muitoRecente) {
      if (verdict !== "DUPLICATE") {
        verdict = "POSSIBLE_DUPLICATE";
      }

      matches.push({
        id: post.id,
        slug: post.slug,
        title: post.title,
        reason:
          "O mesmo assunto foi tratado nos últimos 14 dias.",
        score: similaridade,
      });
    }
  }

  matches.sort((a, b) => b.score - a.score);

  return {
    verdict,
    matches: matches.slice(0, 5),
  };
}

export async function detectarDuplicataEditorial(
  input: NormalizedEditorialInput,
  catalog: EditorialPostCatalog,
  now = new Date(),
): Promise<DuplicateCheckResult> {
  const posts = await catalog.listarPautasRecentes(80);

  return avaliarSimilaridadeEditorial(input, posts, now);
}

export function criarCatalogoEmMemoria(
  posts: EditorialPostRecord[],
): EditorialPostCatalog {
  return {
    async listarPautasRecentes(limit = 80) {
      return posts.slice(0, limit);
    },
  };
}
