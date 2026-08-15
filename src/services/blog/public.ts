import prisma from "@/lib/prisma";
import {
  encontrarPostPorSlug,
  legacyBlogPosts,
} from "@/app/blog/posts";

import { mapearPostPublico } from "./format";
import type { BlogPost } from "./types";

async function publicarAgendadosVencidos() {
  const now = new Date();

  await prisma.blogPost.updateMany({
    where: {
      status: "SCHEDULED",
      scheduledAt: {
        lte: now,
      },
    },
    data: {
      status: "PUBLISHED",
      publishedAt: now,
    },
  });
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
    await publicarAgendadosVencidos();

    const posts =
      await prisma.blogPost.findMany({
        where: {
          status: "PUBLISHED",
          publishedAt: {
            lte: new Date(),
          },
        },
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
    await publicarAgendadosVencidos();

    const post =
      await prisma.blogPost.findFirst({
        where: {
          slug,
          status: "PUBLISHED",
          publishedAt: {
            lte: new Date(),
          },
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
