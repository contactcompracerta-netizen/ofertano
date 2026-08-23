import { saveProduct } from "@/services/database/saveProduct";
import { buscarComparacaoManual } from "@/services/comparison/manualComparison";
import {
  agruparPorIdentidadeExata,
  pontuarEvidenciaIdentidade,
} from "@/services/identity";
import {
  agendarComparacaoMultiloja,
  type ReferenciaMultiloja,
} from "@/services/multiloja/orchestrator";

import type {
  ProductImport,
} from "@/services/importers/core/types";

import type {
  DiscoveryCandidate,
  ProductDiscoveryResult,
} from "./core/types";

export type DiscoveryPublishItem = {
  marketplace: DiscoveryCandidate["marketplace"];
  externalId: string;
  title: string;
  productId: string | null;
  success: boolean;
  error: string | null;
};

export type DiscoveryPublishResult = {
  query: string;
  received: number;
  publishable: number;
  published: number;
  failed: number;
  skipped: number;
  productIds: string[];
  items: DiscoveryPublishItem[];
};

export type DiscoveryPublishOptions = {
  /*
   * Mantido por compatibilidade com os chamadores existentes.
   * O Publisher global nao depende mais de uma ancora do Mercado Livre.
   */
  comparisonOnly?: boolean;

  /*
   * A pesquisa publica ja consultou todas as lojas; nela nao faz sentido
   * disparar imediatamente uma segunda rodada do Multi Loja pela fila.
   * Outros fluxos podem manter o follow-up assincrono quando desejarem.
   */
  scheduleMultiloja?: boolean;

  /*
   * Quando true, cada Product publicado recebe imediatamente uma rodada
   * completa de comparacao nas outras marketplaces antes do retorno.
   * As ofertas EXACT sao gravadas no MESMO productId e o Product termina
   * sincronizado com o menor preco encontrado.
   */
  completeMultiloja?: boolean;
};

type CandidateEvidence = {
  candidate: DiscoveryCandidate;
  product: ProductImport;
};

function calcularDesconto(
  oldPrice: number | null,
  price: number,
): number | null {
  if (
    oldPrice === null ||
    !Number.isFinite(oldPrice) ||
    oldPrice <= price ||
    oldPrice <= 0 ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return null;
  }

  const percentual = Math.round(
    ((oldPrice - price) / oldPrice) * 100,
  );

  return percentual > 0 && percentual < 100
    ? percentual
    : null;
}

function candidatoPublicavel(
  candidato: DiscoveryCandidate,
): boolean {
  return (
    candidato.status === "FOUND" &&
    Boolean(candidato.externalId.trim()) &&
    Boolean(candidato.sourceUrl.trim()) &&
    Boolean(candidato.title.trim()) &&
    Boolean(candidato.image?.trim()) &&
    candidato.price !== null &&
    Number.isFinite(candidato.price) &&
    candidato.price > 0
  );
}

function converterCandidato(
  candidato: DiscoveryCandidate,
): ProductImport {
  if (
    candidato.price === null ||
    !Number.isFinite(candidato.price) ||
    candidato.price <= 0
  ) {
    throw new Error("Candidato sem preco valido.");
  }

  const image = candidato.image?.trim();

  if (!image) {
    throw new Error("Candidato sem imagem valida.");
  }

  const oldPrice =
    candidato.oldPrice !== null &&
    Number.isFinite(candidato.oldPrice) &&
    candidato.oldPrice > candidato.price
      ? candidato.oldPrice
      : null;

  return {
    marketplace: candidato.marketplaceName,
    externalId: candidato.externalId.trim(),
    url: candidato.sourceUrl.trim(),
    affiliateLink: candidato.affiliateLink?.trim() || null,
    title: candidato.title.trim(),
    description: null,
    brand: candidato.brand?.trim() || null,
    category: candidato.category?.trim() || null,
    image,
    images: [image],
    price: candidato.price,
    oldPrice,
    discount: calcularDesconto(oldPrice, candidato.price),
    installments: null,
    rating: null,
    reviews: null,
    sales: null,
    stock: null,
    seller: candidato.seller?.trim() || null,
    attributes: candidato.attributes ?? {},
  };
}

function chaveCandidato(
  candidato: DiscoveryCandidate,
): string {
  return [
    candidato.marketplace,
    candidato.externalId.trim().toLowerCase(),
  ].join(":");
}

