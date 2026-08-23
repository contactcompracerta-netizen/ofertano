import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { mapearPostAdmin } from "@/services/blog/format";
import { validarBlogPostInput } from "@/services/blog/validation";
import { isEditorialError } from "@/services/blogAutomation/errors";
import {
  criarCatalogoPrisma,
  garantirSlugEditorialUnico,
} from "@/services/blogAutomation/catalog";
import { criarProviderDeterministico } from "@/services/blogAutomation/deterministicProvider";
import { gerarPacoteEditorial } from "@/services/blogAutomation/generateEditorialPackage";
import { mapearPacoteParaRascunho } from "@/services/blogAutomation/mapToDraft";
import { resolverProviderPadrao } from "@/services/blogAutomation/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function respostaDeErro(
  error: unknown,
  fallback: string,
) {
  console.error(fallback, error);

  if (isEditorialError(error)) {
    const status =
      error.code === "INVALID_INPUT"
        ? 400
        : error.code === "INCOMPLETE_CONTENT" ||
            error.code === "INVALID_JSON" ||
            error.code === "INVALID_PACKAGE"
          ? 422
          : error.code === "PROVIDER_UNAVAILABLE"
            ? 503
            : 500;

    return NextResponse.json(
      {
        success: false,
        error: error.message,
        code: error.code,
        details: error.details ?? [],
      },
      { status },
    );
  }

  const message =
    error instanceof Error ? error.message : fallback;
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

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;

    if (!body) {
      return NextResponse.json(
        {
          success: false,
          error: "Informe os dados da pauta editorial.",
        },
        { status: 400 },
      );
    }

    const saveAsDraft = body.saveAsDraft === true;
    const forceDraft = body.forceDraft === true;

    const pacote = await gerarPacoteEditorial(
      {
        topic:
          typeof body.topic === "string" ? body.topic : "",
        category:
          typeof body.category === "string"
            ? body.category
            : undefined,
        objective:
          typeof body.objective === "string"
            ? body.objective
            : undefined,
        extraContext:
          typeof body.extraContext === "string"
            ? body.extraContext
            : undefined,
        year:
          typeof body.year === "number" ? body.year : undefined,
        products: Array.isArray(body.products)
          ? body.products
          : undefined,
        source: "manual",
      },
      {
        catalog: criarCatalogoPrisma(),
        provider: resolverProviderPadrao({
          deterministicProvider: criarProviderDeterministico(),
        }),
      },
    );

    const draftPayload = mapearPacoteParaRascunho(pacote);
    const duplicateVerdict =
      pacote.metadata.duplicateCheck.verdict;

    if (
      saveAsDraft &&
      duplicateVerdict === "DUPLICATE" &&
      !forceDraft
    ) {
      return NextResponse.json({
        success: true,
        saved: false,
        message:
          "A pauta parece duplicada. O preview foi gerado, mas o rascunho não foi salvo. Envie forceDraft=true se quiser gravar mesmo assim.",
        package: pacote,
        draftPayload,
        provider: pacote.metadata.provider,
        duplicateCheck: pacote.metadata.duplicateCheck,
      });
    }

    if (!saveAsDraft) {
      return NextResponse.json({
        success: true,
        saved: false,
        message: "Preview editorial gerado. Nada foi publicado.",
        package: pacote,
        draftPayload,
        provider: pacote.metadata.provider,
        duplicateCheck: pacote.metadata.duplicateCheck,
      });
    }

    const uniqueSlug = await garantirSlugEditorialUnico(
      String(draftPayload.slug ?? ""),
    );
    const input = validarBlogPostInput({
      ...draftPayload,
      slug: uniqueSlug,
      status: "DRAFT",
    });

    const created = await prisma.blogPost.create({
      data: {
        ...input,
        sections:
          input.sections as unknown as Prisma.InputJsonValue,
      },
    });

    revalidatePath("/blog");
    revalidatePath("/admin/blog");

    return NextResponse.json(
      {
        success: true,
        saved: true,
        message: "Rascunho editorial salvo. Nada foi publicado.",
        package: pacote,
        draftPayload: {
          ...draftPayload,
          slug: uniqueSlug,
        },
        post: mapearPostAdmin(created),
        provider: pacote.metadata.provider,
        duplicateCheck: pacote.metadata.duplicateCheck,
      },
      { status: 201 },
    );
  } catch (error) {
    return respostaDeErro(
      error,
      "Erro ao gerar o pacote editorial.",
    );
  }
}
