import { NextResponse } from "next/server";

import { prepareDailySocialPosts } from "@/services/socialAutomation/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (
    !secret ||
    request.headers.get("authorization") !== `Bearer ${secret}`
  ) {
    return NextResponse.json(
      { success: false, error: "Acesso não autorizado." },
      { status: 401 },
    );
  }

  try {
    const results = await prepareDailySocialPosts();

    return NextResponse.json({
      success: true,
      count: results.length,
      createdCount: results.filter((result) => result.created).length,
      posts: results.map((result) => ({
        postId: result.post.id,
        dayKey: result.post.dayKey,
        slot: result.post.slot,
        type: result.post.type,
        created: result.created,
        generatedAt: result.post.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Erro ao preparar conteúdo social diário:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Não foi possível preparar o conteúdo social diário.",
      },
      { status: 500 },
    );
  }
}