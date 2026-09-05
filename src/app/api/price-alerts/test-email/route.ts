import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { authenticateSupabaseRequest } from "@/lib/supabaseAuth";
import {
  createPrismaTestEmailStore,
  logDiagnosticoTesteEmail,
  sendTestEmailForUser,
} from "@/services/priceAlerts/testEmail";
import { buscarEmailDoUsuarioDiagnostico } from "@/services/priceAlerts/userEmail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4096;

export async function POST(request: Request) {
  const auth = await authenticateSupabaseRequest(request);

  if (!auth) {
    logDiagnosticoTesteEmail("AUTH", "AUTH_FAILED");
    return NextResponse.json(
      { ok: false, code: "AUTH_FAILED", error: "Não autenticado." },
      { status: 401 },
    );
  }

  logDiagnosticoTesteEmail("AUTH", "AUTH_OK");

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
    buscarEmailDoUsuarioDiagnostico,
  );

  if (outcome.ok) {
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  return NextResponse.json(
    { ok: false, code: outcome.code },
    { status: outcome.status },
  );
}