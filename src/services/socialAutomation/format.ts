const BRAZIL_TIME_ZONE = "America/Sao_Paulo";

const marketplaceNames: Record<string, string> = {
  MERCADO_LIVRE: "Mercado Livre",
  AMAZON: "Amazon",
  SHOPEE: "Shopee",
  MAGAZINE_LUIZA: "Magalu",
  CASAS_BAHIA: "Casas Bahia",
  KABUM: "KaBuM!",
  TERABYTE: "Terabyte",
  ALIEXPRESS: "AliExpress",
  CARREFOUR: "Carrefour",
};

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function formatBRL(value: number): string {
  return currencyFormatter.format(value);
}

export function marketplaceLabel(value: string): string {
  return marketplaceNames[value] ?? value.replaceAll("_", " ");
}

export function summarizeText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) return normalized;

  const shortened = normalized.slice(0, maxLength - 1);
  const lastSpace = shortened.lastIndexOf(" ");

  return `${(lastSpace > 20 ? shortened.slice(0, lastSpace) : shortened).trimEnd()}…`;
}

export function getBrazilDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";

  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function validHttpsImageUrl(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function toHashtag(value: string): string | null {
  const compact = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 28);

  return compact ? `#${compact}` : null;
}

export function publicBaseUrl(requestUrl: string): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Um valor malformado não deve impedir a entrega do post diário.
    }
  }

  return new URL(requestUrl).origin;
}
