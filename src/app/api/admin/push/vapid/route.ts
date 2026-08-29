import { NextResponse } from "next/server";

import {
  publicVapidResponse,
} from "@/services/admin-push/payload";
import { readVapidPublicKey } from "@/services/admin-push/vapid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const publicKey = readVapidPublicKey();

  if (!publicKey) {
    return NextResponse.json(
      {
        success: false,
        configured: false,
        error:
          "Notificações push ainda não estão configuradas neste ambiente.",
      },
      {
        status: 503,
      },
    );
  }

  return NextResponse.json({
    success: true,
    ...publicVapidResponse(publicKey),
  });
}
