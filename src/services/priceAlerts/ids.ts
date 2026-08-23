const MAX_ID_LENGTH = 80;

export function normalizarId(valor: unknown): string | null {
  if (typeof valor !== "string") {
    return null;
  }

  const id = valor.trim();

  if (!id || id.length > MAX_ID_LENGTH) {
    return null;
  }

  return id;
}
