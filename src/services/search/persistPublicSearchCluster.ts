import prisma from "@/lib/prisma";

import {
  saveProduct,
  sincronizarMelhorOfertaDoProduto,
} from "@/services/database/saveProduct";

import {
  avaliarCompatibilidadeComConsulta,
  avaliarCompatibilidadeExataEntreImports,
  criarCanonicalKeyDaIdentidade,
  ehPapelNaoPrincipal,
  normalizarCodigoIdentidade,
  papelDaIdentidade,
  pontuarEspecificidadeDaConsulta,
  pontuarEvidenciaIdentidade,
  resolverIdentidadeProduto,
} from "@/services/identity";

import type { ProductImport } from "@/services/importers/core/types";
import { traceMultiloja } from "@/services/multiloja/trace";
import {
  avaliarSearchCompletionBarrier,
  rastrearSearchCompletion,
  type PublicSearchCoverage,
} from "@/services/search/searchCompletionBarrier";

export type PublicSearchOffer = {
  product: ProductImport;
  affiliateLink?: string | null;
};

export type PersistPublicSearchClusterResult = {
  productId: string;
  storeCount: number;
};

function identityOf(offer: PublicSearchOffer) {
  return resolverIdentidadeProduto({
    title: offer.product.title,
    brand: offer.product.brand,
    attributes: offer.product.attributes,
  });
}

function queryCompatibility(query: string, offer: PublicSearchOffer) {
  return avaliarCompatibilidadeComConsulta(query, {
    title: offer.product.title,
    brand: offer.product.brand,
    attributes: offer.product.attributes,
  });
}

function oneOfferPerMarketplace(
  offers: PublicSearchOffer[],
): PublicSearchOffer[] {
  const byMarketplace = new Map<string, PublicSearchOffer>();

  for (const offer of offers) {
    const current = byMarketplace.get(offer.product.marketplace);

    if (!current) {
      byMarketplace.set(offer.product.marketplace, offer);
      continue;
    }

    const currentHasLink = Boolean(current.affiliateLink?.trim());
    const nextHasLink = Boolean(offer.affiliateLink?.trim());

    if (nextHasLink !== currentHasLink) {
      byMarketplace.set(
        offer.product.marketplace,
        nextHasLink ? offer : current,
      );
      continue;
    }

    if (offer.product.price < current.product.price) {
      byMarketplace.set(offer.product.marketplace, offer);
    }
  }

  return Array.from(byMarketplace.values());
}

function kindAlignmentScore(query: string, offer: PublicSearchOffer): number {
  const queryKind = resolverIdentidadeProduto({
    title: query,
    brand: null,
    attributes: {},
  }).kind;
  const candidate = identityOf(offer);

  if (
    !ehPapelNaoPrincipal(queryKind) &&
    ehPapelNaoPrincipal(candidate.kind)
  ) {
    return -10000;
  }

  if (candidate.multiModelCompatibility && !ehPapelNaoPrincipal(queryKind)) {
    return -8000;
  }

  if (
    ehPapelNaoPrincipal(queryKind) &&
    queryKind === candidate.kind
  ) {
    return 50;
  }

  if (
    !ehPapelNaoPrincipal(queryKind) &&
    !ehPapelNaoPrincipal(candidate.kind)
  ) {
    return 200;
  }

  return 0;
}

function modeloConfirmadoPelaIdentidade(
  queryModel: string | null,
  identity: ReturnType<typeof identityOf>,
): boolean {
  if (!queryModel) {
    return false;
  }

  const commercial = identity.commercialModel ?? identity.model;

  return commercial === queryModel;
}

function chaveGrupoComercial(
  identity: ReturnType<typeof identityOf>,
): string | null {
  const commercial = identity.commercialModel ?? identity.model;

  if (!commercial || !identity.brand) {
    return null;
  }

  return [
    normalizarCodigoIdentidade(identity.brand),
    commercial,
    identity.kind,
  ].join(":");
}

function condicaoNaoPadrao(
  identity: ReturnType<typeof identityOf>,
): boolean {
  return Boolean(identity.variants.condition);
}

type IdentityGroupMeta = {
  key: string | null;
  commercialModel: string | null;
  marketplaceSupport: number;
  candidateSupport: number;
  consensusScore: number;
  consensusMultiMarketplace: boolean;
  isolated: boolean;
  reason: string;
};

