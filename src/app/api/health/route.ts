import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/*
 * Health check read-only para monitoramento externo.
 * Não expõe dados internos, segredos ou contagens do catálogo.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "ofertano",
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
