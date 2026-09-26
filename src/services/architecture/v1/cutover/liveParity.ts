/**
 * CATALOG_ARCHITECTURE_V1 — PARIDADE PÓS-COMMIT LIVE (FASE 7.1).
 *
 * Read-back do catálogo DEPOIS que o Prisma confirmou o commit da transação
 * canônica. É a prova de que o caminho autoritativo V1 gravou exatamente o que
 * o caminho legado gravaria.
 *
 * Por que só depois do commit:
 *   Ler DENTRO da transação (ou antes dela) enxergaria estado pré-commit e
 *   acusaria uma diferença de paridade inexistente — ou, pior, leria de outra
 *   conexão algo que ainda não foi confirmado e abriria o breaker por um falso
 *   positivo. Por isso a leitura é sempre pós-confirmação.
 *
 * Por que existe mesmo assim (o V1 e o legado são o MESMO `saveProduct`):
 *   "mesmo código" é um argumento de construção, não uma medição. O canário
 *   LIVE precisa de uma medição independente do resultado no banco, e é
 *   também a única forma de detectar que o gate global concedeu permissão e a
 *   escrita foi de fato efetivada (permite gasto = escrita real).
 *
 * Classificação:
 *   MATCH                 — tudo confere.
 *   EXPECTED_DIFFERENCE   — divergência de normalização DOCUMENTADA e
 *                           segura (oldPrice/available/publicação). Não é
 *                           violação e NÃO abre o breaker.
 *   UNEXPECTED_DIFFERENCE — preço, identidade do produto ou oferta ausente.
 *                           É violação real: abre o breaker global.
 *   UNREADABLE           — a leitura falhou. NÃO é prova de violação, logo
 *                           NÃO abre o breaker (fail-safe contra alarme falso,
 *                           fail-closed no sentido de não manufacturing
 *                           incidente); o run é marcado para investigação.
 */

import type { PrismaClient } from "@prisma/client";

export type LiveParityVerdict =
  | "MATCH"
  | "EXPECTED_DIFFERENCE"
  | "UNEXPECTED_DIFFERENCE"
  | "UNREADABLE";

export type LivePostWriteObservation = {
  verdict: LiveParityVerdict;
  /** Motivo canônico, estável (usado no relatório e no evento de controle). */
  reason: string;
  marketplaceId: string;
  externalListingId: string;
  productId: string | null;
  offerId: string | null;
  /** Campos comparados: `null` quando ilegível. */
  observed: Record<string, unknown> | null;
  /** Divergências individuais (campo, esperado, observado). */
  differences: Array<{
    field: string;
    expected: unknown;
    observed: unknown;
    severity: "EXPECTED" | "UNEXPECTED";
  }>;
};

/** Leitura mínima do catálogo para a prova de paridade. */
export type LivePostWriteRow = {
  productId: string;
  offerId: string;
  price: number;
  oldPrice: number | null;
  stock: number | null;
  available: boolean;
  active: boolean;
  publicationStatus: string;
};

export interface LivePostWriteReader {
  read(input: {
    marketplace: string;
    externalListingId: string;
  }): Promise<LivePostWriteRow | null>;
}

/** Leitor real sobre o Prisma do catálogo. */
export function createPrismaLivePostWriteReader(
  prisma: PrismaClient,
): LivePostWriteReader {
  return {
    async read(input) {
      const offer = await prisma.marketplaceOffer.findUnique({
        where: {
          marketplace_externalId: {
            marketplace: input.marketplace as never,
            externalId: input.externalListingId,
          },
        },
        include: {
          product: {
            select: {
              id: true,
              active: true,
              publicationStatus: true,
            },
          },
        },
      });

      if (!offer?.product) {
        return null;
      }

      return {
        productId: offer.productId,
        offerId: offer.id,
        price: Number(offer.price),
        oldPrice: offer.oldPrice === null ? null : Number(offer.oldPrice),
        stock: offer.stock,
        available: offer.available,
        active: offer.product.active,
        publicationStatus: offer.product.publicationStatus,
      };
    },
  };
}

export type LiveParityInput = {
  marketplace: string;
  marketplaceId: string;
  externalListingId: string;
  expectedProductId: string;
  intendedPrice: number;
  intendedOldPrice: number | null;
  intendedStock: number | null;
  intendedAvailable: boolean;
};

function sameNumber(a: number | null, b: number | null): boolean {
  if (a === null && b === null) {
    return true;
  }
  if (a === null || b === null) {
    return false;
  }
  // Tolerância de ponto flutuante: o preço trafega como float no banco.
  return Math.abs(a - b) < 0.000001;
}

