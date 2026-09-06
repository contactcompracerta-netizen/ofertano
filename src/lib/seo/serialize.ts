/*
 * Serialização segura de JSON-LD.
 *
 * Escapa "<" para "\u003c" para evitar que qualquer valor injetado
 * feche o script inline e quebre o HTML da página.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}