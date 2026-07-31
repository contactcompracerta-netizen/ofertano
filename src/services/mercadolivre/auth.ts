import prisma from "@/lib/prisma";
import { Marketplace } from "@prisma/client";

export async function getMercadoLivreAccessToken(): Promise<string> {
  const connection = await prisma.marketplaceConnection.findUnique({
    where: {
      marketplace: Marketplace.MERCADO_LIVRE,
    },
  });

  if (!connection) {
    throw new Error(
      "A conta do Mercado Livre ainda não foi conectada."
    );
  }

  if (!connection.accessToken) {
    throw new Error(
      "Access Token do Mercado Livre não encontrado."
    );
  }

  return connection.accessToken;
}