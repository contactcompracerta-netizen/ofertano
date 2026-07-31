export function criarSlug(texto: string): string {
    return texto
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120);
  }
  
  export function calcularDesconto(
    preco: number,
    precoAntigo: number | null
  ): number | null {
    if (!precoAntigo || precoAntigo <= preco) {
      return null;
    }
  
    return Math.round(
      ((precoAntigo - preco) / precoAntigo) * 100
    );
  }
  
  export function criarParcelamento(
    preco: number
  ): string | null {
    if (!Number.isFinite(preco) || preco <= 0) {
      return null;
    }
  
    const parcelas = 12;
    const valor = preco / parcelas;
  
    return `${parcelas}x de ${new Intl.NumberFormat(
      "pt-BR",
      {
        style: "currency",
        currency: "BRL",
      }
    ).format(valor)}`;
  }