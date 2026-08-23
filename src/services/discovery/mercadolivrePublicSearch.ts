export type MercadoLivreListingItem = {
  id?: string;
  title?: string;
  price?: number;
  original_price?: number | null;
  permalink?: string;
  thumbnail?: string;
  condition?: string;
  currency_id?: string;
  category_id?: string;
  seller?: {
    id?: number;
    nickname?: string;
  };
  attributes?: Array<{
    id?: string;
    name?: string;
    value_name?: string;
  }>;
  tags?: string[];
  shipping?: {
    logistic_type?: string;
    tags?: string[];
  };
};

export type MercadoLivreSourceStatus =
  | "SUCCESS"
  | "EMPTY"
  | "BLOCKED"
  | "ERROR";

export type MercadoLivreSourceFetch<T> = {
  status: MercadoLivreSourceStatus;
  httpStatus: number | null;
  data: T;
  reason?: string;
};

const ITEM_ID_PATTERN = /\bMLB-?(\d{8,})\b/gi;
const PRODUCT_URL_PATTERN =
  /https?:\/\/produto\.mercadolivre\.com\.br\/MLB-(\d+)/gi;

export function classificarErroFonteMercadoLivre(
  error: unknown,
): Pick<MercadoLivreSourceFetch<never>, "status" | "httpStatus" | "reason"> {
  const reason =
    error instanceof Error
      ? error.message
      : String(error);

  const codes = Array.from(
    reason.matchAll(
      /(?:retornou |autenticado \(|publico \(|HTTP )(\d{3})/gi,
    ),
    (match) => Number(match[1]),
  ).filter((code) => Number.isFinite(code));

  const httpStatus = codes[codes.length - 1] ?? null;

  if (httpStatus === 401 || httpStatus === 403) {
    return {
      status: "BLOCKED",
      httpStatus,
      reason: reason.slice(0, 500),
    };
  }

  return {
    status: "ERROR",
    httpStatus,
    reason: reason.slice(0, 500),
  };
}

function normalizarItemId(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");

  if (digits.length < 8) {
    return null;
  }

  return `MLB${digits}`;
}

function registrarItem(
  items: Map<string, MercadoLivreListingItem>,
  rawId: string,
  extra: Partial<MercadoLivreListingItem> = {},
): void {
  const id = normalizarItemId(rawId);

  if (!id) {
    return;
  }

  const current = items.get(id) ?? { id };
  items.set(id, {
    ...current,
    ...extra,
    id,
  });
}

export function extrairItensDaPaginaDeBuscaPublica(
  html: string,
): MercadoLivreListingItem[] {
  const items = new Map<string, MercadoLivreListingItem>();

  for (const match of html.matchAll(PRODUCT_URL_PATTERN)) {
    const id = match[1];
    if (!id) {
      continue;
    }

    registrarItem(items, id, {
      permalink: `https://produto.mercadolivre.com.br/MLB-${id}`,
    });
  }

  for (const match of html.matchAll(
    /"id"\s*:\s*"(MLB-?\d+)"\s*,\s*"title"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/g,
  )) {
    const rawId = match[1];
    const title = match[2]
      ?.replace(/\\"/g, '"')
      .replace(/\\u002F/g, "/")
      .trim();

    if (!rawId || !title) {
      continue;
    }

    registrarItem(items, rawId, { title });
  }

  for (const match of html.matchAll(
    /"id"\s*:\s*"(MLB-?\d+)"[\s\S]{0,400}?"price"\s*:\s*(\d+(?:\.\d+)?)/g,
  )) {
    const rawId = match[1];
    const price = Number(match[2]);

    if (!rawId || !Number.isFinite(price) || price <= 0) {
      continue;
    }

    registrarItem(items, rawId, { price });
  }

  /*
   * IDs em URLs de anuncio individual. Paginas /p/ de catalogo nao
   * entram por este padrao de produto.mercadolivre.com.br.
   */
  for (const match of html.matchAll(ITEM_ID_PATTERN)) {
    const digits = match[1];
    if (!digits) {
      continue;
    }

    const around = html.slice(
      Math.max(0, (match.index ?? 0) - 40),
      (match.index ?? 0) + 20,
    );

    if (/\/p\//i.test(around)) {
      continue;
    }

    registrarItem(items, digits);
  }

  return Array.from(items.values());
}

function slugDaConsulta(query: string): string {
  return query
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function fetchHtml(
  url: string,
): Promise<{ status: number; html: string }> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      "Cache-Control": "no-cache",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    },
    cache: "no-store",
    redirect: "follow",
  });

  return {
    status: response.status,
    html: await response.text(),
  };
}

export async function buscarPaginaPublicaMercadoLivre(
  query: string,
): Promise<MercadoLivreSourceFetch<MercadoLivreListingItem[]>> {
  const slug = slugDaConsulta(query);

  if (!slug) {
    return {
      status: "EMPTY",
      httpStatus: null,
      data: [],
      reason: "Consulta sem slug publico.",
    };
  }

  const urls = [
    `https://lista.mercadolivre.com.br/${encodeURIComponent(slug)}`,
    `https://www.mercadolivre.com.br/jm/search?as_word=${encodeURIComponent(query)}`,
  ];

  let lastBlocked: MercadoLivreSourceFetch<MercadoLivreListingItem[]> | null =
    null;
  let lastError: MercadoLivreSourceFetch<MercadoLivreListingItem[]> | null =
    null;

  for (const url of urls) {
    try {
      const { status, html } = await fetchHtml(url);

      if (status === 401 || status === 403) {
        lastBlocked = {
          status: "BLOCKED",
          httpStatus: status,
          data: [],
          reason: `Busca publica HTML retornou ${status}.`,
        };
        continue;
      }

      if (!status || status >= 400) {
        lastError = {
          status: "ERROR",
          httpStatus: status,
          data: [],
          reason: `Busca publica HTML retornou ${status}.`,
        };
        continue;
      }

      const data = extrairItensDaPaginaDeBuscaPublica(html);

      return {
        status: data.length > 0 ? "SUCCESS" : "EMPTY",
        httpStatus: status,
        data,
        reason:
          data.length > 0
            ? undefined
            : "Pagina publica de busca sem anuncios individuais.",
      };
    } catch (error) {
      lastError = {
        ...classificarErroFonteMercadoLivre(error),
        data: [],
      };
    }
  }

  return (
    lastBlocked ??
    lastError ?? {
      status: "EMPTY",
      httpStatus: null,
      data: [],
      reason: "Busca publica HTML indisponivel.",
    }
  );
}
