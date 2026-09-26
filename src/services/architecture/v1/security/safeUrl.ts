/**
 * CATALOG_ARCHITECTURE_V1 — SAFE URL (FASE R).
 *
 * Fonte externa NUNCA escolhe o esquema do link que persistimos. Um payload
 * de marketplace pode conter javascript:, data:, file: ou qualquer esquema
 * inesperado; persistir isso converte um bug de integracao em XSS armazenado
 * na superficie publica.
 *
 * Regra (fail-closed):
 *   - allowlist de esquemas: SOMENTE http/https;
 *   - URL relativa e rejeitada (nao inventamos base);
 *   - credenciais embebidas (user:pass@) sao rejeitadas;
 *   - byte de controle/espao no meio do esquema e removido antes do parse, senao
 *     um esquema ofuscado escaparia da comparacao textual.
 *
 * Nenhuma regra aqui conhece nome de marketplace: e utilitario de URL.
 */

/* Unicos esquemas aceitos para persistencia de link de oferta. */
export const SAFE_URL_SCHEMES = ["http:", "https:"] as const;

/* Hosts locais rejeitados: nunca sao destino valido de link de oferta. */
const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
]);

/**
 * Remove bytes de controle e espacos que o parser de URL ignora ao resolver o
 * esquema. Implementado por codigo de caractere (sem regex) para que o proprio
 * arquivo nunca contenha um intervalo de controle literal.
 */
function stripUrlNoise(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    const isControlOrSpace = code <= 0x20 || code === 0x7f;
    if (!isControlOrSpace) {
      out += value[i];
    }
  }
  return out;
}

export interface SafeUrlResult {
  ok: boolean;
  /* URL normalizada, pronta para persistir. So faz sentido quando ok=true. */
  url: string | null;
  /* Codigo estavel de rejeicao (diagnostico). null quando ok. */
  reason:
    | null
    | "EMPTY"
    | "NOT_A_STRING"
    | "UNSAFE_SCHEME"
    | "MALFORMED_URL"
    | "EMBEDDED_CREDENTIALS"
    | "LOCAL_HOST";
}

/**
 * Valida e normaliza uma URL vinda de fonte externa.
 * Devolve SEMPRE um resultado — nunca lanca — para que o chamador registre a
 * rejeicao como rejeicao de payload, e nao como erro de sistema.
 */
export function toSafeExternalUrl(input: unknown): SafeUrlResult {
  if (typeof input !== "string") {
    return { ok: false, url: null, reason: "NOT_A_STRING" };
  }

  const cleaned = stripUrlNoise(input).trim();

  if (cleaned === "") {
    return { ok: false, url: null, reason: "EMPTY" };
  }

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return { ok: false, url: null, reason: "MALFORMED_URL" };
  }

  if (!(SAFE_URL_SCHEMES as readonly string[]).includes(parsed.protocol)) {
    return { ok: false, url: null, reason: "UNSAFE_SCHEME" };
  }

  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, url: null, reason: "EMBEDDED_CREDENTIALS" };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "" || LOCAL_HOSTNAMES.has(hostname)) {
    return { ok: false, url: null, reason: "LOCAL_HOST" };
  }

  return { ok: true, url: parsed.toString(), reason: null };
}

/* true quando a URL e segura para persistir. */
export function isSafeExternalUrl(input: unknown): boolean {
  return toSafeExternalUrl(input).ok;
}

/**
 * Filtro de array: mantem somente URLs seguras e deduplicadas, preservando a
 * ordem de ocorrencia. Entradas rejeitadas sao descartadas (fail-closed).
 */
export function filterSafeExternalUrls(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    const result = toSafeExternalUrl(item);
    if (!result.ok || result.url === null) continue;
    if (seen.has(result.url)) continue;
    seen.add(result.url);
    out.push(result.url);
  }
  return out;
}
