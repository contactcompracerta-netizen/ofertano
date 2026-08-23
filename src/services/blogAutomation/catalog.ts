import { legacyBlogPosts } from "@/app/blog/posts";
import prisma from "@/lib/prisma";

import type {
  EditorialPostCatalog,
  EditorialPostRecord,
} from "./types";

export function criarCatalogoPrisma(): EditorialPostCatalog {
  return {
    async listarPautasRecentes(limit = 80) {
      try {
        const posts = await prisma.blogPost.findMany({
          orderBy: {
            createdAt: "desc",
          },
          take: limit,
          select: {
            id: true,
            slug: true,
            title: true,
            createdAt: true,
            publishedAt: true,
            status: true,
          },
        });

        if (posts.length > 0) {
          return posts;
        }
      } catch (error) {
        console.warn(
          "Catálogo editorial: banco indisponível; usando artigos locais.",
          error,
        );
      }

      return legacyBlogPosts.slice(0, limit).map(
        (post): EditorialPostRecord => ({
          slug: post.slug,
          title: post.title,
          publishedAt: post.publishedAt,
          status: "PUBLISHED",
        }),
      );
    },
  };
}

export async function garantirSlugEditorialUnico(
  slug: string,
): Promise<string> {
  let candidate = slug;
  let suffix = 2;

  while (suffix <= 50) {
    const existing = await prisma.blogPost.findUnique({
      where: {
        slug: candidate,
      },
      select: {
        id: true,
      },
    });

    if (!existing) {
      return candidate;
    }

    candidate = `${slug.slice(0, 110)}-${suffix}`;
    suffix += 1;
  }

  throw new Error(
    "Não foi possível gerar um slug único para o rascunho.",
  );
}
