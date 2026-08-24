import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

import { buildEventHash } from "./hash";
import { dateKeyInTimeZone, utcDateFromKey } from "./metrics";
import { buildRollupWrites } from "./rollup";
import type { ValidatedAnalyticsEvent } from "./types";

function isDuplicateError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function ingestAnalyticsEvents(
  events: ValidatedAnalyticsEvent[],
): Promise<{ accepted: number; duplicates: number }> {
  let accepted = 0;
  let duplicates = 0;

  for (const event of events) {
    const result = await ingestAnalyticsEvent(event);

    if (result === "duplicate") {
      duplicates += 1;
    } else {
      accepted += 1;
    }
  }

  return { accepted, duplicates };
}

export async function ingestAnalyticsEvent(
  event: ValidatedAnalyticsEvent,
): Promise<"accepted" | "duplicate"> {
  const createdAt = new Date();
  const query = event.normalizedQuery ?? event.query;
  const eventHash = buildEventHash({
    eventType: event.eventType,
    sessionId: event.sessionId,
    productId: event.productId,
    query,
    marketplace: event.marketplace,
    position: event.position,
    createdAt,
    metadata: event.metadata,
  });

  try {
    await prisma.analyticsEvent.create({
      data: {
        eventType: event.eventType,
        sessionId: event.sessionId,
        productId: event.productId,
        query,
        marketplace: event.marketplace,
        position: event.position,
        resultCount: event.resultCount,
        source: event.source,
        referrer: event.referrer,
        utmSource: event.utmSource,
        utmMedium: event.utmMedium,
        utmCampaign: event.utmCampaign,
        utmContent: event.utmContent,
        deviceType: event.deviceType,
        eventHash,
        metadata:
          event.metadata === null
            ? Prisma.JsonNull
            : (event.metadata as Prisma.InputJsonValue),
        createdAt,
      },
    });
  } catch (error) {
    if (isDuplicateError(error)) {
      return "duplicate";
    }

    throw error;
  }

  const day = utcDateFromKey(dateKeyInTimeZone(createdAt));

  await prisma.analyticsSessionDay.upsert({
    where: {
      sessionId_day: {
        sessionId: event.sessionId,
        day,
      },
    },
    create: {
      sessionId: event.sessionId,
      day,
      source: event.source,
      referrer: event.referrer,
      utmSource: event.utmSource,
      utmMedium: event.utmMedium,
      utmCampaign: event.utmCampaign,
      deviceType: event.deviceType,
    },
    update: {},
  });

  const writes = buildRollupWrites({
    ...event,
    query,
    normalizedQuery: query,
  });

  for (const write of writes) {
    await prisma.analyticsDailyAgg.upsert({
      where: {
        day_grain_eventType_dimensionKey: {
          day,
          grain: write.grain,
          eventType: event.eventType,
          dimensionKey: write.dimensionKey,
        },
      },
      create: {
        day,
        grain: write.grain,
        eventType: event.eventType,
        dimensionKey: write.dimensionKey,
        query: write.query,
        productId: write.productId,
        marketplace: write.marketplace,
        source: write.source,
        utmSource: write.utmSource,
        utmMedium: write.utmMedium,
        utmCampaign: write.utmCampaign,
        deviceType: write.deviceType,
        eventCount: 1,
        resultCountSum: write.resultCount,
        lastEventAt: createdAt,
      },
      update: {
        eventCount: {
          increment: 1,
        },
        resultCountSum: {
          increment: write.resultCount,
        },
        lastEventAt: createdAt,
      },
    });
  }

  return "accepted";
}