function agruparIdentidadesComerciais(
  query: string,
  offers: PublicSearchOffer[],
  queryIdentity: ReturnType<typeof resolverIdentidadeProduto>,
): Map<string, {
  offers: PublicSearchOffer[];
  marketplaces: Set<string>;
  commercialModel: string;
}> {
  const groups = new Map<string, {
    offers: PublicSearchOffer[];
    marketplaces: Set<string>;
    commercialModel: string;
  }>();

  for (const offer of offers) {
    const identity = identityOf(offer);
    const key = chaveGrupoComercial(identity);

    if (!key || !identity.model) {
      continue;
    }

    const current = groups.get(key) ?? {
      offers: [],
      marketplaces: new Set<string>(),
      commercialModel: identity.commercialModel ?? identity.model,
    };
    current.offers.push(offer);
    current.marketplaces.add(offer.product.marketplace);
    groups.set(key, current);
  }

  void query;
  void queryIdentity;

  return groups;
}

function metaDoGrupo(
  queryIdentity: ReturnType<typeof resolverIdentidadeProduto>,
  groups: ReturnType<typeof agruparIdentidadesComerciais>,
  key: string | null,
): IdentityGroupMeta {
  const group = key ? groups.get(key) : undefined;
  const marketplaceSupport = group?.marketplaces.size ?? 0;
  const candidateSupport = group?.offers.length ?? 0;
  const maxMarketplaceSupport = Math.max(
    0,
    ...Array.from(groups.values()).map((item) => item.marketplaces.size),
  );
  const queryAligned =
    Boolean(queryIdentity.model) &&
    group?.commercialModel === queryIdentity.model;
  const consensusMultiMarketplace = marketplaceSupport >= 2;
  const isolated =
    marketplaceSupport <= 1 &&
    maxMarketplaceSupport >= 2 &&
    !queryAligned;
  const consensusScore = consensusMultiMarketplace
    ? marketplaceSupport * 400 +
      candidateSupport * 20 +
      (queryAligned ? 800 : 0) -
      (isolated ? 4000 : 0)
    : 0;

  return {
    key,
    commercialModel: group?.commercialModel ?? null,
    marketplaceSupport,
    candidateSupport,
    consensusScore,
    consensusMultiMarketplace,
    isolated,
    reason: consensusMultiMarketplace
      ? queryAligned
        ? "consenso-alinhado-a-consulta"
        : "consenso-de-marketplaces"
      : "SINGLE_SOURCE_IDENTITY",
  };
}

export function diagnosticarConsensoDaPesquisaPublica(
  query: string,
  offers: PublicSearchOffer[],
): IdentityGroupMeta[] {
  const queryIdentity = resolverIdentidadeProduto({
    title: query,
    brand: null,
    attributes: {},
  });
  const groups = agruparIdentidadesComerciais(
    query,
    offers,
    queryIdentity,
  );

  return Array.from(groups.keys()).map((key) =>
    metaDoGrupo(queryIdentity, groups, key),
  );
}

function podeSerAncoraDaConsulta(
  query: string,
  offer: PublicSearchOffer,
  queryIdentity: ReturnType<typeof resolverIdentidadeProduto>,
): boolean {
  const identity = identityOf(offer);
  const match = queryCompatibility(query, offer);

  if (match.status !== "ACCEPTED") {
    return false;
  }

  if (
    match.productClassCompatibility === "CONFLICT" ||
    match.brandCompatibility === "CONFLICT"
  ) {
    return false;
  }

  if (ehPapelNaoPrincipal(queryIdentity.kind)) {
    return identity.kind === queryIdentity.kind && match.roleCompatible;
  }

  return (
    identity.role === "MAIN" &&
    !ehPapelNaoPrincipal(identity.kind) &&
    match.roleCompatible &&
    !identity.multiModelCompatibility &&
    !(
      identity.hostModelCandidates.length > 0 &&
      identity.identityModelCandidates.length === 0
    )
  );
}

