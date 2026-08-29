import prisma from "@/lib/prisma";

import {
  canDispatchPendingAffiliateOpportunity,
  opportunityDispatchKey,
  shouldMarkDispatchDelivered,
} from "./eligibility";
import { buildAdminPushPayload } from "./payload";
import { sendPushToAllAdminSubscriptions } from "./send";
import { readVapidConfig } from "./vapid";

async function alreadyDispatched(opportunityKey: string) {
  const existing = await prisma.adminPushDispatch.findUnique({
    where: {
      opportunityKey,
    },
    select: {
      id: true,
    },
  });

  return Boolean(existing);
}

async function markDispatched(opportunityKey: string) {
  await prisma.adminPushDispatch.upsert({
    where: {
      opportunityKey,
    },
    create: {
      opportunityKey,
    },
    update: {},
  });
}

export async function notifyPendingAffiliateOpportunity(
  opportunityId: string,
) {
  const id = opportunityId.trim();

  if (!id) {
    return { notified: false, reason: "missing-opportunity" as const };
  }

  if (!readVapidConfig()) {
    return { notified: false, reason: "vapid-not-configured" as const };
  }

  const opportunity = await prisma.productOpportunity.findUnique({
    where: { id },
    select: {
      id: true,
      marketplace: true,
      status: true,
    },
  });

  if (!opportunity) {
    return { notified: false, reason: "not-found" as const };
  }

  if (!canDispatchPendingAffiliateOpportunity(opportunity)) {
    return { notified: false, reason: "not-pending-opportunity" as const };
  }

  const opportunityKey = opportunityDispatchKey(opportunity.id);

  if (await alreadyDispatched(opportunityKey)) {
    return { notified: false, reason: "already-sent" as const };
  }

  const payload = buildAdminPushPayload({
    focusId: opportunity.id,
    opportunityKey,
  });

  const result = await sendPushToAllAdminSubscriptions(payload);

  if (result.skipped) {
    return { notified: false, reason: "vapid-not-configured" as const };
  }

  if (!shouldMarkDispatchDelivered(result)) {
    return {
      notified: false,
      reason:
        result.failed > 0
          ? ("delivery-failed" as const)
          : ("no-subscribers" as const),
    };
  }

  await markDispatched(opportunityKey);

  return {
    notified: true,
    reason: "sent" as const,
    sent: result.sent,
    removed: result.removed,
  };
}

export function notifyPendingAffiliateOpportunitySafe(
  opportunityId: string,
) {
  void notifyPendingAffiliateOpportunity(opportunityId).catch((error) => {
    console.error(
      "Falha ao notificar oportunidade de afiliado do Mercado Livre:",
      error,
    );
  });
}
