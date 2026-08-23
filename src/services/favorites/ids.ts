const MAX_PRODUCT_ID_LENGTH = 80;

export function normalizarId(valor: unknown): string | null {
  if (typeof valor !== "string") {
    return null;
  }

  const id = valor.trim();

  if (!id || id.length > MAX_PRODUCT_ID_LENGTH) {
    return null;
  }

  return id;
}

export function normalizarIds(valor: unknown): string[] {
  if (!Array.isArray(valor)) {
    return [];
  }

  return Array.from(
    new Set(
      valor
        .map((item) => normalizarId(item))
        .filter((item): item is string => Boolean(item))
    )
  );
}

export function unirIdsFavoritos(
  idsLocais: string[],
  idsRemotos: string[]
): string[] {
  return Array.from(
    new Set([...idsRemotos, ...normalizarIds(idsLocais)])
  );
}
