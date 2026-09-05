import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { authenticateSupabaseRequest } from "@/lib/supabaseAuth";
import {
  createPrismaTestEmailStore,
  sendTestEmailForUser,
} from "@/services/priceAlerts/testEmail";
import { buscarEmailDoUsuario } from "@/services/priceAlerts/userEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;

export async function POST(request: Request) {
  const auth = await authenticateSupabaseRequest(request);

  if (!auth) {
    return NextResponse.json(
      { ok: false, error: "Não autenticado." },
      { status: 401 },
    );
  }

  let body: { productId?: unknown } = {};

  try {
    const raw = await request.text();

    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json(
        { ok: false, error: "Payload grande demais." },
        { status: 400 },
      );
    }

    if (raw.trim()) {
      const parsed = JSON.parse(raw) as unknown;

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json(
          { ok: false, error: "Payload inválido." },
          { status: 400 },
        );
      }

      body = parsed as { productId?: unknown };
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "Payload inválido." },
      { status: 400 },
    );
  }

  if (typeof body?.productId !== "string" || !body.productId) {
    return NextResponse.json(
      { ok: false, error: "productId é obrigatório." },
      { status: 400 },
    );
  }

  const outcome = await sendTestEmailForUser(
    auth.user.id,
    body.productId,
    createPrismaTestEmailStore(prisma),
    buscarEmailDoUsuario,
  );

  return NextResponse.json(
    outcome.ok ? { ok: true } : { ok: false, error: outcome.error },
    { status: outcome.status },
  );
}
