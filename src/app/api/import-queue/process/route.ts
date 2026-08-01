import { NextResponse } from "next/server";

import { processImportQueue } from "@/services/importQueue/processQueue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request
      .json()
      .catch(() => null);

    const resultado =
      await processImportQueue(body?.limit);

    return NextResponse.json(resultado);
  } catch (error) {
    console.error(
      "Erro ao processar fila de importação:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao processar a fila.",
      },
      {
        status: 500,
      }
    );
  }
}