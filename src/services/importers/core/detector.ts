export type MarketplaceKey =
  | "mercadolivre"
  | "amazon"
  | "shopee"
  | "magazineluiza"
  | "casasbahia"
  | "kabum"
  | "terabyte"
  | "aliexpress"
  | "carrefour";

function correspondeDominio(
  hostname: string,
  dominio: string,
): boolean {
  return (
    hostname === dominio ||
    hostname.endsWith(`.${dominio}`)
  );
}

function correspondeAAlgumDominio(
  hostname: string,
  dominios: readonly string[],
): boolean {
  return dominios.some((dominio) =>
    correspondeDominio(hostname, dominio),
  );
}

export function detectarMarketplace(
  rawUrl: string,
): MarketplaceKey {
  const urlInformada = rawUrl.trim();

  if (!urlInformada) {
    throw new Error("Informe o link do produto.");
  }

  let hostname: string;

  try {
    hostname = new URL(urlInformada).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    throw new Error(
      "O endereço informado não é um link válido.",
    );
  }

  if (
    correspondeAAlgumDominio(hostname, [
      "mercadolivre.com.br",
      "mercadolivre.com",
      "meli.la",
    ])
  ) {
    return "mercadolivre";
  }

  if (
    correspondeAAlgumDominio(hostname, [
      "amazon.com.br",
      "amazon.com",
      "amzn.to",
    ])
  ) {
    return "amazon";
  }

  if (
    correspondeAAlgumDominio(hostname, [
      "shopee.com.br",
      "shopee.com",
      "shope.ee",
    ])
  ) {
    return "shopee";
  }

  if (
    correspondeAAlgumDominio(hostname, [
      "magazineluiza.com.br",
      "magalu.com.br",
      "magalu.com",
      "magazinevoce.com.br",
      "influenciadormagalu.com.br",
      "parceiromagalu.com.br",
      "magazineluiza.onelink.me",
    ])
  ) {
    return "magazineluiza";
  }

  if (
    correspondeAAlgumDominio(hostname, [
      "casasbahia.com.br",
    ])
  ) {
    return "casasbahia";
  }

  if (
    correspondeAAlgumDominio(hostname, [
      "kabum.com.br",
    ])
  ) {
    return "kabum";
  }

  if (
    correspondeAAlgumDominio(hostname, [
      "terabyteshop.com.br",
    ])
  ) {
    return "terabyte";
  }

  if (
    correspondeAAlgumDominio(hostname, [
      "aliexpress.com",
      "aliexpress.us",
    ])
  ) {
    return "aliexpress";
  }

  if (
    correspondeAAlgumDominio(hostname, [
      "carrefour.com.br",
    ])
  ) {
    return "carrefour";
  }

  throw new Error(
    "Este link não pertence a um marketplace suportado pelo Ofertano.",
  );
}