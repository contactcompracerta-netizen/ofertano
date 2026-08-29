const VAPID_PUBLIC_ENV = "WEB_PUSH_VAPID_PUBLIC_KEY";
const VAPID_PRIVATE_ENV = "WEB_PUSH_VAPID_PRIVATE_KEY";
const VAPID_SUBJECT_ENV = "WEB_PUSH_VAPID_SUBJECT";

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value || null;
}

export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export function readVapidPublicKey() {
  return readEnv(VAPID_PUBLIC_ENV);
}

export function readVapidConfig(): VapidConfig | null {
  const publicKey = readEnv(VAPID_PUBLIC_ENV);
  const privateKey = readEnv(VAPID_PRIVATE_ENV);
  const subject =
    readEnv(VAPID_SUBJECT_ENV) ?? "mailto:admin@ofertano.com.br";

  if (!publicKey || !privateKey) {
    return null;
  }

  return {
    publicKey,
    privateKey,
    subject,
  };
}

export function assertPrivateKeyHidden(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return true;
  }

  const record = payload as Record<string, unknown>;
  return (
    !("privateKey" in record) &&
    !("VAPID_PRIVATE_KEY" in record) &&
    !(
      typeof record.publicKey === "string" &&
      record.publicKey === readEnv(VAPID_PRIVATE_ENV)
    )
  );
}
