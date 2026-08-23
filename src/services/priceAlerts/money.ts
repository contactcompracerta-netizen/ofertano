/**
 * O schema atual armazena preços em Float.
 * Comparações de alerta usam centavos inteiros para evitar
 * erros clássicos de ponto flutuante sem migrar o sistema financeiro.
 */
export function precoEmCentavos(valor: number): number {
  return Math.round(valor * 100);
}

export function precosIguais(a: number, b: number): boolean {
  return precoEmCentavos(a) === precoEmCentavos(b);
}

export function precoEhMenor(a: number, b: number): boolean {
  return precoEmCentavos(a) < precoEmCentavos(b);
}

export function precoEhMenorOuIgual(a: number, b: number): boolean {
  return precoEmCentavos(a) <= precoEmCentavos(b);
}

export function normalizarPreco(valor: unknown): number | null {
  if (typeof valor === "number") {
    if (!Number.isFinite(valor) || valor <= 0) {
      return null;
    }

    return Math.round(valor * 100) / 100;
  }

  if (typeof valor !== "string") {
    return null;
  }

  const texto = valor.trim();

  if (!texto) {
    return null;
  }

  const numero = Number(texto.replace(",", "."));

  if (!Number.isFinite(numero) || numero <= 0) {
    return null;
  }

  return Math.round(numero * 100) / 100;
}
