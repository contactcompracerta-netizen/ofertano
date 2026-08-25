import "dotenv/config";
import { searchMultistoreV2 } from "./search";
import { scoreQueryRelevance } from "./queryRelevance";
import { buildQueryIntent } from "./queryIntent";
import { buildQueryCore } from "./queryCore";
import { buildSearchPlan } from "./queryPlan";
import { normalizeCandidate } from "./normalizeCandidate";
import type { RawCandidate } from "./types";

const queries = [
  "Mesa De Cabeceira Criado Mais Moveis Mdp/mdf 3 Gavetas",
  "Fones De Ouvido Ihome Wireless Rosa Resistentes A Agua",
  "Polia Virabrequim Fiat Linea 1.9 16v 2010 Com Roda Fonica",
];

const TARGET_LISTING = "MLB1967745737";
const TARGET_CATALOG = "MLBU793045557";
const WATCHDOG_MS = 120_000;

function compactId(value: string): string {
  return value.replace(/-/g, "").toUpperCase();
}

function mentionsTarget(candidate: RawCandidate, target: string): boolean {
  const haystack = compactId(
    `${candidate.externalId} ${candidate.url} ${candidate.title}`,
  );
  return haystack.includes(target);
}

async function main() {
  const watchdog = setTimeout(() => {
    console.error("[OVERNIGHT] watchdog: processo encerrado apos 120s");
    process.exit(2);
  }, WATCHDOG_MS);

  try {
    for (const query of queries) {
      console.log("\n========== OVERNIGHT QUERY:", query, "==========");
      const core = buildQueryCore(query);
      const plan = buildSearchPlan(query);
      console.log("[OVERNIGHT] queryCore", {
        productClass: core.productClass,
        brand: core.brand,
        soldText: core.soldText,
        hostText: core.hostText,
        requestedRole: core.requestedRole,
        productCoreLabels: core.productCoreLabels,
        plan,
      });

      const started = Date.now();
      const result = await searchMultistoreV2(query, {
        persist: false,
        hunt: false,
        limit: 12,
      });
      const elapsedMs = Date.now() - started;
      const intent = buildQueryIntent(query);
      const allRaw = result.acquisitions.flatMap((item) => item.candidates);
      const scored = allRaw.map((candidate) =>
        scoreQueryRelevance(intent, normalizeCandidate(candidate)),
      );
      const rejected = scored
        .filter((item) => item.status === "REJECTED")
        .slice(0, 12)
        .map((item) => ({
          title: item.normalized.raw.title,
          externalId: item.normalized.raw.externalId,
          marketplace: item.normalized.raw.marketplace,
          reason: item.reason,
          core: item.evidence.productCoreCoverage,
          class: item.evidence.productClassCompatibility,
        }));

      const listingRaw = allRaw.find((item) =>
        mentionsTarget(item, TARGET_LISTING),
      );
      const catalogRaw = allRaw.find((item) =>
        mentionsTarget(item, TARGET_CATALOG),
      );
      const listingScored = scored.find((item) =>
        mentionsTarget(item.normalized.raw, TARGET_LISTING),
      );
      const listingCluster = result.clusters.find((cluster) =>
        cluster.members.some((member) =>
          mentionsTarget(member.candidate.normalized.raw, TARGET_LISTING),
        ),
      );

      let listingStage = "not-in-raw";
      if (listingRaw) {
        listingStage = "raw";
        if (listingScored) {
          listingStage =
            listingScored.status === "RELEVANT" ? "relevant" : "rejected";
        }
        if (listingCluster) {
          listingStage = "cluster";
        }
      }

      console.log("[OVERNIGHT] summary", {
        query,
        elapsedMs,
        marketplacesAttempted: result.marketplacesAttempted,
        marketplaces: result.acquisitions.map((item) => ({
          marketplace: item.marketplace,
          status: item.status,
          raw: item.raw,
          usable: item.usable,
          elapsedMs: item.elapsedMs,
          error: item.error,
        })),
        rawCandidates: result.rawCandidates,
        usableCandidates: result.acquisitions.reduce(
          (total, item) => total + item.usable,
          0,
        ),
        relevantCandidates: result.relevantCandidates.length,
        clusters: result.products.length,
        multiStoreClusters: result.multiStoreClusters,
        accepted: result.relevantCandidates.slice(0, 12).map((item) => ({
          title: item.normalized.raw.title,
          marketplace: item.normalized.raw.marketplace,
          externalId: item.normalized.raw.externalId,
          reason: item.reason,
          class: item.evidence.productClassCompatibility,
          core: item.evidence.productCoreCoverage,
        })),
        rejected,
        titles: result.products.slice(0, 8).map((product) => ({
          title: product.title,
          offers: product.offers.length,
          marketplaces: product.marketplaces,
          price: product.price,
        })),
      });

      console.log("[OVERNIGHT] target-ml", {
        query,
        listingId: TARGET_LISTING,
        catalogId: TARGET_CATALOG,
        listingFound: Boolean(listingRaw),
        catalogFound: Boolean(catalogRaw),
        stage: listingStage,
        raw: listingRaw
          ? {
              marketplace: listingRaw.marketplace,
              externalId: listingRaw.externalId,
              title: listingRaw.title,
              price: listingRaw.price,
              url: listingRaw.url,
            }
          : null,
        catalogRaw: catalogRaw
          ? {
              marketplace: catalogRaw.marketplace,
              externalId: catalogRaw.externalId,
              title: catalogRaw.title,
            }
          : null,
        normalized: Boolean(listingScored),
        usable: Boolean(listingRaw),
        relevant: listingScored?.status === "RELEVANT",
        rejected: listingScored?.status === "REJECTED",
        reason: listingScored?.reason ?? null,
        clusterId: listingCluster?.clusterId ?? null,
      });
    }
  } finally {
    clearTimeout(watchdog);
  }
}

void main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