/**
 * Compara o estado commitado com o que a transação canônica deveria ter
 * gravado. NUNCA lança: uma prova de paridade que derruba o saveProduct
 * transformaria um problema de observabilidade em perda de escrita.
 */
export async function observeLivePostWrite(
  reader: LivePostWriteReader,
  input: LiveParityInput,
): Promise<LivePostWriteObservation> {
  const base = {
    marketplaceId: input.marketplaceId,
    externalListingId: input.externalListingId,
  };

  let row: LivePostWriteRow | null;
  try {
    row = await reader.read({
      marketplace: input.marketplace,
      externalListingId: input.externalListingId,
    });
  } catch (error) {
    return {
      verdict: "UNREADABLE",
      reason: `read-falhou:${
        error instanceof Error ? error.message : String(error)
      }`.slice(0, 300),
      ...base,
      productId: null,
      offerId: null,
      observed: null,
      differences: [],
    };
  }

  if (!row) {
    return {
      verdict: "UNEXPECTED_DIFFERENCE",
      reason: "oferta-inexistente-apos-commit",
      ...base,
      productId: null,
      offerId: null,
      observed: null,
      differences: [
        {
          field: "offer",
          expected: "presente",
          observed: "ausente",
          severity: "UNEXPECTED",
        },
      ],
    };
  }

  const differences: LivePostWriteObservation["differences"] = [];
  const observed = { ...row } as unknown as Record<string, unknown>;

  /*
   * IDENTIDADE — a mais grave. Se a oferta commitada pertence a OUTRO
   * produto, o writer V1 não preservou a identidade canônica: é
   * duplicação/duplicação real e abre o breaker.
   */
  if (row.productId !== input.expectedProductId) {
    differences.push({
      field: "productId",
      expected: input.expectedProductId,
      observed: row.productId,
      severity: "UNEXPECTED",
    });
  }

  /*
   * PREÇO — paridade por construção. Divergência aqui significa que o
   * caminho autoritativo gravou um valor diferente do legado: violação real.
   */
  if (!sameNumber(row.price, input.intendedPrice)) {
    differences.push({
      field: "price",
      expected: input.intendedPrice,
      observed: row.price,
      severity: "UNEXPECTED",
    });
  }

  /*
   * NORMALIZAÇÕES DOCUMENTADAS — divergência esperada e segura.
   *
   * `oldPrice`: a transação canônica pode normalizar `oldPrice` para `null`
   * quando ele é igual ao preço (não há "de" real) ou quando não é número.
   * `available`: derivada de `stock` e do `status` da oferta, não é campo
   * livre. `active`/`publicationStatus`: depende de quantos marketplaces
   * PÚBLICOS distintos o produto tem (gate multiloja) — nada a ver com o
   * writer, e é exatamente o invariante que NÃO pode ser afetado aqui.
   */
  if (!sameNumber(row.oldPrice, input.intendedOldPrice)) {
    differences.push({
      field: "oldPrice",
      expected: input.intendedOldPrice,
      observed: row.oldPrice,
      severity: "EXPECTED",
    });
  }

  if (row.stock !== input.intendedStock) {
    differences.push({
      field: "stock",
      expected: input.intendedStock,
      observed: row.stock,
      severity: "EXPECTED",
    });
  }

  if (row.available !== input.intendedAvailable) {
    differences.push({
      field: "available",
      expected: input.intendedAvailable,
      observed: row.available,
      severity: "EXPECTED",
    });
  }

  const unexpected = differences.filter((d) => d.severity === "UNEXPECTED");
  const expected = differences.filter((d) => d.severity === "EXPECTED");

  if (unexpected.length > 0) {
    return {
      verdict: "UNEXPECTED_DIFFERENCE",
      reason: unexpected.map((d) => d.field).join(","),
      ...base,
      productId: row.productId,
      offerId: row.offerId,
      observed,
      differences,
    };
  }

  if (expected.length > 0) {
    return {
      verdict: "EXPECTED_DIFFERENCE",
      reason: expected.map((d) => d.field).join(","),
      ...base,
      productId: row.productId,
      offerId: row.offerId,
      observed,
      differences,
    };
  }

  return {
    verdict: "MATCH",
    reason: "paridade-exata",
    ...base,
    productId: row.productId,
    offerId: row.offerId,
    observed,
    differences: [],
  };
}
