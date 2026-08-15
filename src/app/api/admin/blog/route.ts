import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { mapearPostAdmin } from "@/services/blog/format";
import { validarBlogPostInput } from "@/services/blog/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(
  error: unknown,
  fallback: string,
) {
  console.error(fallback, error);

  const message =
    error instanceof Error
      ? error.message
      : fallback;

  const uniqueError =
    message.includes("Unique constraint") ||
    message.includes("P2002");

  return NextResponse.json(
    {
      success: false,
      error: uniqueError
        ? "Já existe um artigo usando esse endereço (slug)."
        : message,
    },
    {
      status: uniqueError ? 409 : 500,
    },
  );
}

export async function GET() {
  try {
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

    const posts =
      await prisma.blogPost.findMany({
        orderBy: [
          {
            updatedAt: "desc",
          },
        ],
      });

    const mapped = posts.map(mapearPostAdmin);

    return NextResponse.json({
      success: true,
      posts: mapped,
      summary: {
        total: mapped.length,
        drafts: mapped.filter(
          (post) => post.status === "DRAFT",
        ).length,
        scheduled: mapped.filter(
          (post) =>
            post.status === "SCHEDULED",
        ).length,
        published: mapped.filter(
          (post) =>
            post.status === "PUBLISHED",
        ).length,
        archived: mapped.filter(
          (post) =>
            post.status === "ARCHIVED",
        ).length,
      },
    });
  } catch (error) {
    return errorResponse(
      error,
      "Erro ao carregar os artigos.",
    );
  }
}

export async function POST(
  request: Request,
) {
  try {
    const body = await request
      .json()
      .catch(() => null);

    const input =
      validarBlogPostInput(body);

    if (input.featured) {
      await prisma.blogPost.updateMany({
        where: {
          featured: true,
        },
        data: {
          featured: false,
        },
      });
    }

    const created =
      await prisma.blogPost.create({
        data: {
          ...input,
          sections:
            input.sections as unknown as Prisma.InputJsonValue,
        },
      });

    revalidatePath("/blog");
    revalidatePath(`/blog/${created.slug}`);

    return NextResponse.json(
      {
        success: true,
        message:
          input.status === "PUBLISHED"
            ? "Artigo publicado com sucesso."
            : input.status === "SCHEDULED"
              ? "Artigo agendado com sucesso."
              : "Rascunho salvo com sucesso.",
        post: mapearPostAdmin(created),
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    return errorResponse(
      error,
      "Erro ao salvar o artigo.",
    );
  }
}
