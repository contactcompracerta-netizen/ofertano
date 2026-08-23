import { EditorialError } from "./errors";

export function extrairJsonDesconhecido(
  raw: string,
): unknown {
  const trimmed = raw.trim();

  if (!trimmed) {
    throw new EditorialError(
      "INVALID_JSON",
      "A resposta da IA veio vazia.",
    );
  }

  const fenced = trimmed.match(
    /```(?:json)?\s*([\s\S]*?)```/i,
  );
  const payload = (fenced?.[1] ?? trimmed).trim();

  try {
    return JSON.parse(payload);
  } catch {
    const start = payload.indexOf("{");
    const end = payload.lastIndexOf("}");

    if (start >= 0 && end > start) {
      try {
        return JSON.parse(payload.slice(start, end + 1));
      } catch {
        // cai no erro padrão abaixo
      }
    }

    throw new EditorialError(
      "INVALID_JSON",
      "A resposta da IA não é um JSON válido.",
    );
  }
}
