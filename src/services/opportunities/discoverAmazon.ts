import prisma from "@/lib/prisma";
import { buscarAmazon } from "@/services/discovery/amazon";

const DEFAULT_QUANTITY = 5;
const MAX_QUANTITY = 10;

export type AmazonOpportunityDiscoveryResult = {
  marketplace: "AMAZON";
  query: string;
  scanned: number;
  found: number;
  added: number;
  duplicates: number;
};

function normalizarQuantidade(
  value: unknown,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return DEFAULT_QUANTITY;
  }

  return Math.min(
    MAX_QUANTITY,
    Math.max(
      1,
      Math.trunc(value),
    ),
  );
}

function normalizarTexto(
  value: string,
): string {
  return value
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      "",
    )
    .toLowerCase()
    .replace(
      /([a-z])(\d)/g,
      "$1 $2",
    )
    .replace(
      /(\d)([a-z])/g,
      "$1 $2",
    )
    .replace(
      /[^a-z0-9]+/g,
      " ",
    )
    .trim()
    .replace(/\s+/g, " ");
}

function obterAsinAmazon(
  externalId: string,
  sourceUrl: string,
): string | null {
  const externalIdNormalizado =
    externalId.trim().toUpperCase();

  if (
    /^[A-Z0-9]{10}$/.test(
      externalIdNormalizado,
    )
  ) {
    return externalIdNormalizado;
  }

  try {
    const url = new URL(sourceUrl);

    const match =
      url.pathname.match(
        /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i,
      );

    return (
      match?.[1]?.toUpperCase() ??
      null
    );
  } catch {
    return null;
  }
}

function gerarLinkAfiliadoAmazon(
  externalId: string,
  sourceUrl: string,
): string | null {
  const asin =
    obterAsinAmazon(
      externalId,
      sourceUrl,
    );

  if (!asin) {
    return null;
  }

  const associateTag =
    process.env.AMAZON_ASSOCIATE_TAG?.trim() ||
    "ofertano-20";

  try {
    const url = new URL(sourceUrl);

    const hostname =
      url.hostname
        .toLowerCase()
        .replace(/^www\./, "");

    const dominioAmazon =
      hostname === "amazon.com.br" ||
      hostname.endsWith(".amazon.com.br") ||
      hostname === "amazon.com" ||
      hostname.endsWith(".amazon.com");

    if (
      dominioAmazon &&
      url.searchParams.get("tag")?.trim() ===
        associateTag
    ) {
      return sourceUrl.trim();
    }
  } catch {
    // Usa o link canonico gerado pelo ASIN.
  }

  return (
    `https://www.amazon.com.br/dp/${asin}` +
    `/ref=nosim?tag=${encodeURIComponent(associateTag)}`
  );
}
export async function discoverAmazonOpportunities(
  rawQuery: string,
  rawQuantity: unknown,
): Promise<AmazonOpportunityDiscoveryResult> {
  const query =
    rawQuery.trim();

  if (query.length < 3) {
    throw new Error(
      "Informe um produto com pelo menos 3 caracteres.",
    );
  }

  const quantity =
    normalizarQuantidade(
      rawQuantity,
    );

  const normalizedQuery =
    normalizarTexto(query);

  const result =
    await buscarAmazon({
      query,
      normalizedQuery,
      limit: quantity,
      targetProductId: null,
    });

  if (!result.success) {
    throw new Error(
      result.error ||
        "Não foi possível pesquisar produtos na Amazon.",
    );
  }

  const candidates =
    result.candidates.filter(
      (candidate) =>
        candidate.marketplace ===
          "AMAZON" &&
        candidate.status ===
          "FOUND",
    );

  if (
    candidates.length === 0
  ) {
    return {
      marketplace:
        "AMAZON",

      query,

      scanned:
        result.scanned,

      found:
        0,

      added:
        0,

      duplicates:
        0,
    };
  }

  const externalIds =
    candidates.map(
      (candidate) =>
        candidate.externalId,
    );

  const existing =
    await prisma.productOpportunity.findMany({
      where: {
        marketplace:
          "AMAZON",

        externalId: {
          in: externalIds,
        },
      },

      select: {
        externalId:
          true,
      },
    });

  const existingIds =
    new Set(
      existing.map(
        (item) =>
          item.externalId,
      ),
    );

  const newCandidates =
    candidates.filter(
      (candidate) =>
        !existingIds.has(
          candidate.externalId,
        ),
    );

  const created =
    newCandidates.length > 0
      ? await prisma.productOpportunity.createMany({
          data:
            newCandidates.map(
              (candidate) => {
                const affiliateLink =
                  gerarLinkAfiliadoAmazon(
                    candidate.externalId,
                    candidate.sourceUrl,
                  );

                return {
                  marketplace:
                    "AMAZON" as const,

                  externalId:
                    candidate.externalId,

                  sourceType:
                    "SEARCH_RESULT" as const,

                  sourceUrl:
                    candidate.sourceUrl,

                  title:
                    candidate.title,

                  image:
                    candidate.image,

                  categoryId:
                    null,

                  categoryName:
                    "Amazon",

                  price:
                    candidate.price,

                  oldPrice:
                    candidate.oldPrice,

                  discount:
                    null,

                  affiliateLink,

                  status: affiliateLink
                    ? ("READY_TO_QUEUE" as const)
                    : ("WAITING_AFFILIATE" as const),

                  matchStatus:
                    "HIGH" as const,

                  reviewReason: affiliateLink
                    ? null
                    : "Não foi possível identificar o ASIN para gerar o link afiliado da Amazon.",

                  errorMessage:
                    null,
                };
              },
            ),

          skipDuplicates:
            true,
        })
      : {
          count:
            0,
        };

  return {
    marketplace:
      "AMAZON",

    query,

    scanned:
      result.scanned,

    found:
      candidates.length,

    added:
      created.count,

    duplicates:
      candidates.length -
      created.count,
  };
}