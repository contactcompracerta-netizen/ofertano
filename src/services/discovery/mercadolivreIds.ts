export type MercadoLivreIdentityKind = "listing" | "catalog" | "user-product";

export type MercadoLivreIdentities = {
  catalogIds: string[];
  listingIds: string[];
  userProductIds: string[];
};

const LISTING_ID_PATTERN = /\bMLB(?!U)-?(\d{8,})\b/gi;
const USER_PRODUCT_PATTERN = /\bMLBU-?(\d{8,})\b/gi;
const USER_PRODUCT_PATH_PATTERN = /\/up\/(MLBU-?\d{8,})/gi;
const CATALOG_PATH_PATTERN = /\/p\/(MLB-?\d{8,})/gi;
const LISTING_PARAM_PATTERN =
  /(?:item_id|wid)\s*(?:=|:|%3[ad])\s*(MLB(?!U)-?\d{8,})/gi;
const PDP_FILTERS_PATTERN =
  /pdp_filters(?:=|%3[dD])[^&\s"'<>]*item_id(?:%3[aA]|:)(MLB(?!U)-?\d{8,})/gi;
const PRODUCT_HOST_PATTERN =
  /produto\.mercadolivre\.com\.br\/(MLB-\d{8,})/gi;

function compactId(raw: string): string {
  return raw.replace(/-/g, "").toUpperCase();
}

export function normalizeListingId(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const compact = compactId(raw);
  if (/^MLBU\d{8,}$/.test(compact)) {
    return null;
  }

  const withPrefix = compact.startsWith("MLB") ? compact : `MLB${compact}`;
  if (/^MLBU/.test(withPrefix)) {
    return null;
  }

  const match = withPrefix.match(/^MLB(\d{8,})$/);
  return match ? `MLB${match[1]}` : null;
}

export function normalizeUserProductId(
  raw: string | null | undefined,
): string | null {
  if (!raw) {
    return null;
  }

  const compact = compactId(raw);
  const match = compact.match(/^MLBU(\d{8,})$/);
  return match ? `MLBU${match[1]}` : null;
}

export function normalizeCatalogId(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  const userProduct = normalizeUserProductId(raw);
  if (userProduct) {
    return userProduct;
  }

  return normalizeListingId(raw);
}

export function isUserProductId(raw: string | null | undefined): boolean {
  return Boolean(normalizeUserProductId(raw));
}

export function isListingId(raw: string | null | undefined): boolean {
  return Boolean(normalizeListingId(raw)) && !isUserProductId(raw);
}

function pushUnique(target: string[], value: string | null): void {
  if (!value || target.includes(value)) {
    return;
  }

  target.push(value);
}

function decodeRepeated(value: string): string {
  let current = value;
  for (let index = 0; index < 3; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) {
        break;
      }
      current = decoded;
    } catch {
      break;
    }
  }

  return current;
}

export function extractMercadoLivreIdentities(source: string): MercadoLivreIdentities {
  const catalogIds: string[] = [];
  const listingIds: string[] = [];
  const userProductIds: string[] = [];
  const text = decodeRepeated(source);

  for (const match of text.matchAll(USER_PRODUCT_PATH_PATTERN)) {
    pushUnique(userProductIds, normalizeUserProductId(match[1]));
    pushUnique(catalogIds, normalizeUserProductId(match[1]));
  }

  for (const match of text.matchAll(USER_PRODUCT_PATTERN)) {
    const id = normalizeUserProductId(match[0]);
    pushUnique(userProductIds, id);
    pushUnique(catalogIds, id);
  }

  for (const match of text.matchAll(CATALOG_PATH_PATTERN)) {
    pushUnique(catalogIds, normalizeCatalogId(match[1]));
  }

  for (const match of text.matchAll(PDP_FILTERS_PATTERN)) {
    pushUnique(listingIds, normalizeListingId(match[1]));
  }

  for (const match of text.matchAll(LISTING_PARAM_PATTERN)) {
    pushUnique(listingIds, normalizeListingId(match[1]));
  }

  for (const match of text.matchAll(PRODUCT_HOST_PATTERN)) {
    pushUnique(listingIds, normalizeListingId(match[1]));
  }

  for (const match of text.matchAll(LISTING_ID_PATTERN)) {
    const around = text.slice(
      Math.max(0, (match.index ?? 0) - 8),
      (match.index ?? 0) + 12,
    );
    if (/\/p\//i.test(around) && !/wid=|item_id/i.test(around)) {
      pushUnique(catalogIds, normalizeListingId(match[0]));
      continue;
    }

    pushUnique(listingIds, normalizeListingId(match[0]));
  }

  return {
    catalogIds,
    listingIds,
    userProductIds,
  };
}

export function extractMercadoLivreIdentitiesFromUrl(url: string): MercadoLivreIdentities {
  const identities = extractMercadoLivreIdentities(url);

  try {
    const parsed = new URL(url);
    const itemId = parsed.searchParams.get("item_id");
    const wid = parsed.searchParams.get("wid");
    const filters = parsed.searchParams.get("pdp_filters") ?? "";

    if (itemId) {
      const listing = normalizeListingId(itemId);
      if (listing && !identities.listingIds.includes(listing)) {
        identities.listingIds.push(listing);
      }
    }

    if (wid) {
      const listing = normalizeListingId(wid);
      if (listing && !identities.listingIds.includes(listing)) {
        identities.listingIds.push(listing);
      }
    }

    if (filters) {
      const fromFilters = extractMercadoLivreIdentities(filters);
      for (const listing of fromFilters.listingIds) {
        if (!identities.listingIds.includes(listing)) {
          identities.listingIds.push(listing);
        }
      }
    }

    const userProduct = parsed.pathname.match(/\/up\/(MLBU-?\d+)/i)?.[1];
    if (userProduct) {
      const id = normalizeUserProductId(userProduct);
      if (id && !identities.userProductIds.includes(id)) {
        identities.userProductIds.push(id);
      }
      if (id && !identities.catalogIds.includes(id)) {
        identities.catalogIds.push(id);
      }
    }
  } catch {
    // URL relativa ou fragmento HTML: o parser de texto ja cobriu os sinais.
  }

  return identities;
}

export function classifyMercadoLivreId(
  raw: string,
): MercadoLivreIdentityKind | null {
  if (normalizeUserProductId(raw)) {
    return "user-product";
  }

  if (normalizeListingId(raw)) {
    return "listing";
  }

  return null;
}