function removerDuplicados(
  candidatos: DiscoveryCandidate[],
): DiscoveryCandidate[] {
  const mapa = new Map<string, DiscoveryCandidate>();

  for (const candidato of candidatos) {
    const chave = chaveCandidato(candidato);
    const atual = mapa.get(chave);

    if (!atual) {
      mapa.set(chave, candidato);
      continue;
    }

    const novoTemLink = Boolean(candidato.affiliateLink?.trim());
    const atualTemLink = Boolean(atual.affiliateLink?.trim());

    if (novoTemLink && !atualTemLink) {
      mapa.set(chave, candidato);
      continue;
    }

    if (
      candidato.price !== null &&
      (atual.price === null || candidato.price < atual.price)
    ) {
      mapa.set(chave, candidato);
    }
  }

  return Array.from(mapa.values());
}

function melhorOfertaDaMesmaLoja(
  first: CandidateEvidence,
  second: CandidateEvidence,
): CandidateEvidence {
  const firstHasLink = Boolean(
    first.candidate.affiliateLink?.trim(),
  );
  const secondHasLink = Boolean(
    second.candidate.affiliateLink?.trim(),
  );

  if (firstHasLink !== secondHasLink) {
    return secondHasLink ? second : first;
  }

  const firstPrice = first.candidate.price ?? Number.POSITIVE_INFINITY;
  const secondPrice = second.candidate.price ?? Number.POSITIVE_INFINITY;

  if (firstPrice !== secondPrice) {
    return secondPrice < firstPrice ? second : first;
  }

  return pontuarEvidenciaIdentidade(second) >
    pontuarEvidenciaIdentidade(first)
    ? second
    : first;
}

function umaOfertaPorMarketplace(
  members: CandidateEvidence[],
): CandidateEvidence[] {
  const byMarketplace = new Map<
    DiscoveryCandidate["marketplace"],
    CandidateEvidence
  >();

  for (const member of members) {
    const current = byMarketplace.get(
      member.candidate.marketplace,
    );

    byMarketplace.set(
      member.candidate.marketplace,
      current
        ? melhorOfertaDaMesmaLoja(current, member)
        : member,
    );
  }

  return Array.from(byMarketplace.values());
}

function ordenarClusterParaPersistencia(
  members: CandidateEvidence[],
): CandidateEvidence[] {
  return [...members].sort((first, second) => {
    const identityDifference =
      pontuarEvidenciaIdentidade(second) -
      pontuarEvidenciaIdentidade(first);

    if (identityDifference !== 0) {
      return identityDifference;
    }

    const firstHasLink = Boolean(
      first.candidate.affiliateLink?.trim(),
    );
    const secondHasLink = Boolean(
      second.candidate.affiliateLink?.trim(),
    );

    if (firstHasLink !== secondHasLink) {
      return Number(secondHasLink) - Number(firstHasLink);
    }

    return (
      (first.candidate.price ?? Number.POSITIVE_INFINITY) -
      (second.candidate.price ?? Number.POSITIVE_INFINITY)
    );
  });
}

function ordenarClusters(
  clusters: Array<{
    members: CandidateEvidence[];
  }>,
) {
  return [...clusters].sort((first, second) => {
    const firstStores = new Set(
      first.members.map((item) => item.candidate.marketplace),
    ).size;
    const secondStores = new Set(
      second.members.map((item) => item.candidate.marketplace),
    ).size;

    if (firstStores !== secondStores) {
      return secondStores - firstStores;
    }

    const firstPrice = Math.min(
      ...first.members.map(
        (item) => item.candidate.price ?? Number.POSITIVE_INFINITY,
      ),
    );
    const secondPrice = Math.min(
      ...second.members.map(
        (item) => item.candidate.price ?? Number.POSITIVE_INFINITY,
      ),
    );

    return firstPrice - secondPrice;
  });
}

