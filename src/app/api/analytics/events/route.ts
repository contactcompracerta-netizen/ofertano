import { NextResponse } from "next/server";

import { ingestAnalyticsEvents } from "@/services/analytics/ingest";
import {
  MAX_ANALYTICS_BODY_BYTES,
  parseAnalyticsRequest,
} from "@/services/analytics/payload";
import { detectDeviceType } from "@/services/analytics/device";
import { referrerHostFromUrl } from "@/services/analytics/utm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(status: number, error: string) {
  return NextResponse.json(
    { success: false, error },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();

    if (raw.length > MAX_ANALYTICS_BODY_BYTES) {
      return jsonError(400, "Payload grande demais.");
    }

    let body: unknown;

    try {
      body = raw.length > 0 ? JSON.parse(raw) : null;
    } catch {
      return jsonError(400, "Payload inválido.");
    }

    const parsed = parseAnalyticsRequest(body, raw.length);

    if (!parsed.ok) {
      return jsonError(400, parsed.error);
    }

    const userAgent = request.headers.get("user-agent");
    const fallbackDevice = detectDeviceType(userAgent);
    const fallbackReferrer = referrerHostFromUrl(
      request.headers.get("referer"),
    );

    const events = parsed.events.map((event) => ({
      ...event,
      deviceType:
        event.deviceType === "unknown" ? fallbackDevice : event.deviceType,
      referrer: event.referrer ?? fallbackReferrer,
    }));

    const result = await ingestAnalyticsEvents(events);

    return NextResponse.json(
      {
        success: true,
        accepted: result.accepted,
        duplicates: result.duplicates,
      },
      {
        status: 202,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("[analytics] falha ao registrar eventos", error);

    return new NextResponse(null, {
      status: 204,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
