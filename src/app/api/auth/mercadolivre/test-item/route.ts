import {
  NextRequest,
  NextResponse,
} from "next/server";

import prisma from "@/lib/prisma";
import {
  getAccessToken,
} from "@/lib/mercadolivre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_URL =
  "https://api.mercadolibre.com";

type ApiCallResult = {
  name: string;
  endpoint: string;
  authenticated: boolean;
  status: number;
  ok: boolean;
  data: unknown;
};

function asRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  return value as Record<
    string,
    unknown
  >;
}

function resumirErroOuItem(
  value: unknown,
): unknown {
  const record = asRecord(value);

  if (!record) {
    return value;
  }

  return {
    id: record.id,
    title: record.title,
    seller_id:
      record.seller_id,
    status: record.status,
    message: record.message,
    error: record.error,
    code: record.code,
    blocked_by:
      record.blocked_by,
    cause: record.cause,
  };
}

function resumirRespostaItem(
  data: unknown,
): unknown {
  if (!Array.isArray(data)) {
    return resumirErroOuItem(data);
  }

  return data.map((entry) => {
    const record = asRecord(entry);

    if (!record) {
      return entry;
    }

    if (
      "body" in record ||
      "code" in record
    ) {
      return {
        code: record.code,
        body:
          resumirErroOuItem(
            record.body,
          ),
      };
    }

    return resumirErroOuItem(
      entry,
    );
  });
}

async function apiCall(
  name: string,
  endpoint: string,
  token?: string,
): Promise<ApiCallResult> {
  const headers:
    Record<string, string> = {
      Accept:
        "application/json",
    };

  if (token) {
    headers.Authorization =
      `Bearer ${token}`;
  }

  const response = await fetch(
    `${BASE_URL}${endpoint}`,
    {
      method: "GET",
      headers,
      cache: "no-store",
    },
  );

  const text =
    await response.text();

  let data: unknown = text;

  try {
    data = JSON.parse(
      text,
    ) as unknown;
  } catch {
    // Mantém texto quando a resposta
    // do Mercado Livre não for JSON.
  }

  return {
    name,
    endpoint,
    authenticated:
      Boolean(token),
    status:
      response.status,
    ok:
      response.ok,
    data,
  };
}

function extrairAplicacaoDoUsuario(
  data: unknown,
  appId: string,
) {
  if (!Array.isArray(data)) {
    return {
      found: false,
      application: null,
    };
  }

  const application = data.find(
    (entry) => {
      const record =
        asRecord(entry);

      return (
        record !== null &&
        String(
          record.app_id ?? "",
        ) === appId
      );
    },
  );

  const record =
    asRecord(application);

  return {
    found:
      record !== null,
    application:
      record
        ? {
            userId:
              record.user_id ??
              null,
            appId:
              record.app_id ??
              null,
            scopes:
              record.scopes ??
              null,
            dateCreated:
              record.date_created ??
              null,
          }
        : null,
  };
}

function extrairGrant(
  data: unknown,
  appId: string,
  sellerId: string,
) {
  const root =
    asRecord(data);

  const grants =
    root &&
    Array.isArray(root.grants)
      ? root.grants
      : [];

  const grant = grants.find(
    (entry) => {
      const record =
        asRecord(entry);

      return (
        record !== null &&
        String(
          record.app_id ?? "",
        ) === appId &&
        String(
          record.user_id ?? "",
        ) === sellerId
      );
    },
  );

  const record =
    asRecord(grant);

  return {
    found:
      record !== null,
    grant:
      record
        ? {
            userId:
              record.user_id ??
              null,
            appId:
              record.app_id ??
              null,
            scopes:
              record.scopes ??
              null,
            dateCreated:
              record.date_created ??
              null,
          }
        : null,
    paging:
      root?.paging ?? null,
  };
}