function pontuarReferencia(
  query: string,
  offer: PublicSearchOffer,
  groupMeta?: IdentityGroupMeta,
): {
  score: number;
  reason: string;
  penalties: string[];
} {
  const queryIdentity = resolverIdentidadeProduto({
    title: query,
    brand: null,
    attributes: {},
  });
  const identity = identityOf(offer);
  const match = queryCompatibility(query, offer);
  const specificity = pontuarEspecificidadeDaConsulta(query, {
    title: offer.product.title,
    brand: offer.product.brand,
    attributes: offer.product.attributes,
  });
  const identityScore = pontuarEvidenciaIdentidade({
    product: offer.product,
  });
  const roleScore = kindAlignmentScore(query, offer);
  const linkScore = Boolean(offer.affiliateLink?.trim()) ? 5 : 0;
  const queryModel = queryIdentity.model;
  const penalties: string[] = [];
  let score =
    roleScore * 100 +
    Math.round(identity.identityConfidence * 100) +
    specificity * 4 +
    match.score * 10 +
    identityScore +
    linkScore +
    (groupMeta?.consensusScore ?? 0);

  if (!match.roleCompatible) {
    penalties.push("papel-incompativel");
    score -= 5000;
  }

  if (match.productClassCompatibility === "CONFLICT") {
    penalties.push("product-class-conflito");
    score -= 5000;
  } else if (match.productClassCompatibility === "MATCH") {
    score += 220;
  }

  if (match.brandCompatibility === "CONFLICT") {
    penalties.push("marca-conflito");
    score -= 4000;
  } else if (match.brandCompatibility === "MATCH") {
    score += 160;
  }

  if (
    !ehPapelNaoPrincipal(queryIdentity.kind) &&
    ehPapelNaoPrincipal(identity.kind)
  ) {
    penalties.push("acessorio-vs-consulta-main");
    score -= 5000;
  }

  if (groupMeta && !groupMeta.consensusMultiMarketplace && !queryModel) {
    penalties.push("identidade-fonte-unica");
    score -= 400;
  }

  if (
    identity.multiModelCompatibility ||
    (
      identity.hostModelCandidates.length > 0 &&
      identity.identityModelCandidates.length === 0
    )
  ) {
    penalties.push("lista-hospedeiro");
    score -= 2500;
  }

  if (identity.modelAmbiguous) {
    penalties.push("identidade-ambigua");
    score -= 800;
  }

  if (modeloConfirmadoPelaIdentidade(queryModel, identity)) {
    score += 500;
  } else if (
    queryModel &&
    identity.commercialModel &&
    identity.commercialModel !== queryModel
  ) {
    penalties.push("modelo-diferente-da-consulta");
    score -= 3000;
  }

  if (identity.manufacturerSku && !identity.commercialModel) {
    penalties.push("sku-sem-modelo-comercial");
    score -= 1200;
  }

  if (condicaoNaoPadrao(identity) && !queryIdentity.variants.condition) {
    penalties.push("condicao-nao-pedida");
    score -= 1500;
  }

  if (groupMeta?.isolated) {
    penalties.push("identidade-isolada");
  }

  const reasons = [
    `papel=${identity.role}`,
    identity.multiModelCompatibility ? "lista-compatibilidade" : null,
    `modelo=${identity.commercialModel ?? identity.model}`,
    identity.manufacturerSku
      ? `sku=${identity.manufacturerSku}`
      : null,
    `especificidade=${specificity}`,
    `identidade=${identityScore}`,
    `confianca=${identity.identityConfidence}`,
    groupMeta
      ? `consenso=${groupMeta.consensusScore}`
      : null,
    match.roleCompatible ? "papel-compativel" : "papel-incompativel",
    ...penalties.map((penalty) => `penalidade=${penalty}`),
  ].filter((value): value is string => Boolean(value));

  return {
    score,
    reason: reasons.join("; "),
    penalties,
  };
}

function sortOffersForPersistence(
  query: string,
  offers: PublicSearchOffer[],
): PublicSearchOffer[] {
  return [...offers].sort((first, second) => {
    const kindDifference =
      kindAlignmentScore(query, second) - kindAlignmentScore(query, first);

    if (kindDifference !== 0) {
      return kindDifference;
    }

    const identityDifference =
      pontuarEvidenciaIdentidade({ product: second.product }) -
      pontuarEvidenciaIdentidade({ product: first.product });

    if (identityDifference !== 0) {
      return identityDifference;
    }

    const firstHasLink = Number(Boolean(first.affiliateLink?.trim()));
    const secondHasLink = Number(Boolean(second.affiliateLink?.trim()));

    if (firstHasLink !== secondHasLink) {
      return secondHasLink - firstHasLink;
    }

    return first.product.price - second.product.price;
  });
}

