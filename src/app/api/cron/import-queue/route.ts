import { NextResponse } from "next/server";

import { processImportQueue } from "@/services/importQueue/processQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const segredo = process.env.CRON_SECRET;

  const authorization =
    request.headers.get("authorization");

  if (
    !segredo ||
    authorization !== `Bearer ${segredo}`
  ) {
    return NextResponse.json(
      {
        success: false,
        error: "Acesso não autorizado.",
      },
      {
        status: 401,
      }
    );
  }

  try {
    const resultado =
      await processImportQueue(10);

    return NextResponse.json({
      ...resultado,
      automated: true,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "Erro no processamento automático:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno na automação.",
      },
      {
        status: 500,
      }
    );
  }
}