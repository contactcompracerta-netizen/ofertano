import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  descobrirProdutos,
} from "@/services/discovery";

import {
  publicarResultadoDiscovery,
} from "@/services/discovery/publisher";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type PublishBody = {
  query?: unknown;
  limit?: unknown;
};

function obterLimite(
  valor: unknown,
): number | undefined {
  if (
    valor === undefined ||
    valor === null ||
    valor === ""
  ) {
    return undefined;
  }

  const numero = Number(valor);

  if (
    !Number.isFinite(numero) ||
    numero <= 0
  ) {
    return undefined;
  }

  return Math.min(
    20,
    Math.trunc(numero),
  );
}

export async function POST(
  request: NextRequest,
) {
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
        error: "Acesso não autorizado.",
      },
      {
        status: 401,
      },
    );
  }

  try {
    const body =
      await request.json() as PublishBody;

    const query =
      typeof body.query === "string"
        ? body.query.trim()
        : "";

    const limit =
      obterLimite(body.limit);

    if (!query) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Informe "query" no corpo da requisição.',
        },
        {
          status: 400,
        },
      );
    }

    const discovery =
      await descobrirProdutos(
        query,
        limit,
      );

    const publication =
      await publicarResultadoDiscovery(
        discovery,
      );

    return NextResponse.json({
      success:
        publication.failed === 0,

      discovery: {
        query: discovery.query,
        found: discovery.found,
        errors: discovery.errors,

        marketplaces:
          discovery.results.map(
            (item) => ({
              marketplace:
                item.marketplace,
              success:
                item.success,
              scanned:
                item.scanned,
              found:
                item.candidates.length,
              error:
                item.error ?? null,
            }),
          ),
      },

      publication,

      executedAt:
        new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "Erro ao publicar resultado do Discovery:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao publicar resultado do Discovery.",
      },
      {
        status: 500,
      },
    );
  }
}
