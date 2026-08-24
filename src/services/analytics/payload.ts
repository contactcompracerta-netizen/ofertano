import {
  ANALYTICS_DEVICE_TYPES,
  ANALYTICS_EVENT_TYPES,
  type AnalyticsDeviceType,
  type AnalyticsMetadata,
  type ValidatedAnalyticsEvent,
} from "./types";
import { classifyTrafficOrigin } from "./origin";
import { normalizeAnalyticsQuery } from "./query";

export const MAX_ANALYTICS_BODY_BYTES = 24 * 1024;
export const MAX_ANALYTICS_BATCH = 20;
export const MAX_METADATA_BYTES = 2048;
export const MAX_METADATA_KEYS = 20;
export const MAX_QUERY_LENGTH = 160;
export const MAX_SESSION_ID_LENGTH = 80;
export const MAX_PRODUCT_ID_LENGTH = 80;
export const MAX_MARKETPLACE_LENGTH = 40;
export const MAX_SOURCE_LENGTH = 80;
export const MAX_REFERRER_LENGTH = 200;
export const MAX_UTM_LENGTH = 100;
export const MAX_EVENT_TYPE_LENGTH = 40;

const PII_KEY_PATTERN =
  /^(name|nome|cpf|cnpj|rg|email|e-mail|address|endereco|endereço|phone|telefone|celular|password|senha|user[_-]?id|ip|credit[_-]?card|cartao|cartão|document)$/i;

const EVENT_TYPE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PayloadErrorCode =
  | "invalid_payload"
  | "empty_batch"
  | "batch_too_large"
  | "invalid_event"
  | "invalid_session"
  | "invalid_event_type"
  | "metadata_too_large"
  | "body_too_large";

export type PayloadParseResult =
  | {
      ok: true;
      events: ValidatedAnalyticsEvent[];
    }
  | {
      ok: false;
      code: PayloadErrorCode;
      error: string;
    };

function clip(value: string, max: number): string {
  return value.trim().slice(0, max);
}

function optionalString(
  value: unknown,
  max: number,
): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = clip(value, max);
  return trimmed.length > 0 ? trimmed : null;
}

function optionalInt(
  value: unknown,
  min: number,
  max: number,
): number | null {
  if (value == null || value === "") {
    return null;
  }

  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return null;
  }

  const rounded = Math.round(numeric);

  if (rounded < min || rounded > max) {
    return null;
  }

  return rounded;
}

export function isKnownAnalyticsEventType(
  value: string,
): value is (typeof ANALYTICS_EVENT_TYPES)[number] {
  return (ANALYTICS_EVENT_TYPES as readonly string[]).includes(value);
}

export function isValidSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= MAX_SESSION_ID_LENGTH &&
    SESSION_ID_PATTERN.test(value)
  );
}

export function isValidEventType(value: unknown): value is string {
  return typeof value === "string" && EVENT_TYPE_PATTERN.test(value);
}

function normalizeDeviceType(value: unknown): AnalyticsDeviceType {
  if (
    typeof value === "string" &&
    (ANALYTICS_DEVICE_TYPES as readonly string[]).includes(value)
  ) {
    return value as AnalyticsDeviceType;
  }

  return "unknown";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeMetadataValue(
  value: unknown,
): string | number | boolean | null | Array<string | number | boolean | null> | undefined {
  if (value == null) {
    return null;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > 1e9) {
      return undefined;
    }

    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim().slice(0, 200);
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(value)) {
    if (value.length > 20) {
      return undefined;
    }

    const items = value
      .slice(0, 20)
      .map((item) => {
        if (item == null) {
          return null;
        }

        if (typeof item === "boolean") {
          return item;
        }

        if (typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= 1e9) {
          return item;
        }

        if (typeof item === "string") {
          const trimmed = item.trim().slice(0, 80);
          return trimmed.length > 0 ? trimmed : null;
        }

        return undefined;
      })
      .filter((item): item is string | number | boolean | null => item !== undefined);

    return items;
  }

  return undefined;
}

