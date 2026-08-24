import { classifyTrafficOrigin } from "@/services/analytics/origin";
import { parseUtmParams, referrerHostFromUrl } from "@/services/analytics/utm";
import type { AnalyticsDeviceType } from "@/services/analytics/types";
import {
  LISTING_OCCURRENCE_STORAGE_KEY,
  TimedDedupeIndex,
  buildClientDuplicateKey,
  duplicateWindowMs,
  parseListingOccurrence,
  shouldReuseListingOccurrence,
  type ListingOccurrence,
} from "@/lib/analytics/impression";

const SESSION_STORAGE_KEY = "ofertano:analytics:sid";
const ATTR_STORAGE_KEY = "ofertano:analytics:attr";
const LAST_QUERY_KEY = "ofertano:analytics:lastQuery";
const COOKIE_NAME = "ofertano_aid";
const ENDPOINT = "/api/analytics/events";
const FLUSH_DELAY_MS = 400;
const MAX_QUEUE = 10;

type Attribution = {
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  source: string;
};

export type ClientAnalyticsEvent = {
  eventType: string;
  productId?: string | null;
  query?: string | null;
  marketplace?: string | null;
  position?: number | null;
  resultCount?: number | null;
  metadata?: Record<string, unknown> | null;
};

type QueuedEvent = ClientAnalyticsEvent & {
  sessionId: string;
  source: string;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  deviceType: AnalyticsDeviceType;
};

const recentKeys = new TimedDedupeIndex();
let queue: QueuedEvent[] = [];
let flushTimer: number | null = null;
let listenersBound = false;

function canTrack(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const path = window.location.pathname;
  return !path.startsWith("/admin") && !path.startsWith("/api");
}

function readCookie(name: string): string | null {
  const parts = document.cookie.split("; ");
  for (const part of parts) {
    if (part.startsWith(`${name}=`)) {
      return decodeURIComponent(part.slice(name.length + 1));
    }
  }
  return null;
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=34560000; Path=/; SameSite=Lax`;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function getAnalyticsSessionId(): string {
  const fromCookie = readCookie(COOKIE_NAME);
  if (fromCookie && isUuid(fromCookie)) {
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, fromCookie);
    } catch {
      // ignore quota
    }
    return fromCookie;
  }

  try {
    const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (stored && isUuid(stored)) {
      writeCookie(COOKIE_NAME, stored);
      return stored;
    }
  } catch {
    // ignore
  }

  const created =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;

  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, created);
  } catch {
    // ignore
  }

  writeCookie(COOKIE_NAME, created);
  return created;
}

function detectClientDevice(): AnalyticsDeviceType {
  const ua = window.navigator.userAgent;
  if (/iPad|Tablet|PlayBook/i.test(ua) || (window.navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua))) {
    return "tablet";
  }
  if (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 840) {
    return "mobile";
  }
  if (/Mobile|iPhone|Android.+Mobile/i.test(ua)) {
    return "mobile";
  }
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) {
    return "tablet";
  }
  return "desktop";
}

export function getAnalyticsAttribution(): Attribution {
  try {
    const stored = window.sessionStorage.getItem(ATTR_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Attribution;
      if (parsed && typeof parsed.source === "string") {
        return parsed;
      }
    }
  } catch {
    // ignore
  }

  const utm = parseUtmParams(window.location.search);
  const referrer = referrerHostFromUrl(document.referrer);
  const source = classifyTrafficOrigin({
    referrerHost: referrer,
    utmSource: utm.utmSource,
  });

  const attribution: Attribution = {
    referrer,
    utmSource: utm.utmSource,
    utmMedium: utm.utmMedium,
    utmCampaign: utm.utmCampaign,
    utmContent: utm.utmContent,
    source,
  };

  try {
    window.sessionStorage.setItem(ATTR_STORAGE_KEY, JSON.stringify(attribution));
  } catch {
    // ignore
  }

  return attribution;
}

export function rememberAnalyticsQuery(query: string) {
  const value = query.replace(/\s+/g, " ").trim().slice(0, 160);
  if (!value) {
    return;
  }

  try {
    window.sessionStorage.setItem(LAST_QUERY_KEY, value);
  } catch {
    // ignore
  }
}

export function getRememberedAnalyticsQuery(): string | null {
  try {
    return window.sessionStorage.getItem(LAST_QUERY_KEY);
  } catch {
    return null;
  }
}

function readListingOccurrence(): ListingOccurrence | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return parseListingOccurrence(
      window.sessionStorage.getItem(LISTING_OCCURRENCE_STORAGE_KEY),
    );
  } catch {
    return null;
  }
}

function writeListingOccurrence(occurrence: ListingOccurrence) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      LISTING_OCCURRENCE_STORAGE_KEY,
      JSON.stringify(occurrence),
    );
  } catch {
    // ignore quota
  }
}

export function beginListingOccurrence(surface: string, scope = ""): string {
  if (typeof window === "undefined") {
    return "";
  }

  const normalizedScope = scope.replace(/\s+/g, " ").trim();
  const now = Date.now();
  const previous = readListingOccurrence();

  if (
    shouldReuseListingOccurrence(
      previous,
      { surface, scope: normalizedScope },
      now,
    )
  ) {
    return previous!.id;
  }

  const created =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0").slice(-12)}`;

  const occurrence: ListingOccurrence = {
    id: created,
    surface,
    scope: normalizedScope,
    startedAt: now,
  };

  writeListingOccurrence(occurrence);
  return occurrence.id;
}