function escolherOfertaDeReferencia(
  query: string,
  offers: PublicSearchOffer[],
): PublicSearchOffer | null {
  const queryIdentity = resolverIdentidadeProduto({
    title: query,
    brand: null,
    attributes: {},
  });
  const validAnchors = offers.filter((offer) =>
    podeSerAncoraDaConsulta(query, offer, queryIdentity),
  );
  const confirmedModelAnchors = queryIdentity.model
    ? validAnchors.filter((offer) =>
        modeloConfirmadoPelaIdentidade(
          queryIdentity.model,
          identityOf(offer),
        ),
      )
    : validAnchors;
  const pool =
    confirmedModelAnchors.length > 0
      ? confirmedModelAnchors
      : validAnchors;

  if (pool.length === 0) {
    return null;
  }

  const groups = agruparIdentidadesComerciais(query, pool, queryIdentity);
  const rankedGroups = Array.from(groups.entries()).sort(
    (first, second) => {
      const firstMeta = metaDoGrupo(queryIdentity, groups, first[0]);
      const secondMeta = metaDoGrupo(queryIdentity, groups, second[0]);

      if (firstMeta.consensusScore !== secondMeta.consensusScore) {
        return secondMeta.consensusScore - firstMeta.consensusScore;
      }

      return secondMeta.candidateSupport - firstMeta.candidateSupport;
    },
  );
  const dominantKey = rankedGroups[0]?.[0] ?? null;
  const dominantOffers = dominantKey
    ? groups.get(dominantKey)?.offers ?? pool
    : pool;
  const dominantMeta = metaDoGrupo(queryIdentity, groups, dominantKey);

  const ranked = [...dominantOffers].sort((first, second) => {
    const firstScore = pontuarReferencia(query, first, dominantMeta);
    const secondScore = pontuarReferencia(query, second, dominantMeta);

    if (firstScore.score !== secondScore.score) {
      return secondScore.score - firstScore.score;
    }

    const identityDifference =
      pontuarEvidenciaIdentidade({ product: second.product }) -
      pontuarEvidenciaIdentidade({ product: first.product });

    if (identityDifference !== 0) {
      return identityDifference;
    }

    return first.product.title.localeCompare(second.product.title);
  });

  return ranked[0] ?? null;
}

