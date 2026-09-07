import { NextResponse } from "next/server";

import {
  getDailySocialPost,
  getDailySocialPosts,
} from "@/services/socialAutomation/engine";
import { publicBaseUrl } from "@/services/socialAutomation/format";
import {
  SOCIAL_POST_SLOTS,
  type SocialPostSlot,
} from "@/services/socialAutomation/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicPost(
  post: NonNullable<Awaited<ReturnType<typeof getDailySocialPost>>>,
  requestUrl: string,
) {
  return {
    postId: post.id,
    dayKey: post.dayKey,
    slot: post.slot,
    type: post.type,
    caption: post.caption,
    mediaUrl: new URL(
      `/api/social/card/${post.id}`,
      publicBaseUrl(requestUrl),
    ).toString(),
    hashtags: post.hashtags,
    productId: post.productId,
    data: post.data,
    generatedAt: post.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const requestedSlot = url.searchParams.get("slot")?.toUpperCase();

    if (
      requestedSlot &&
      !SOCIAL_POST_SLOTS.includes(requestedSlot as SocialPostSlot)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "Slot social inválido.",
          allowedSlots: SOCIAL_POST_SLOTS,
        },
        {
          status: 400,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    if (requestedSlot) {
      const post = await getDailySocialPost(
        new Date(),
        requestedSlot as SocialPostSlot,
      );

      if (!post) {
        return NextResponse.json(
          {
            success: false,
            error: "O conteúdo desse slot ainda não foi preparado.",
            code: "SOCIAL_POST_NOT_PREPARED",
          },
          {
            status: 404,
            headers: { "Cache-Control": "no-store" },
          },
        );
      }

      return NextResponse.json(
        {
          success: true,
          post: publicPost(post, request.url),
        },
        {
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    const posts = await getDailySocialPosts();

    if (posts.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Os conteúdos sociais de hoje ainda não foram preparados.",
          code: "SOCIAL_POSTS_NOT_PREPARED",
        },
        {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    return NextResponse.json(
      {
        success: true,
        dayKey: posts[0].dayKey,
        count: posts.length,
        posts: posts.map((post) => publicPost(post, request.url)),
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    console.error("Erro ao entregar conteúdo social diário:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Não foi possível carregar o conteúdo social diário.",
      },
      {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}