import { NextResponse } from "next/server";

import { processPriceMonitor } from "@/services/priceMonitor/processPriceMonitor";

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
      },
    );
  }

  try {
    const url = new URL(request.url);

    const quantidadeParametro =
      url.searchParams.get("quantidade");

    const quantidade = quantidadeParametro
      ? Number(quantidadeParametro)
      : 5;

    const resultado =
      await processPriceMonitor(quantidade);

    return NextResponse.json({
      ...resultado,
      automated: true,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "Erro no monitor automático de preços:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno no monitor de preços.",
      },
      {
        status: 500,
      },
    );
  }
}
