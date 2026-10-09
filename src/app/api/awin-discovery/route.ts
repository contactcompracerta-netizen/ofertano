import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const API_BASE = "https://api.awin.com";

type AwinAccount = {
  accountId?: number | string;
  accountName?: string;
  accountType?: string;
  userRole?: string;
};

type AwinProgramme = {
  id?: number | string;
  name?: string;
  currencyCode?: string;
  linkStatus?: string;
  status?: string;
  primaryRegion?: {
    countryCode?: string;
    name?: string;
  };
};

async function awinGet<T>(path: string, token: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        "user-agent": "Ofertano-AwinDiscovery/1.0",
      },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`AWIN_HTTP_${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  if (process.env.VERCEL_ENV !== "preview") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const token = process.env.AWIN_API_TOKEN?.trim();
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "AWIN_API_TOKEN_MISSING" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const rawAccounts = await awinGet<unknown>(
      "/accounts?type=publisher",
      token,
    );

    const accounts: AwinAccount[] = Array.isArray(rawAccounts)
      ? rawAccounts
      : rawAccounts &&
          typeof rawAccounts === "object" &&
          "accounts" in rawAccounts &&
          Array.isArray((rawAccounts as { accounts?: unknown }).accounts)
        ? ((rawAccounts as { accounts: AwinAccount[] }).accounts ?? [])
        : [];

    const publisherAccounts = accounts.filter(
      (account) => (account.accountType ?? "").toLowerCase() === "publisher",
    );

    const programmes = await Promise.all(
      publisherAccounts.map(async (account) => {
        const publisherId = String(account.accountId ?? "").trim();
        if (!publisherId) {
          return {
            publisherId: null,
            accountName: account.accountName ?? null,
            userRole: account.userRole ?? null,
            programmes: [],
            error: "PUBLISHER_ID_MISSING",
          };
        }

        try {
          const rawProgrammes = await awinGet<unknown>(
            `/publishers/${encodeURIComponent(publisherId)}/programmes?relationship=joined&countryCode=BR`,
            token,
          );

          const rows: AwinProgramme[] = Array.isArray(rawProgrammes)
            ? rawProgrammes
            : [];

          return {
            publisherId,
            accountName: account.accountName ?? null,
            userRole: account.userRole ?? null,
            programmes: rows.map((programme) => ({
              id: programme.id ?? null,
              name: programme.name ?? null,
              currencyCode: programme.currencyCode ?? null,
              linkStatus: programme.linkStatus ?? null,
              status: programme.status ?? null,
              countryCode: programme.primaryRegion?.countryCode ?? null,
              regionName: programme.primaryRegion?.name ?? null,
            })),
            error: null,
          };
        } catch (error) {
          return {
            publisherId,
            accountName: account.accountName ?? null,
            userRole: account.userRole ?? null,
            programmes: [],
            error: error instanceof Error ? error.message : "UNKNOWN_ERROR",
          };
        }
      }),
    );

    return NextResponse.json(
      {
        ok: true,
        publisherAccounts: programmes,
      },
      {
        headers: {
          "cache-control": "no-store, max-age=0",
          "x-content-type-options": "nosniff",
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "AWIN_DISCOVERY_FAILED",
      },
      {
        status: 502,
        headers: { "cache-control": "no-store, max-age=0" },
      },
    );
  }
}
