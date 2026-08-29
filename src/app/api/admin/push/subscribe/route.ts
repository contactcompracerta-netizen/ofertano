import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import {
  parsePushSubscriptionBody,
  parseUnsubscribeEndpoint,
} from "@/services/admin-push/subscriptionInput";
import { readVapidPublicKey } from "@/services/admin-push/vapid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!readVapidPublicKey()) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Notificações push ainda não estão configuradas neste ambiente.",
      },
      {
        status: 503,
      },
    );
  }

  const body = await request.json().catch(() => null);
  const subscription = parsePushSubscriptionBody(
    body,
    request.headers.get("user-agent"),
  );

  if (!subscription) {
    return NextResponse.json(
      {
        success: false,
        error: "Subscription Web Push inválida.",
      },
      {
        status: 400,
      },
    );
  }

  const existing = await prisma.adminPushSubscription.findUnique({
    where: {
      endpoint: subscription.endpoint,
    },
    select: {
      id: true,
    },
  });

  const saved = await prisma.adminPushSubscription.upsert({
    where: {
      endpoint: subscription.endpoint,
    },
    create: {
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      userAgent: subscription.userAgent,
    },
    update: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      userAgent: subscription.userAgent,
      lastSeenAt: new Date(),
    },
    select: {
      id: true,
      endpoint: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    success: true,
    duplicated: Boolean(existing),
    subscriptionId: saved.id,
    message: existing
      ? "Subscription já estava registrada."
      : "Notificações ativadas neste dispositivo.",
  });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const endpoint = parseUnsubscribeEndpoint(body);

  if (!endpoint) {
    return NextResponse.json(
      {
        success: false,
        error: "Informe o endpoint da subscription para desativar.",
      },
      {
        status: 400,
      },
    );
  }

  const removed = await prisma.adminPushSubscription.deleteMany({
    where: {
      endpoint,
    },
  });

  return NextResponse.json({
    success: true,
    removed: removed.count,
    message:
      removed.count > 0
        ? "Notificações desativadas neste dispositivo."
        : "Nenhuma subscription encontrada para este dispositivo.",
  });
}
