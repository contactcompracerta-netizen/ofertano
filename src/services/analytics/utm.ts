import type { ParsedUtmParams } from "./types";

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
] as const;

function readParam(
  params: URLSearchParams,
  key: (typeof UTM_KEYS)[number],
): string | null {
  const value = params.get(key)?.trim().slice(0, 100) ?? "";
  return value.length > 0 ? value : null;
}

export function parseUtmParams(
  search: string | URLSearchParams,
): ParsedUtmParams {
  const params =
    typeof search === "string"
      ? new URLSearchParams(
          search.startsWith("?") ? search.slice(1) : search,
        )
      : search;

  return {
    utmSource: readParam(params, "utm_source"),
    utmMedium: readParam(params, "utm_medium"),
    utmCampaign: readParam(params, "utm_campaign"),
    utmContent: readParam(params, "utm_content"),
  };
}

export function referrerHostFromUrl(value: string | null | undefined): string | null {
  const raw = value?.trim();

  if (!raw) {
    return null;
  }

  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host.slice(0, 200) || null;
  } catch {
    const host = raw
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      ?.toLowerCase()
      .replace(/^www\./, "")
      .slice(0, 200);

    return host || null;
  }
}