export function sanitizeMetadata(
  value: unknown,
):
  | { ok: true; metadata: AnalyticsMetadata | null }
  | { ok: false; code: "metadata_too_large"; error: string } {
  if (value == null) {
    return { ok: true, metadata: null };
  }

  if (!isPlainObject(value)) {
    return {
      ok: false,
      code: "metadata_too_large",
      error: "metadata deve ser um objeto.",
    };
  }

  const keys = Object.keys(value);

  if (keys.length > MAX_METADATA_KEYS) {
    return {
      ok: false,
      code: "metadata_too_large",
      error: "metadata possui chaves demais.",
    };
  }

  const metadata: AnalyticsMetadata = {};

  for (const key of keys) {
    const safeKey = key.trim().slice(0, 40);

    if (!safeKey || PII_KEY_PATTERN.test(safeKey)) {
      continue;
    }

    const sanitized = sanitizeMetadataValue(value[key]);

    if (sanitized === undefined) {
      continue;
    }

    metadata[safeKey] = sanitized;
  }

  if (Object.keys(metadata).length === 0) {
    return { ok: true, metadata: null };
  }

  const serialized = JSON.stringify(metadata);

  if (serialized.length > MAX_METADATA_BYTES) {
    return {
      ok: false,
      code: "metadata_too_large",
      error: "metadata excede o tamanho máximo.",
    };
  }

  return { ok: true, metadata };
}

export function validateAnalyticsEvent(
  input: unknown,
):
  | { ok: true; event: ValidatedAnalyticsEvent }
  | { ok: false; code: PayloadErrorCode; error: string } {
  if (!isPlainObject(input)) {
    return {
      ok: false,
      code: "invalid_event",
      error: "Evento inválido.",
    };
  }

  if (!isValidEventType(input.eventType)) {
    return {
      ok: false,
      code: "invalid_event_type",
      error: "eventType inválido.",
    };
  }

  if (!isValidSessionId(input.sessionId)) {
    return {
      ok: false,
      code: "invalid_session",
      error: "sessionId inválido.",
    };
  }

  const metadataResult = sanitizeMetadata(input.metadata);

  if (!metadataResult.ok) {
    return metadataResult;
  }

  const query = optionalString(input.query, MAX_QUERY_LENGTH);
  const referrer = optionalString(input.referrer, MAX_REFERRER_LENGTH);
  const utmSource = optionalString(input.utmSource, MAX_UTM_LENGTH);
  const classifiedSource = classifyTrafficOrigin({
    referrerHost: referrer,
    utmSource,
  });

  return {
    ok: true,
    event: {
      eventType: input.eventType,
      sessionId: input.sessionId.trim(),
      productId: optionalString(input.productId, MAX_PRODUCT_ID_LENGTH),
      query,
      normalizedQuery: query ? normalizeAnalyticsQuery(query) : null,
      marketplace: optionalString(input.marketplace, MAX_MARKETPLACE_LENGTH),
      position: optionalInt(input.position, 0, 1000),
      resultCount: optionalInt(input.resultCount, 0, 10_000),
      source:
        optionalString(input.source, MAX_SOURCE_LENGTH) ?? classifiedSource,
      referrer,
      utmSource,
      utmMedium: optionalString(input.utmMedium, MAX_UTM_LENGTH),
      utmCampaign: optionalString(input.utmCampaign, MAX_UTM_LENGTH),
      utmContent: optionalString(input.utmContent, MAX_UTM_LENGTH),
      deviceType: normalizeDeviceType(input.deviceType),
      metadata: metadataResult.metadata,
    },
  };
}

export function parseAnalyticsRequest(
  body: unknown,
  bodyBytes = 0,
): PayloadParseResult {
  if (bodyBytes > MAX_ANALYTICS_BODY_BYTES) {
    return {
      ok: false,
      code: "body_too_large",
      error: "Payload grande demais.",
    };
  }

  if (body == null) {
    return {
      ok: false,
      code: "invalid_payload",
      error: "Payload inválido.",
    };
  }

  const rawEvents: unknown[] = Array.isArray(
    (body as { events?: unknown }).events,
  )
    ? ((body as { events: unknown[] }).events)
    : isPlainObject(body) && "eventType" in body
      ? [body]
      : [];

  if (rawEvents.length === 0) {
    return {
      ok: false,
      code: "empty_batch",
      error: "Nenhum evento enviado.",
    };
  }

  if (rawEvents.length > MAX_ANALYTICS_BATCH) {
    return {
      ok: false,
      code: "batch_too_large",
      error: "Lote de eventos grande demais.",
    };
  }

  const events: ValidatedAnalyticsEvent[] = [];

  for (const raw of rawEvents) {
    const parsed = validateAnalyticsEvent(raw);

    if (!parsed.ok) {
      return parsed;
    }

    events.push(parsed.event);
  }

  return { ok: true, events };
}
