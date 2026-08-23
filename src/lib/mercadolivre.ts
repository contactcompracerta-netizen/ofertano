import prisma from "@/lib/prisma";

const BASE_URL = "https://api.mercadolibre.com";

async function getConnection() {
  const connection = await prisma.marketplaceConnection.findUnique({
    where: {
      marketplace: "MERCADO_LIVRE",
    },
  });

  if (!connection) {
    throw new Error("Mercado Livre não conectado.");
  }

  return connection;
}

async function refreshAccessToken() {
  const connection = await getConnection();

  const response = await fetch(
    "https://api.mercadolibre.com/oauth/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: process.env.MERCADO_LIVRE_CLIENT_ID!,
        client_secret: process.env.MERCADO_LIVRE_CLIENT_SECRET!,
        refresh_token: connection.refreshToken,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message ?? "Erro ao renovar token.");
  }

  const expiresAt = new Date(
    Date.now() + Number(data.expires_in) * 1000
  );

  await prisma.marketplaceConnection.update({
    where: {
      marketplace: "MERCADO_LIVRE",
    },
    data: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    },
  });

  return data.access_token as string;
}

export async function getAccessToken() {
  const connection = await getConnection();

  if (connection.expiresAt.getTime() > Date.now() + 60000) {
    return connection.accessToken;
  }

  return refreshAccessToken();
}

export async function mercadoLivreFetch(
  endpoint: string,
  init?: RequestInit
) {
  const method =
    (init?.method ?? "GET").toUpperCase();

  const url =
    `${BASE_URL}${endpoint}`;

  /*
   * 1. Tenta normalmente com OAuth.
   *
   * Algumas APIs publicas do Mercado Livre podem
   * responder 401/403 quando acessadas com determinado
   * token, embora o mesmo recurso continue disponivel
   * publicamente.
   */
  let authenticatedResponse:
    Response | null = null;

  let authenticatedError:
    string | null = null;

  try {
    const token =
      await getAccessToken();

    const headers =
      new Headers(init?.headers);

    headers.set(
      "Authorization",
      `Bearer ${token}`
    );

    if (!headers.has("Accept")) {
      headers.set(
        "Accept",
        "application/json"
      );
    }

    authenticatedResponse =
      await fetch(url, {
        ...init,
        headers,
      });

    if (
      authenticatedResponse.ok
    ) {
      return authenticatedResponse.json();
    }

    authenticatedError =
      await authenticatedResponse.text();

    /*
     * Erros diferentes de 401/403 nao indicam
     * problema de permissao. Mantemos o erro original.
     */
    if (
      method !== "GET" ||
      (
        authenticatedResponse.status !== 401 &&
        authenticatedResponse.status !== 403
      )
    ) {
      throw new Error(
        `Mercado Livre ${endpoint} retornou ${authenticatedResponse.status}: ${authenticatedError}`
      );
    }
  } catch (error) {
    /*
     * Se houve uma resposta HTTP autenticada diferente
     * de 401/403, o erro deve continuar fatal.
     */
    if (
      authenticatedResponse &&
      authenticatedResponse.status !== 401 &&
      authenticatedResponse.status !== 403
    ) {
      throw error;
    }

    /*
     * Para operacoes que alteram dados, nunca retiramos
     * autenticacao automaticamente.
     */
    if (method !== "GET") {
      throw error;
    }

    if (!authenticatedError) {
      authenticatedError =
        error instanceof Error
          ? error.message
          : String(error);
    }
  }

  /*
   * 2. FALLBACK PUBLICO GLOBAL
   *
   * Somente para leitura (GET).
   *
   * Remove explicitamente Authorization e repete
   * a mesma consulta. Assim recursos publicos nao
   * ficam dependentes das permissoes do token OAuth.
   */
  const publicHeaders =
    new Headers(init?.headers);

  publicHeaders.delete(
    "Authorization"
  );

  if (!publicHeaders.has("Accept")) {
    publicHeaders.set(
      "Accept",
      "application/json"
    );
  }

  const publicResponse =
    await fetch(url, {
      ...init,
      headers: publicHeaders,
    });

  if (publicResponse.ok) {
    return publicResponse.json();
  }

  const publicError =
    await publicResponse.text();

  const authenticatedStatus =
    authenticatedResponse?.status ??
    "sem resposta";

  throw new Error(
    `Mercado Livre ${endpoint} falhou autenticado (${authenticatedStatus}) e publico (${publicResponse.status}). Auth: ${authenticatedError ?? "sem detalhes"} | Publico: ${publicError}`
  );
}


export async function mercadoLivrePublicFetch(
  endpoint: string,
  init?: RequestInit
) {
  const headers =
    new Headers(init?.headers);

  headers.delete("Authorization");

  if (!headers.has("Accept")) {
    headers.set(
      "Accept",
      "application/json"
    );
  }

  const response =
    await fetch(
      `${BASE_URL}${endpoint}`,
      {
        ...init,
        headers,
      }
    );

  if (!response.ok) {
    const error =
      await response.text();

    throw new Error(
      `Mercado Livre publico ${endpoint} retornou ${response.status}: ${error}`
    );
  }

  return response.json();
}
