import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getAccessToken,
} from "@/lib/mercadolivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_URL =
  "https://api.mercadolibre.com";

type ResultadoTeste = {
  name: string;
  url: string;
  authenticated: boolean;
  status: number;
  ok: boolean;
  response: unknown;
};

function resumirObjeto(
  valor: Record<
    string,
    unknown
  >,
): Record<string, unknown> {
  return {
    id: valor.id,
    title: valor.title,
    seller_id:
      valor.seller_id,
    status: valor.status,
    message: valor.message,
    error: valor.error,
    cause: valor.cause,
  };
}

function resumirResposta(
  data: unknown,
): unknown {
  if (Array.isArray(data)) {
    return data.map((entry) => {
      if (
        typeof entry ===
          "object" &&
        entry !== null &&
        "code" in entry &&
        "body" in entry
      ) {
        const typedEntry =
          entry as {
            code?: unknown;
            body?: unknown;
          };

        const body =
          typedEntry.body;

        return {
          code:
            typedEntry.code,

          body:
            typeof body ===
              "object" &&
            body !== null
              ? resumirObjeto(
                  body as Record<
                    string,
                    unknown
                  >,
                )
              : body,
        };
      }

      return entry;
    });
  }

  if (
    typeof data === "object" &&
    data !== null
  ) {
    return resumirObjeto(
      data as Record<
        string,
        unknown
      >,
    );
  }

  return data;
}

async function executarTeste(
  name: string,
  url: string,
  token?: string,
): Promise<ResultadoTeste> {
  const headers:
    Record<string, string> = {
      Accept:
        "application/json",
    };

  if (token) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  const response =
    await fetch(url, {
      method: "GET",
      headers,
      cache: "no-store",
    });

  const texto =
    await response.text();

  let data: unknown =
    texto;

  try {
    data = JSON.parse(
      texto,
    ) as unknown;
  } catch {
    // Mantém como texto quando
    // a resposta não for JSON.
  }

  return {
    name,
    url,
    authenticated:
      Boolean(token),

    status:
      response.status,

    ok:
      response.ok,

    response:
      resumirResposta(data),
  };
}

export async function GET(
  request: NextRequest,
) {
  try {
    const itemId = (
      request.nextUrl
        .searchParams
        .get("itemId") ?? ""
    )
      .trim()
      .toUpperCase();

    if (!/^MLB\d+$/.test(itemId)) {
      return NextResponse.json(
        {
          success: false,

          error:
            "Informe um itemId válido, por exemplo: MLB4224584697.",
        },
        {
          status: 400,
        },
      );
    }

    const token =
      await getAccessToken();

    const singleUrl =
      `${BASE_URL}/items/${itemId}`;

    const multigetUrl =
      `${BASE_URL}/items?ids=${encodeURIComponent(
        itemId,
      )}`;

    const results =
      await Promise.all([
        executarTeste(
          "single_with_token",
          singleUrl,
          token,
        ),

        executarTeste(
          "multiget_with_token",
          multigetUrl,
          token,
        ),

        executarTeste(
          "single_without_token",
          singleUrl,
        ),

        executarTeste(
          "multiget_without_token",
          multigetUrl,
        ),
      ]);

    return NextResponse.json({
      success: true,
      itemId,

      testedAt:
        new Date().toISOString(),

      results,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Erro desconhecido.";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}