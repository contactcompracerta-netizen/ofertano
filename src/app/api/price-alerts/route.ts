import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { authenticateSupabaseRequest } from "@/lib/supabaseAuth";
import {
  deactivateAlertForUser,
  getAlertForUser,
  upsertAlertForUser,
} from "@/services/priceAlerts/api";
import { createPrismaPriceAlertApiStore } from "@/services/priceAlerts/apiStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ALERT_BODY_BYTES = 4096;

function json(body: Record<string, unknown>, status = 200) {
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
    },
    401,
  );
}

function store() {
  return createPrismaPriceAlertApiStore({
    priceAlert: prisma.priceAlert,
    product: prisma.product,
  });
}

function withResult(result: Awaited<ReturnType<typeof getAlertForUser>>) {
  if (!result.ok) {
    return json({ success: false, error: result.error }, result.status);
  }
  if (result.alert === null) {
    return json({ success: true, alert: null });
  }
  return json({ success: true, alert: result.alert });
}

async function readJsonBody(request: Request) {
  const raw = await request.text();

  if (raw.length > MAX_ALERT_BODY_BYTES) {
    return { ok: false as const, error: "Payload grande demais." };
  }

  if (!raw.trim()) {
    return { ok: true as const, body: {} as Record<string, unknown> };
  }

  try {
    const body = JSON.parse(raw) as unknown;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { ok: false as const, error: "Payload inválido." };
    }

    return { ok: true as const, body: body as Record<string, unknown> };
  } catch {
    return { ok: false as const, error: "Payload inválido." };
  }
}

export async function GET(request: Request) {
  const auth = await authenticateSupabaseRequest(request);

  if (!auth) {
    return unauthorized();
  }

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  const result = await getAlertForUser(auth.user.id, productId, store());
  return withResult(result);
}

export async function POST(request: Request) {
  const auth = await authenticateSupabaseRequest(request);

  if (!auth) {
    return unauthorized();
  }

  const parsed = await readJsonBody(request);

  if (!parsed.ok) {
    return json({ success: false, error: parsed.error }, 400);
  }

  const result = await upsertAlertForUser(auth.user.id, parsed.body, store());
  return withResult(result);
}

export async function DELETE(request: Request) {
  const auth = await authenticateSupabaseRequest(request);

  if (!auth) {
    return unauthorized();
  }

  const url = new URL(request.url);
  const productId = url.searchParams.get("productId");

  const result = await deactivateAlertForUser(
    auth.user.id,
    productId,
    store(),
  );
  return withResult(result);
}