export function escolherClusterExatoDaPesquisaPublica(
  query: string,
  offers: PublicSearchOffer[],
): PublicSearchOffer[] {
  const compatibleOffers: PublicSearchOffer[] = [];

  for (const offer of offers) {
    const match = queryCompatibility(query, offer);
    const identity = identityOf(offer);

    traceMultiloja("candidate", {
      marketplace: offer.product.marketplace,
      title: offer.product.title,
      externalId: offer.product.externalId,
      price: offer.product.price,
      sourceUrl: offer.product.url,
      productRole: papelDaIdentidade(identity),
      roleReason: identity.roleReason,
      soldItemType: identity.soldItemType,
      hostItemType: identity.hostItemType,
      compatibilityRelation: identity.compatibilityRelation,
      hostModelCandidates: identity.hostModelCandidates,
      identityModelCandidates: identity.identityModelCandidates,
      modelCandidates: identity.compatibleModels,
      selectedModel: identity.model,
      commercialModel: identity.commercialModel,
      manufacturerSku: identity.manufacturerSku,
      variantCodes: identity.variantCodes,
      condition: identity.variants.condition ?? "new",
      modelAmbiguous: identity.modelAmbiguous,
      identityConfidence: identity.identityConfidence,
      multiModelCompatibility: identity.multiModelCompatibility,
      queryClass: match.queryProductClass,
      candidateClass: match.candidateProductClass,
      queryBrand: match.queryBrand,
      candidateBrand: match.candidateBrand,
      hardConflicts: match.hardConflicts,
      matchedTerms: match.matchedTerms,
      missingTerms: match.missingTerms,
      queryTextRelevance: match.textRelevance,
      roleBoost: match.roleBoost,
      finalRelevance: match.finalRelevance,
      queryRoleCompatibility: match.roleCompatible,
      queryRelevance: match.status === "ACCEPTED" ? match.score : 0,
      productClassCompatibility: match.productClassCompatibility,
      brandCompatibility: match.brandCompatibility,
      attributeMatches: match.attributeMatches,
      attributeMissing: match.attributeMissing,
      attributeConflicts: match.attributeConflicts,
      distinctiveTermsMatched: match.distinctiveTermsMatched,
      distinctiveTermsMissing: match.distinctiveTermsMissing,
      identityEvidenceScore: match.identityEvidenceScore,
      attributeCoverage: match.attributeCoverage,
      autoAcceptanceReason: match.autoAcceptanceReason,
      canonicalKey: criarCanonicalKeyDaIdentidade(identity),
      status: match.status,
      reason: match.reason,
    });

    if (match.status === "ACCEPTED") {
      compatibleOffers.push(offer);
    }
  }

  if (compatibleOffers.length === 0) {
    return [];
  }

  const reference = escolherOfertaDeReferencia(query, compatibleOffers);

  if (!reference) {
    return [];
  }

  const referenceIdentity = identityOf(reference);
  const queryIdentity = resolverIdentidadeProduto({
    title: query,
    brand: null,
    attributes: {},
  });
  const groups = agruparIdentidadesComerciais(
    query,
    compatibleOffers,
    queryIdentity,
  );
  const groupMeta = metaDoGrupo(
    queryIdentity,
    groups,
    chaveGrupoComercial(referenceIdentity),
  );
  const referenceScore = pontuarReferencia(query, reference, groupMeta);
  const referenceHasSku = Boolean(referenceIdentity.manufacturerSku);
  const referenceCommercial =
    referenceIdentity.commercialModel ?? referenceIdentity.model;

  traceMultiloja("reference", {
    marketplace: reference.product.marketplace,
    title: reference.product.title,
    productRole: papelDaIdentidade(referenceIdentity),
    roleReason: referenceIdentity.roleReason,
    soldItemType: referenceIdentity.soldItemType,
    hostItemType: referenceIdentity.hostItemType,
    compatibilityRelation: referenceIdentity.compatibilityRelation,
    hostModelCandidates: referenceIdentity.hostModelCandidates,
    identityModelCandidates: referenceIdentity.identityModelCandidates,
    selectedModel: referenceIdentity.model,
    commercialModel: referenceIdentity.commercialModel,
    manufacturerSku: referenceIdentity.manufacturerSku,
    variantCodes: referenceIdentity.variantCodes,
    condition: referenceIdentity.variants.condition ?? "new",
    identityGroup: groupMeta.key,
    identityMarketplaceSupport: groupMeta.marketplaceSupport,
    identityCandidateSupport: groupMeta.candidateSupport,
    consensusScore: groupMeta.consensusScore,
    consensusMultiMarketplace: groupMeta.consensusMultiMarketplace,
    canonicalIdentityReason: groupMeta.reason,
    modelAmbiguous: referenceIdentity.modelAmbiguous,
    identityConfidence: referenceIdentity.identityConfidence,
    multiModelCompatibility: referenceIdentity.multiModelCompatibility,
    canonicalKey: criarCanonicalKeyDaIdentidade(referenceIdentity),
    referenceScore: referenceScore.score,
    referenceSelectionReason: referenceScore.reason,
    referencePenalties: referenceScore.penalties,
  });

  const exactOffers: PublicSearchOffer[] = [];

  for (const offer of compatibleOffers) {
    if (offer === reference) {
      exactOffers.push(offer);
      continue;
    }

    const matcher = avaliarCompatibilidadeExataEntreImports(
      reference.product,
      offer.product,
    );
    const candidateIdentity = identityOf(offer);
    const candidateHasSku = Boolean(candidateIdentity.manufacturerSku);
    const skuMissingOnly =
      matcher.exact &&
      referenceHasSku !== candidateHasSku;
    const skuConflict =
      !matcher.exact &&
      /SKU especifico diferente/i.test(matcher.reason);

    traceMultiloja("matcher", {
      reference: reference.product.title,
      candidate: offer.product.title,
      marketplace: offer.product.marketplace,
      status: matcher.exact ? "EXACT" : "REJECTED",
      score: matcher.score,
      reason: matcher.reason,
      commercialModel: candidateIdentity.commercialModel,
      manufacturerSku: candidateIdentity.manufacturerSku,
      skuConflict,
      skuMissingOnly,
      canonicalModel: referenceCommercial,
    });

    if (matcher.exact) {
      exactOffers.push(offer);
    }
  }

  return oneOfferPerMarketplace(exactOffers);
}