export async function publicarResultadoDiscovery(
  resultado: ProductDiscoveryResult,
  options: DiscoveryPublishOptions = {},
): Promise<DiscoveryPublishResult> {
  const recebidos = resultado.candidates;
  const unicos = removerDuplicados(recebidos);
  const publicaveis = unicos.filter(candidatoPublicavel);

  const items: DiscoveryPublishItem[] = [];
  const productIds = new Set<string>();
  const referenciasMultiloja = new Map<
    string,
    ReferenciaMultiloja
  >();

  const referenciasComparacao = new Map<
    string,
    ProductImport
  >();

  const evidencias: CandidateEvidence[] = [];
  let failed = 0;

  for (const candidato of publicaveis) {
    try {
      evidencias.push({
        candidate: candidato,
        product: converterCandidato(candidato),
      });
    } catch (error) {
      failed += 1;
      items.push({
        marketplace: candidato.marketplace,
        externalId: candidato.externalId,
        title: candidato.title,
        productId: null,
        success: false,
        error: (
          error instanceof Error
            ? error.message
            : "Erro ao preparar candidato para identidade global."
        ).slice(0, 1000),
      });
    }
  }

  /*
   * CLUSTER GLOBAL DE IDENTIDADE
   *
   * Nenhuma loja e ancora. Cada candidato e comparado pelo resolver +
   * Exact Matcher central. Um membro so entra em um cluster se for EXACT
   * com todos os membros ja presentes, evitando fusao transitiva insegura.
   */
  const clustersBrutos = agruparPorIdentidadeExata(
    evidencias.map((evidence) => ({
      item: evidence,
      product: evidence.product,
    })),
  ).map((cluster) => ({
    members: cluster.members.map((member) => member.item),
  }));

  const clusters = ordenarClusters(clustersBrutos);
  let published = 0;
  let duplicateMarketplaceSkipped = 0;

  for (const cluster of clusters) {
    const selected = umaOfertaPorMarketplace(cluster.members);
    duplicateMarketplaceSkipped +=
      cluster.members.length - selected.length;

    const ordered = ordenarClusterParaPersistencia(selected);
    let clusterProductId: string | null = null;

    for (const evidence of ordered) {
      const { candidate, product } = evidence;

      try {
        const saved = await saveProduct(
          product,
          candidate.affiliateLink?.trim() || null,
          clusterProductId
            ? {
                targetProductId: clusterProductId,
                verifiedExactMatch: true,
                discoverySource: "ON_DEMAND_SEARCH",
                autoCreated: true,
                sourceQuery: resultado.query,
              }
            : {
                discoverySource: "ON_DEMAND_SEARCH",
                autoCreated: true,
                sourceQuery: resultado.query,
              },
        );

        clusterProductId = saved.id;
        productIds.add(saved.id);
        published += 1;

        if (!referenciasMultiloja.has(saved.id)) {
          referenciasMultiloja.set(saved.id, {
            marketplace: candidate.marketplace,
            sourceUrl: candidate.sourceUrl.trim(),
            affiliateLink:
              candidate.affiliateLink?.trim() || null,
          });
        }

        if (!referenciasComparacao.has(saved.id)) {
          referenciasComparacao.set(saved.id, product);
        }

        items.push({
          marketplace: candidate.marketplace,
          externalId: candidate.externalId,
          title: candidate.title,
          productId: saved.id,
          success: true,
          error: null,
        });
      } catch (error) {
        failed += 1;
        items.push({
          marketplace: candidate.marketplace,
          externalId: candidate.externalId,
          title: candidate.title,
          productId: null,
          success: false,
          error: (
            error instanceof Error
              ? error.message
              : "Erro desconhecido ao publicar cluster global."
          ).slice(0, 1000),
        });
      }
    }
  }

  const multiStoreClusters = clusters.filter(
    (cluster) =>
      new Set(
        cluster.members.map(
          (item) => item.candidate.marketplace,
        ),
      ).size >= 2,
  ).length;

  console.log(
    "[Discovery Publisher] Resumo identidade global:",
    {
      received: recebidos.length,
      publishable: publicaveis.length,
      clusters: clusters.length,
      multiStoreClusters,
      singleStoreClusters:
        clusters.length - multiStoreClusters,
      duplicateMarketplaceSkipped,
      published,
      failed,
      productIds: Array.from(productIds),
    },
  );

  if (options.completeMultiloja === true) {
    for (const [productId, referencia] of referenciasComparacao) {
      try {
        const comparison = await buscarComparacaoManual(
          referencia,
          productId,
        );

        console.log(
          `[Discovery Publisher] Multi Loja concluido para ${productId}: ` +
            `${comparison.found} oferta(s) EXACT adicional(is).`,
        );

        if (comparison.errors.length > 0) {
          console.warn(
            `[Discovery Publisher] Multi Loja de ${productId} terminou com avisos:`,
            comparison.errors,
          );
        }
      } catch (error) {
        console.error(
          `[Discovery Publisher] Falha nao fatal ao completar Multi Loja de ${productId}:`,
          error,
        );
      }
    }
  } else if (options.scheduleMultiloja !== false) {
    for (const [productId, referencia] of referenciasMultiloja) {
      try {
        await agendarComparacaoMultiloja(
          productId,
          referencia,
        );
      } catch (error) {
        console.error(
          `[Discovery Publisher] Falha ao agendar Multi Loja do produto ${productId}:`,
          error,
        );
      }
    }
  }

  return {
    query: resultado.query,
    received: recebidos.length,
    publishable: publicaveis.length,
    published,
    failed,
    skipped:
      recebidos.length - publicaveis.length +
      duplicateMarketplaceSkipped,
    productIds: Array.from(productIds),
    items,
  };
}
