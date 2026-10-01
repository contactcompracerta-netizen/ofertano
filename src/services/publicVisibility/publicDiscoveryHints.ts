import prisma from "@/lib/prisma";

import {
  PUBLIC_MULTISTORE_MIN_MARKETPLACES,
  hasPublicMultiStore,
  multiStorePublicWhere,
} from "@/services/publicVisibility/multiStoreVisibility";

/*
 * DICAS DE DESCOBERTA DA BUSCA (estado "0 resultado").
 *
 * Um estado vazio que só diz "não encontramos" é uma parede. A missão de
 * catálogo pede, sem inventar nada: resultado nenhum, sugestões ÚTEIS e
 * categorias RELACIONADAS.
 *
 * As duas listas saem do MESMO conjunto público que a Home já renderiza
 * (`multiStorePublicWhere` + `hasPublicMultiStore`), ou seja, de produtos
 * que existem e são visíveis. Nada é literal, nada é sugerido de uma
 * tabela fixa de palavras: se o catálogo não tem a categoria, a categoria
 * não aparece. Isso é o oposto de fabricar produto.
 */

export type DicaDeCategoria = {
  nome: string;
  quantidade: number;
};

export type DicaDeBusca = {
  termo: string;
  quantidade: number;
};

export type DicasPublicas = {
  categorias: DicaDeCategoria[];
  buscas: DicaDeBusca[];
};

function normalizarRotulo(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\s+/g, " ").trim();
}

function ehRotuloUtil(valor: string): boolean {
  if (valor.length < 3 || valor.length > 48) {
    return false;
  }

  /*
   * Rótulo demarque/placeholder não é sugestão de busca: levaria o
   * usuário a uma nova busca vazia.
   */
  return !/^(sem|nao|não|sem definicao|sem definição|null|undefined|n\/a)$/i.test(
    valor,
  );
}

/**
 * Monta as dicas a partir de produtos JÁ filtrados como públicos.
 * Puro, para ser testado sem banco.
 */
export function derivarDicasPublicas(
  produtos: Array<{ category?: string | null; brand?: string | null }>,
  limite = 6,
): DicasPublicas {
  const categorias = new Map<string, number>();
  const buscas = new Map<string, number>();

  for (const produto of produtos) {
    const categoria = normalizarRotulo(produto.category);
    const marca = normalizarRotulo(produto.brand);

    if (ehRotuloUtil(categoria)) {
      categorias.set(categoria, (categorias.get(categoria) ?? 0) + 1);
    }

    if (ehRotuloUtil(marca)) {
      buscas.set(marca, (buscas.get(marca) ?? 0) + 1);
    }
  }

  const ordenarRotulo = (
    chave: string,
    quantidade: number,
  ): { rotulo: string; quantidade: number } => ({ rotulo: chave, quantidade });

  const ordenar = (
    itens: Map<string, number>,
    para: (chave: string, quantidade: number) => { rotulo: string; quantidade: number },
  ): { rotulo: string; quantidade: number }[] => {
    return Array.from(itens.entries())
      .map(([chave, quantidade]) => para(chave, quantidade))
      .sort((a, b) => {
        if (b.quantidade !== a.quantidade) {
          return b.quantidade - a.quantidade;
        }

        return a.rotulo.localeCompare(b.rotulo, "pt-BR");
      })
      .slice(0, limite);
  };

  const categoriasOrdenadas = ordenar(categorias, ordenarRotulo);
  const buscasOrdenadas = ordenar(buscas, ordenarRotulo);

  return {
    categorias: categoriasOrdenadas.map(({ rotulo, quantidade }) => ({
      nome: rotulo,
      quantidade,
    })),
    buscas: buscasOrdenadas.map(({ rotulo, quantidade }) => ({
      termo: rotulo,
      quantidade,
    })),
  };
}

/**
 * Lê do banco apenas o que a Home já considera público.
 */
export async function listarDicasPublicas(
  limite = 6,
): Promise<DicasPublicas> {
  const produtos = await prisma.product.findMany({
    where: {
      active: true,
      price: { gt: 0 },
      image: { not: "" },
      AND: multiStorePublicWhere().AND,
    },
    select: {
      category: true,
      brand: true,
      offers: {
        where: { active: true, matchStatus: "EXACT" },
        select: {
          marketplace: true,
          available: true,
          status: true,
          price: true,
          externalId: true,
          sourceUrl: true,
        },
      },
    },
    take: 500,
  });

  const publicos = produtos.filter(
    (produto) =>
      produto.offers.length >= PUBLIC_MULTISTORE_MIN_MARKETPLACES &&
      hasPublicMultiStore(produto),
  );

  return derivarDicasPublicas(publicos, limite);
}
