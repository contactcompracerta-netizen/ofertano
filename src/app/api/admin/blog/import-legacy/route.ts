import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { legacyBlogPosts } from "@/app/blog/posts";
import prisma from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    let imported = 0;
    let skipped = 0;

    for (const post of legacyBlogPosts) {
      const existing =
        await prisma.blogPost.findUnique({
          where: {
            slug: post.slug,
          },
          select: {
            id: true,
          },
        });

      if (existing) {
        skipped += 1;
        continue;
      }

      await prisma.blogPost.create({
        data: {
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          category: post.category,
          author: post.author ?? "Ofertano",
          readingTime: post.readingTime,
          theme: post.theme,
          coverImage:
            post.coverImage ?? null,
          sections:
            post.sections as unknown as Prisma.InputJsonValue,
          status: "PUBLISHED",
          featured:
            post.featured === true,
          seoTitle:
            post.seoTitle ?? null,
          seoDescription:
            post.seoDescription ??
            post.excerpt,
          socialCaption:
            post.socialCaption ?? null,
          scheduledAt: null,
          publishedAt: new Date(
            post.publishedAt,
          ),
        },
      });

      imported += 1;
    }

    revalidatePath("/blog");

    return NextResponse.json({
      success: true,
      message:
        imported > 0
          ? `${imported} artigo(s) atual(is) importado(s) para o painel.`
          : "Os artigos atuais já estão no painel.",
      imported,
      skipped,
    });
  } catch (error) {
    console.error(
      "Erro ao importar artigos atuais:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro ao importar os artigos atuais.",
      },
      {
        status: 500,
      },
    );
  }
}
