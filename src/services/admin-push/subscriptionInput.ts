export type PushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
};

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function isHttpsEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export function parsePushSubscriptionBody(
  body: unknown,
  userAgentHeader?: string | null,
): PushSubscriptionInput | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const record = body as Record<string, unknown>;
  const keys =
    record.keys && typeof record.keys === "object"
      ? (record.keys as Record<string, unknown>)
      : record;

  const endpoint = readNonEmptyString(record.endpoint);
  const p256dh = readNonEmptyString(keys.p256dh);
  const auth = readNonEmptyString(keys.auth);

  if (!endpoint || !p256dh || !auth) {
    return null;
  }

  if (!isHttpsEndpoint(endpoint)) {
    return null;
  }

  if (endpoint.length > 2048 || p256dh.length > 512 || auth.length > 512) {
    return null;
  }

  const userAgent =
    readNonEmptyString(record.userAgent) ??
    (userAgentHeader?.trim() ? userAgentHeader.trim().slice(0, 500) : null);

  return {
    endpoint,
    p256dh,
    auth,
    userAgent,
  };
}

export function parseUnsubscribeEndpoint(body: unknown) {
  if (!body || typeof body !== "object") {
    return null;
  }

  const endpoint = readNonEmptyString(
    (body as Record<string, unknown>).endpoint,
  );

  if (!endpoint || !isHttpsEndpoint(endpoint)) {
    return null;
  }

  return endpoint;
}
