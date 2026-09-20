import prisma from "@/lib/prisma";
import {
  encontrarPostPorSlug,
  legacyBlogPosts,
} from "@/app/blog/posts";

import { mapearPostPublico } from "./format";
import type { BlogPost } from "./types";
import type { Prisma } from "@prisma/client";

/**
 * Condição de publicação efetiva (somente leitura).
 *
 * Um post fica publicamente visível quando:
 * - status PUBLISHED e publishedAt <= agora; OU
 * - status SCHEDULED e scheduledAt <= agora (publicação agendada vencida).
 *
 * Não publica: DRAFT, ARCHIVED, SCHEDULED futuro e PUBLISHED com
 * publishedAt futuro. Nenhuma linha é modificada: a decisão de
 * visibilidade é aplicada diretamente no WHERE das queries.
 */
export function condicaoPublicacaoEfetiva(
  agora: Date = new Date(),
): Prisma.BlogPostWhereInput {
  return {
    OR: [
      {
        status: "PUBLISHED",
        publishedAt: {
          lte: agora,
        },
      },
      {
        status: "SCHEDULED",
        scheduledAt: {
          lte: agora,
        },
      },
    ],
  };
}

function ordenarLegados(): BlogPost[] {
  return [...legacyBlogPosts].sort(
    (first, second) => {
      if (
        Boolean(first.featured) !==
        Boolean(second.featured)
      ) {
        return first.featured ? -1 : 1;
      }

      return (
        new Date(second.publishedAt).getTime() -
        new Date(first.publishedAt).getTime()
      );
    },
  );
}

export async function listarPostsPublicados(): Promise<
  BlogPost[]
> {
  try {
    const posts =
      await prisma.blogPost.findMany({
        where: condicaoPublicacaoEfetiva(),
        orderBy: [
          {
            featured: "desc",
          },
          {
            publishedAt: "desc",
          },
        ],
      });

    if (posts.length > 0) {
      return posts.map(mapearPostPublico);
    }

    const total =
      await prisma.blogPost.count();

    return total === 0
      ? ordenarLegados()
      : [];
  } catch (error) {
    console.warn(
      "Blog no banco ainda não disponível; usando artigos locais.",
      error,
    );

    return ordenarLegados();
  }
}

export async function buscarPostPublicadoPorSlug(
  slug: string,
): Promise<BlogPost | null> {
  try {
    const post =
      await prisma.blogPost.findFirst({
        where: {
          slug,
          ...condicaoPublicacaoEfetiva(),
        },
      });

    if (post) {
      return mapearPostPublico(post);
    }

    const total =
      await prisma.blogPost.count();

    return total === 0
      ? encontrarPostPorSlug(slug) ?? null
      : null;
  } catch (error) {
    console.warn(
      "Artigo no banco ainda não disponível; consultando conteúdo local.",
      error,
    );

    return encontrarPostPorSlug(slug) ?? null;
  }
}