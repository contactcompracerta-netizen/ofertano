import { NextResponse } from "next/server";

import {
  MAX_FAVORITE_BODY_BYTES,
  MAX_FAVORITE_PAYLOAD_ITEMS,
} from "@/lib/favorites/constants";
import prisma from "@/lib/prisma";
import {
  addAccountFavorite,
  createPrismaProductValidator,
  favoritesRepositoryFromSupabase,
  listAccountFavorites,
  mergeAccountFavorites,
  removeAccountFavorite,
} from "@/services/favorites/account";
import {
  authenticateFavoritesRequest,
  createUserSupabaseClient,
} from "@/services/favorites/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(
  body: Record<string, unknown>,
  status = 200,
) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function unauthorized() {
  return json(
    {
      success: false,
      error: "Não autenticado.",
      ids: [],
    },
    401,
  );
}

async function readJsonBody(request: Request) {
  const raw = await request.text();

  if (raw.length > MAX_FAVORITE_BODY_BYTES) {
    return {
      ok: false as const,
      error: "Payload grande demais.",
    };
  }

  if (!raw.trim()) {
    return { ok: true as const, body: {} as Record<string, unknown> };
  }

  try {
    const body = JSON.parse(raw) as unknown;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return {
        ok: false as const,
        error: "Payload inválido.",
      };
    }

    return {
      ok: true as const,
      body: body as Record<string, unknown>,
    };
  } catch {
    return {
      ok: false as const,
      error: "Payload inválido.",
    };
  }
}

async function withAccount(request: Request) {
  const auth = await authenticateFavoritesRequest(request);

  if (!auth) {
    return null;
  }

  const supabase = createUserSupabaseClient(auth.accessToken);

  return {
    userId: auth.user.id,
    repository: favoritesRepositoryFromSupabase(supabase),
    products: createPrismaProductValidator(prisma),
  };
}

export async function GET(request: Request) {
  try {
    const account = await withAccount(request);

    if (!account) {
      return unauthorized();
    }

    const result = await listAccountFavorites(
      account.userId,
      account.repository,
      account.products,
    );

    if (!result.ok) {
      return json(
        { success: false, error: result.error, ids: [] },
        result.status,
      );
    }

    return json({ success: true, ids: result.ids });
  } catch (error) {
    console.error("Erro ao carregar favoritos da conta:", error);
    return json(
      {
        success: false,
        error: "Não foi possível carregar seus favoritos.",
        ids: [],
      },
      500,
    );
  }
}

export async function POST(request: Request) {
  try {
    const account = await withAccount(request);

    if (!account) {
      return unauthorized();
    }

    const parsed = await readJsonBody(request);

    if (!parsed.ok) {
      return json({ success: false, error: parsed.error, ids: [] }, 400);
    }

    const action =
      typeof parsed.body.action === "string"
        ? parsed.body.action
        : Array.isArray(parsed.body.ids)
          ? "merge"
          : "add";

    if (action === "merge") {
      if (
        Array.isArray(parsed.body.ids) &&
        parsed.body.ids.length > MAX_FAVORITE_PAYLOAD_ITEMS
      ) {
        return json(
          {
            success: false,
            error: "Payload grande demais.",
            ids: [],
          },
          400,
        );
      }

      const result = await mergeAccountFavorites(
        account.userId,
        parsed.body.ids,
        account.repository,
        account.products,
      );

      if (!result.ok) {
        return json(
          { success: false, error: result.error, ids: [] },
          result.status,
        );
      }

      return json({ success: true, ids: result.ids });
    }

    if (action === "remove") {
      const result = await removeAccountFavorite(
        account.userId,
        parsed.body.productId,
        account.repository,
        account.products,
      );

      if (!result.ok) {
        return json(
          { success: false, error: result.error, ids: [] },
          result.status,
        );
      }

      return json({ success: true, ids: result.ids });
    }

    const result = await addAccountFavorite(
      account.userId,
      parsed.body.productId ?? parsed.body.id,
      account.repository,
      account.products,
    );

    if (!result.ok) {
      return json(
        { success: false, error: result.error, ids: [] },
        result.status,
      );
    }

    return json({ success: true, ids: result.ids });
  } catch (error) {
    console.error("Erro ao salvar favoritos da conta:", error);
    return json(
      {
        success: false,
        error: "Não foi possível salvar seus favoritos.",
        ids: [],
      },
      500,
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const account = await withAccount(request);

    if (!account) {
      return unauthorized();
    }

    const url = new URL(request.url);
    let productId: unknown = url.searchParams.get("productId");

    if (!productId) {
      const parsed = await readJsonBody(request);

      if (!parsed.ok) {
        return json({ success: false, error: parsed.error, ids: [] }, 400);
      }

      productId = parsed.body.productId ?? parsed.body.id;
    }

    const result = await removeAccountFavorite(
      account.userId,
      productId,
      account.repository,
      account.products,
    );

    if (!result.ok) {
      return json(
        { success: false, error: result.error, ids: [] },
        result.status,
      );
    }

    return json({ success: true, ids: result.ids });
  } catch (error) {
    console.error("Erro ao remover favorito da conta:", error);
    return json(
      {
        success: false,
        error: "Não foi possível remover o favorito.",
        ids: [],
      },
      500,
    );
  }
}
