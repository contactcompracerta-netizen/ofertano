import type { TrafficOrigin } from "./types";
import { referrerHostFromUrl } from "./utm";

const OWN_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "ofertano.vercel.app",
  "ofertano.com.br",
  "www.ofertano.com.br",
]);

function isOwnHost(host: string): boolean {
  if (OWN_HOSTS.has(host)) {
    return true;
  }

  return (
    host.endsWith(".localhost") ||
    host.endsWith(".ofertano.vercel.app") ||
    host.endsWith(".ofertano.com.br")
  );
}

function isGoogleHost(host: string): boolean {
  return (
    host === "google.com" ||
    host.endsWith(".google.com") ||
    host === "google.com.br" ||
    host.endsWith(".google.com.br") ||
    host === "googleads.g.doubleclick.net" ||
    host.endsWith(".googleadservices.com")
  );
}

function isInstagramHost(host: string): boolean {
  return (
    host === "instagram.com" ||
    host.endsWith(".instagram.com") ||
    host === "l.instagram.com"
  );
}

function isFacebookHost(host: string): boolean {
  return (
    host === "facebook.com" ||
    host.endsWith(".facebook.com") ||
    host === "fb.com" ||
    host.endsWith(".fb.com") ||
    host === "l.facebook.com" ||
    host === "lm.facebook.com" ||
    host === "m.facebook.com"
  );
}

export function classifyTrafficOrigin(input: {
  referrerHost?: string | null;
  utmSource?: string | null;
}): TrafficOrigin {
  const utm = input.utmSource?.trim().toLowerCase() ?? "";
  const host = (
    input.referrerHost?.trim() ||
    referrerHostFromUrl(input.referrerHost) ||
    ""
  )
    .toLowerCase()
    .replace(/^www\./, "");

  if (
    utm === "google" ||
    utm.startsWith("google_") ||
    utm === "googleads" ||
    utm === "adwords" ||
    isGoogleHost(host)
  ) {
    return "Google";
  }

  if (utm === "instagram" || utm === "ig" || isInstagramHost(host)) {
    return "Instagram";
  }

  if (
    utm === "facebook" ||
    utm === "fb" ||
    utm === "meta" ||
    isFacebookHost(host)
  ) {
    return "Facebook";
  }

  if (utm) {
    return "Outras";
  }

  if (!host || isOwnHost(host)) {
    return "Direct";
  }

  return "Outras";
}