export function getListingOccurrenceId(): string | null {
  return readListingOccurrence()?.id ?? null;
}

export function ensureListingOccurrence(
  surface: string,
  scope = "",
): string {
  return getListingOccurrenceId() ?? beginListingOccurrence(surface, scope);
}

function bindFlushListeners() {
  if (listenersBound) {
    return;
  }

  listenersBound = true;

  const flushHidden = () => {
    if (document.visibilityState === "hidden") {
      flushAnalyticsQueue(true);
    }
  };

  document.addEventListener("visibilitychange", flushHidden);
  window.addEventListener("pagehide", () => flushAnalyticsQueue(true));
}

function sendPayload(events: QueuedEvent[], keepalive: boolean) {
  const body = JSON.stringify({ events });

  try {
    if (keepalive && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
      if (navigator.sendBeacon(ENDPOINT, blob)) {
        return;
      }
    }
  } catch {
    // fallback to fetch
  }

  void fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
    keepalive,
    credentials: "same-origin",
  }).catch(() => {
    // analytics never blocks the user
  });
}

export function flushAnalyticsQueue(keepalive = false) {
  if (flushTimer != null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (queue.length === 0) {
    return;
  }

  const events = queue;
  queue = [];
  sendPayload(events, keepalive);
}

function enqueue(event: QueuedEvent, immediate: boolean) {
  queue.push(event);
  bindFlushListeners();

  if (immediate || queue.length >= MAX_QUEUE) {
    flushAnalyticsQueue(immediate);
    return;
  }

  if (flushTimer == null) {
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      flushAnalyticsQueue(false);
    }, FLUSH_DELAY_MS);
  }
}

export function trackAnalyticsEvent(
  event: ClientAnalyticsEvent,
  options?: { immediate?: boolean },
) {
  if (!canTrack()) {
    return;
  }

  const eventType = event.eventType?.trim();
  if (!eventType) {
    return;
  }

  const duplicateWindow = duplicateWindowMs(eventType);
  const duplicateKey = buildClientDuplicateKey(event);

  if (recentKeys.shouldSkip(duplicateKey, duplicateWindow)) {
    return;
  }

  const attribution = getAnalyticsAttribution();
  const queued: QueuedEvent = {
    ...event,
    sessionId: getAnalyticsSessionId(),
    source: attribution.source,
    referrer: attribution.referrer,
    utmSource: attribution.utmSource,
    utmMedium: attribution.utmMedium,
    utmCampaign: attribution.utmCampaign,
    utmContent: attribution.utmContent,
    deviceType: detectClientDevice(),
  };

  enqueue(queued, options?.immediate === true);
}

export function bootstrapAnalytics() {
  if (!canTrack()) {
    return;
  }

  getAnalyticsSessionId();
  getAnalyticsAttribution();
  bindFlushListeners();
}
