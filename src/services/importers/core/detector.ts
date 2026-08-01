export type MarketplaceKey =
  | "mercadolivre"
  | "amazon"
  | "shopee";

export function detectarMarketplace(
  rawUrl: string
): MarketplaceKey {
  let hostname: string;

  try {
    hostname = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    throw new Error("O endereço informado não é um link válido.");
  }

  if (
    hostname === "mercadolivre.com.br" ||
    hostname.endsWith(".mercadolivre.com.br") ||
    hostname === "mercadolivre.com" ||
    hostname.endsWith(".mercadolivre.com") ||
    hostname === "meli.la" ||
    hostname.endsWith(".meli.la")
  ) {
    return "mercadolivre";
  }

  if (
    hostname.includes("amazon.") ||
    hostname === "amzn.to"
  ) {
    return "amazon";
  }

  if (hostname.includes("shopee.")) {
    return "shopee";
  }

  throw new Error("Marketplace não suportado.");
}
