import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { mapearPostAdmin } from "@/services/blog/format";
import { validarBlogPostInput } from "@/services/blog/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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
        ? "Já existe outro artigo usando esse endereço (slug)."
        : message,
    },
    {
      status: uniqueError ? 409 : 500,
    },
  );
}

export async function PATCH(
  request: Request,
  context: RouteContext,
) {
  try {
    const { id } = await context.params;
    const body = await request
      .json()
      .catch(() => null);
    const input =
      validarBlogPostInput(body);

    const current =
      await prisma.blogPost.findUnique({
        where: {
          id,
        },
      });

    if (!current) {
      return NextResponse.json(
        {
          success: false,
          error: "Artigo não encontrado.",
        },
        {
          status: 404,
        },
      );
    }

    if (input.featured) {
      await prisma.blogPost.updateMany({
        where: {
          featured: true,
          id: {
            not: id,
          },
        },
        data: {
          featured: false,
        },
      });
    }

    const updated =
      await prisma.blogPost.update({
        where: {
          id,
        },
        data: {
          ...input,
          sections:
            input.sections as unknown as Prisma.InputJsonValue,
        },
      });

    revalidatePath("/blog");
    revalidatePath(`/blog/${current.slug}`);
    revalidatePath(`/blog/${updated.slug}`);

    return NextResponse.json({
      success: true,
      message:
        input.status === "PUBLISHED"
          ? "Artigo publicado com sucesso."
          : input.status === "SCHEDULED"
            ? "Artigo agendado com sucesso."
            : input.status === "ARCHIVED"
              ? "Artigo arquivado com sucesso."
              : "Rascunho atualizado com sucesso.",
      post: mapearPostAdmin(updated),
    });
  } catch (error) {
    return errorResponse(
      error,
      "Erro ao atualizar o artigo.",
    );
  }
}