function extrairIdsProprios(
  data: unknown,
): string[] {
  const root =
    asRecord(data);

  if (
    !root ||
    !Array.isArray(
      root.results,
    )
  ) {
    return [];
  }

  return root.results
    .filter(
      (
        value,
      ): value is string =>
        typeof value ===
        "string",
    )
    .slice(0, 5);
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

    const appId =
      process.env
        .MERCADO_LIVRE_CLIENT_ID
        ?.trim();

    if (!appId) {
      return NextResponse.json(
        {
          success: false,
          error:
            "MERCADO_LIVRE_CLIENT_ID não configurado.",
        },
        {
          status: 500,
        },
      );
    }

    const connection =
      await prisma
        .marketplaceConnection
        .findUnique({
          where: {
            marketplace:
              "MERCADO_LIVRE",
          },
        });

    if (
      !connection ||
      !connection.sellerId
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Conexão do Mercado Livre ou sellerId não encontrado.",
        },
        {
          status: 404,
        },
      );
    }

    const sellerId =
      connection.sellerId;

    const token =
      await getAccessToken();

    const [
      singleWithToken,
      multigetWithToken,
      singleWithoutToken,
      multigetWithoutToken,
      userApplications,
      appGrants,
      ownItemsSearch,
    ] = await Promise.all([
      apiCall(
        "single_with_token",
        `/items/${itemId}`,
        token,
      ),

      apiCall(
        "multiget_with_token",
        `/items?ids=${encodeURIComponent(
          itemId,
        )}`,
        token,
      ),

      apiCall(
        "single_without_token",
        `/items/${itemId}`,
      ),

      apiCall(
        "multiget_without_token",
        `/items?ids=${encodeURIComponent(
          itemId,
        )}`,
      ),

      apiCall(
        "user_applications",
        `/users/${encodeURIComponent(
          sellerId,
        )}/applications`,
        token,
      ),

      apiCall(
        "application_grants",
        `/applications/${encodeURIComponent(
          appId,
        )}/grants`,
        token,
      ),

      apiCall(
        "own_items_search",
        `/users/${encodeURIComponent(
          sellerId,
        )}/items/search?limit=5`,
        token,
      ),
    ]);

    const ownItemIds =
      extrairIdsProprios(
        ownItemsSearch.data,
      );

    const ownItemDetail =
      ownItemIds[0]
        ? await apiCall(
            "own_item_detail",
            `/items/${encodeURIComponent(
              ownItemIds[0],
            )}`,
            token,
          )
        : null;

    return NextResponse.json({
      success: true,
      testedAt:
        new Date().toISOString(),

      identity: {
        appId,
        sellerId,
      },

      effectiveAuthorization: {
        userApplications: {
          status:
            userApplications.status,
          ok:
            userApplications.ok,
          ...extrairAplicacaoDoUsuario(
            userApplications.data,
            appId,
          ),
        },

        applicationGrant: {
          status:
            appGrants.status,
          ok:
            appGrants.ok,
          ...extrairGrant(
            appGrants.data,
            appId,
            sellerId,
          ),
        },
      },

      ownSellerAccess: {
        searchStatus:
          ownItemsSearch.status,
        searchOk:
          ownItemsSearch.ok,
        itemIds:
          ownItemIds,

        searchError:
          ownItemsSearch.ok
            ? null
            : resumirErroOuItem(
                ownItemsSearch.data,
              ),

        firstItemDetail:
          ownItemDetail
            ? {
                itemId:
                  ownItemIds[0],
                status:
                  ownItemDetail.status,
                ok:
                  ownItemDetail.ok,
                response:
                  resumirRespostaItem(
                    ownItemDetail.data,
                  ),
              }
            : null,
      },

      targetItemAccess: {
        itemId,

        results: [
          {
            name:
              singleWithToken.name,
            authenticated:
              true,
            status:
              singleWithToken.status,
            ok:
              singleWithToken.ok,
            response:
              resumirRespostaItem(
                singleWithToken.data,
              ),
          },

          {
            name:
              multigetWithToken.name,
            authenticated:
              true,
            status:
              multigetWithToken.status,
            ok:
              multigetWithToken.ok,
            response:
              resumirRespostaItem(
                multigetWithToken.data,
              ),
          },

          {
            name:
              singleWithoutToken.name,
            authenticated:
              false,
            status:
              singleWithoutToken.status,
            ok:
              singleWithoutToken.ok,
            response:
              resumirRespostaItem(
                singleWithoutToken.data,
              ),
          },

          {
            name:
              multigetWithoutToken.name,
            authenticated:
              false,
            status:
              multigetWithoutToken.status,
            ok:
              multigetWithoutToken.ok,
            response:
              resumirRespostaItem(
                multigetWithoutToken.data,
              ),
          },
        ],
      },
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