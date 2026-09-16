import { NextResponse } from "next/server";

import { isImportQueueProcessEnabled } from "@/lib/featureFlags";
import { processImportQueue } from "@/services/importQueue/processQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const segredo =
    process.env.CRON_SECRET;

  const authorization =
    request.headers.get(
      "authorization",
    );

  if (
    !segredo ||
    authorization !==
      `Bearer ${segredo}`
  ) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Acesso não autorizado.",
      },
      {
        status: 401,
      },
    );
  }

  if (!isImportQueueProcessEnabled()) {
    console.info("AUTO_IMPORT_QUEUE_CRON", {
      enabled: false,
      action: "skipped",
      writer: "import-queue",
    });

    return NextResponse.json({
      success: true,
      skipped: true,
      automated: true,
      reason: "IMPORT_QUEUE_PROCESS_ENABLED is not explicitly true.",
      executedAt: new Date().toISOString(),
    });
  }

  try {
    /*
     * No plano Hobby da Vercel, mantemos uma execução curta:
     * apenas 1 item da fila por chamada.
     *
     * O disparo frequente será feito externamente pelo
     * GitHub Actions. Isso evita que uma única função tente
     * executar vários comparadores Multi Loja em sequência
     * e ultrapasse o maxDuration de 60 segundos.
     */
    const resultado =
      await processImportQueue(1);

    return NextResponse.json({
      ...resultado,
      automated: true,
      executedAt:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "Erro no processamento automático:",
      error,
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
      },
    );
  }
}
