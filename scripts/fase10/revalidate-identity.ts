/**
 * FASE 5 — REVALIDACAO DE IDENTIDADE DAS 3 OFERTAS MAGALU EXISTENTES.
 *
 * Usa o MESMO resolvedor que o writer V1 (identityResolver.ts):
 *   buildBlockingKeys -> index -> evaluateIdentityConfidence (certificado)
 *
 * Leitura pura. Nao escreve. Compara a decisao V1 com o matchStatus legado.
 */
import prisma from "@/lib/prisma";
import { resolveProbeIdentity } from "@/services/architecture/v1/publicSync/identityResolver";
import {
  createProductListingLoader,
  createBlockingKeyLookup,
  evaluateIdentityConfidence,
} from "@/services/architecture/v1/publicSync/prismaDeps";

async function main() {
  console.log("=== FASE 5: REVALIDACAO DE IDENTIDADE MAGALU ===");
  console.log(`DATA=${new Date().toISOString()}\n`);

  const offers = await prisma.marketplaceOffer.findMany({
    where: { marketplace: "MAGAZINE_LUIZA" },
    orderBy: { externalId: "asc" },
    select: {
      id: true,
      productId: true,
      externalId: true,
      price: true,
      oldPrice: true,
      seller: true,
      sourceUrl: true,
      affiliateLink: true,
      matchStatus: true,
      matchScore: true,
      status: true,
      active: true,
      available: true,
      stock: true,
      discoverySource: true,
      product: { select: { id: true, name: true, active: true, publicationStatus: true } },
    },
  });

  const keys = createBlockingKeyLookup(prisma);
  const loader = createProductListingLoader(prisma);

  const results: Array<{
    externalId: string;
    legacyProductId: string;
    legacyMatch: string;
    legacyScore: number;
    v1Decision: string;
    v1ProductId: string | null;
    v1HardConflicts: number;
    candidateCount: number;
    exactCount: number;
  }> = [];

  for (const o of offers) {
    console.log("-".repeat(96));
    console.log(`OFFER externalId=${o.externalId} productId=${o.productId}`);
    console.log(`  LEGADO: matchStatus=${o.matchStatus} matchScore=${o.matchScore}`);

    const normalized = await loader.loadAll(o.productId, "magazine_luiza");

    if (!normalized || normalized.length === 0) {
      console.log(`  V1: normalized listing NAO CONSTRUIDA`);
      results.push({ externalId: o.externalId, legacyProductId: o.productId, legacyMatch: o.matchStatus, legacyScore: o.matchScore ?? 0, v1Decision: "NO_CANDIDATES", v1ProductId: null, v1HardConflicts: 0, candidateCount: 0, exactCount: 0 });
      continue;
    }

    const listing = normalized[0];

    const result = await resolveProbeIdentity(listing, {
      keys,
      products: loader,
      evaluate: evaluateIdentityConfidence,
      brandLexicon: new Map(),
      maxCandidatesPerListing: 50,
    });

    console.log(`  V1: outcome=${result.outcome} exactProductIds=${result.exactProductIds.length} reviewCount=${result.reviewCount} rejectCount=${result.rejectCount} hardConflictCount=${result.hardConflictCount}`);
    if (result.outcome === "EXACT_UNIQUE") {
      console.log(`      produtoEscolhido=${result.winnerProductId}`);
      console.log(`      hardConflicts=${result.decision?.hardConflicts.length ?? 0}`);
    } else if (result.outcome === "AMBIGUOUS_EXACT") {
      console.log(`      AMBIGUOUS: ${result.exactProductIds.join(", ")}`);
    } else if (result.outcome === "REVIEW" || result.outcome === "NO_EXACT") {
      console.log(`      REVIEW/NO_EXACT: decision=${result.decision?.confidence ?? "null"}`);
    }

    results.push({
      externalId: o.externalId,
      legacyProductId: o.productId,
      legacyMatch: o.matchStatus,
      legacyScore: o.matchScore ?? 0,
      v1Decision: result.outcome,
      v1ProductId: result.winnerProductId,
      v1HardConflicts: result.decision?.hardConflicts.length ?? 0,
      candidateCount: result.candidateCount,
      exactCount: result.exactProductIds.length,
    });
  }

  console.log("\n=== RESUMO FASE 5 ===");
  const counts = { EXACT_UNIQUE: 0, AMBIGUOUS_EXACT: 0, REVIEW: 0, REJECT: 0, NO_CANDIDATES: 0, NO_EXACT: 0 };
  for (const r of results) counts[r.v1Decision as keyof typeof counts]++;

  console.log(`LEGACY_CONFIRMED_EXACT = ${results.filter((r) => r.legacyMatch === "EXACT" && r.v1Decision === "EXACT_UNIQUE" && r.v1ProductId === r.legacyProductId).length}`);
  console.log(`LEGACY_DIVERGENT = ${results.filter((r) => r.legacyMatch === "EXACT" && r.v1Decision !== "EXACT_UNIQUE").length}`);
  console.log(`LEGACY_WRONG_PRODUCT = ${results.filter((r) => r.legacyMatch === "EXACT" && r.v1Decision === "EXACT_UNIQUE" && r.v1ProductId !== r.legacyProductId).length}`);
  console.log(`V1_DECISIONS:`, counts);
  console.log(`HARD_CONFLICTS_TOTAL = ${results.reduce((s, r) => s + r.v1HardConflicts, 0)}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(String(e).slice(0, 400));
  await prisma.$disconnect();
});