export async function persistPublicSearchCluster(
  query: string,
  offers: PublicSearchOffer[],
  existingProductId?: string | null,
  coverage?: PublicSearchCoverage | null,
): Promise<PersistPublicSearchClusterResult | null> {
  const cluster = escolherClusterExatoDaPesquisaPublica(query, offers);

  const barrier = avaliarSearchCompletionBarrier({
    query,
    enabledMarketplaces: coverage?.enabledMarketplaces ?? [],
    results: coverage?.results ?? [],
    exactOffers: cluster,
  });
  rastrearSearchCompletion(barrier);

  if (!barrier.publicationAllowed || cluster.length === 0) {
    return null;
  }

  if (existingProductId) {
    const existing = await prisma.product.findUnique({
      where: { id: existingProductId },
      select: {
        name: true,
        canonicalName: true,
        brand: true,
        specifications: true,
        modelNumber: true,
        ean: true,
        gtin: true,
        mpn: true,
        color: true,
        voltage: true,
        size: true,
      },
    });

    if (existing) {
      const specifications =
        existing.specifications &&
        typeof existing.specifications === "object" &&
        !Array.isArray(existing.specifications)
          ? Object.fromEntries(
              Object.entries(
                existing.specifications as Record<string, unknown>,
              )
                .filter(([, value]) => value !== null && value !== undefined)
                .map(([key, value]) => [key, String(value)]),
            )
          : {};

      const catalogIdentity = {
        title: existing.canonicalName?.trim() || existing.name,
        brand: existing.brand,
        attributes: {
          ...specifications,
          ...(existing.modelNumber ? { MODEL: existing.modelNumber } : {}),
          ...(existing.ean ? { EAN: existing.ean } : {}),
          ...(existing.gtin ? { GTIN: existing.gtin } : {}),
          ...(existing.mpn ? { MPN: existing.mpn } : {}),
          ...(existing.color ? { COLOR: existing.color } : {}),
          ...(existing.voltage ? { VOLTAGE: existing.voltage } : {}),
          ...(existing.size ? { SIZE: existing.size } : {}),
        },
      };

      const exactWithCatalog = cluster.every((member) =>
        avaliarCompatibilidadeExataEntreImports(
          catalogIdentity,
          member.product,
        ).exact,
      );

      if (!exactWithCatalog) {
        existingProductId = null;
      }
    }
  }

  const ordered = sortOffersForPersistence(query, cluster);
  const representative = ordered[0];
  let productId = existingProductId?.trim() || null;

  if (representative) {
    const identity = identityOf(representative);

    traceMultiloja("persist-product", {
      canonicalKey: criarCanonicalKeyDaIdentidade(identity),
      title: representative.product.title,
      marketplace: representative.product.marketplace,
      productRole: papelDaIdentidade(identity),
    });
  }

  for (const offer of ordered) {
    const saved = await saveProduct(
      offer.product,
      offer.affiliateLink?.trim() || offer.product.affiliateLink || null,
      productId
        ? {
            targetProductId: productId,
            verifiedExactMatch: true,
            discoverySource: "ON_DEMAND_SEARCH",
            autoCreated: true,
            sourceQuery: query,
            suppressPublicationSync: true,
          }
        : {
            discoverySource: "ON_DEMAND_SEARCH",
            autoCreated: true,
            sourceQuery: query,
            suppressPublicationSync: true,
          },
    );

    if (productId && saved.id !== productId) {
      throw new Error(
        `Persistencia Multi Loja desviou do Product canonico ${productId} para ${saved.id}.`,
      );
    }

    productId = saved.id;

    traceMultiloja("persist-offer", {
      productId,
      marketplace: offer.product.marketplace,
      offerId: offer.product.externalId,
      title: offer.product.title,
      price: offer.product.price,
    });
  }

  if (!productId) {
    return null;
  }

  await prisma.$transaction(async (tx) => {
    await sincronizarMelhorOfertaDoProduto(tx, productId!);
  });

  const canonicalIdentity = representative
    ? identityOf(representative)
    : null;

  traceMultiloja("cluster", {
    productId,
    canonicalKey: canonicalIdentity
      ? criarCanonicalKeyDaIdentidade(canonicalIdentity)
      : null,
    exactOffers: ordered.length,
    marketplaces: ordered.map((offer) => offer.product.marketplace),
  });

  return {
    productId,
    storeCount: ordered.length,
  };
}
