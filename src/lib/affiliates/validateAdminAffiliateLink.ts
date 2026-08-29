import { ehLinkAfiliadoConfirmadoMercadoLivre } from "@/lib/affiliates/publicPurchase";

function normalizeAffiliateUrl(value: string): string | null {
  const text = value.trim();

  if (!text) {
    return null;
  }

  try {
    const url = new URL(text);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    url.hash = "";

    return url.toString();
  } catch {
    return null;
  }
}

export function validateOfficialMercadoLivreAffiliateLink(
  value: string,
): string | null {
  const normalized = normalizeAffiliateUrl(value);

  if (!normalized) {
    return null;
  }

  return ehLinkAfiliadoConfirmadoMercadoLivre(normalized)
    ? normalized
    : null;
}

export function validateMercadoLivreAffiliateLink(
  value: string,
): string | null {
  return validateOfficialMercadoLivreAffiliateLink(value);
}
