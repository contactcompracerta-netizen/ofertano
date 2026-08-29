import webpush from "web-push";

import prisma from "@/lib/prisma";

import { isPermanentPushFailure } from "./eligibility";
import { readVapidConfig } from "./vapid";

type StoredSubscription = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

function applyVapid() {
  const config = readVapidConfig();

  if (!config) {
    return null;
  }

  webpush.setVapidDetails(
    config.subject,
    config.publicKey,
    config.privateKey,
  );

  return config;
}

function readPushStatusCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "statusCode" in error &&
    typeof (error as { statusCode: unknown }).statusCode === "number"
  ) {
    return (error as { statusCode: number }).statusCode;
  }

  return null;
}

export async function sendPushToSubscriptions(
  subscriptions: StoredSubscription[],
  payload: unknown,
) {
  if (!applyVapid()) {
    return {
      sent: 0,
      failed: 0,
      removed: 0,
      skipped: true as const,
    };
  }

  const body = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  const expiredIds: string[] = [];

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        },
        body,
      );
      sent += 1;
    } catch (error) {
      failed += 1;

      const statusCode = readPushStatusCode(error);

      if (isPermanentPushFailure(statusCode)) {
        expiredIds.push(subscription.id);
      } else {
        console.error(
          "Falha temporária ao enviar Web Push:",
          statusCode,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  let removed = 0;

  if (expiredIds.length > 0) {
    const result = await prisma.adminPushSubscription.deleteMany({
      where: {
        id: {
          in: expiredIds,
        },
      },
    });

    removed = result.count;
  }

  return {
    sent,
    failed,
    removed,
    skipped: false as const,
  };
}

export async function sendPushToAllAdminSubscriptions(payload: unknown) {
  const subscriptions = await prisma.adminPushSubscription.findMany({
    select: {
      id: true,
      endpoint: true,
      p256dh: true,
      auth: true,
    },
  });

  return sendPushToSubscriptions(subscriptions, payload);
}
