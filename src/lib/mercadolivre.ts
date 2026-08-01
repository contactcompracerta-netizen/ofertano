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
  const token = await getAccessToken();

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const error = await response.text();

    throw new Error(
      `Mercado Livre ${endpoint} retornou ${response.status}: ${error}`
    );
  }

  return response.json();
}