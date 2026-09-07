import prisma from "@/lib/prisma";
import { createProductPresentation } from "@/lib/product/productPresentation";
import { isDescriptionInvalid, sanitizeProductTitle } from "@/lib/seo/product";
import { hasPublicMultiStore } from "@/services/publicVisibility/multiStoreVisibility";

/*
 * MONITOR DE REGRESSAO DO CATALOGO — SOMENTE LEITURA.
 *
 * Reutiliza os helpers oficiais (hasPublicMultiStore, createProductPresentation,
 * sanitizeProductTitle, isDescriptionInvalid). Nao define regra propria de
 * "produto publico", "oferta publica", "brand conflict", "descricao invalida"
 * ou "titulo invalido": apenas conta com os mesmos criterios da auditoria
 * (src/scripts/auditCatalogPresentation.ts) e avalia regressao.
 *
 * Nenhuma escrita no banco. Nenhum envio de e-mail/WhatsApp. Nenhum cron.
 */

export const PROTECTED_REJECTED_OFFER_IDS = [
  "cmt6ig9sn000604l5d7sw6k7w",
  "cmt6ig8lf000404l533n6ou3s",
  "cmt6igeux000e04l5vn8q8ohh",
  "cmt6igcdp000a04l59qlbyo21",
  "cmt6ig7dz000204l588l3g7v2",
] as const;

const CONTROL_CHARS_PATTERN = new RegExp("[\\x00-\\x1F\\x7F-\\x9F]");

export type PresentationCounters = {
  publicProductsScanned: number;
  nonPublicProductsSkipped: number;
  productsOk: number;
  productsWithIssues: number;
  titleIssues: number;
  descriptionIssues: number;
  brandConflicts: number;
  invalidCanonicalBrands: number;
  structuredBrandCleanupNeeded: number;
};

export type ProtectedOfferStatus = {
  id: string;
  found: boolean;
  matchStatus: string | null;
};

export type RegressionEvaluation = {
  regression: boolean;
  reasons: string[];
  regressedOfferIds: string[];
  productCountInvariant: boolean;
  protectedInvariant: boolean;
};

export function sanitizeDbErrorMessage(message: string): string {
  return message
    .replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"']+/g, "[redacted-url]")
    .replace(/postgres(?:ql)?:[^@\s]*@[^\s"']+/gi, "[redacted-credentials]")
    .replace(/sb_[A-Za-z0-9_-]+/g, "[redacted-key]")
    .slice(0, 500);
}

export type PublicProductLike = {
  id: string;
  name: string;
  description: string | null;
  brand: string | null;
  specifications: Record<string, unknown> | null;
};

// Mesmos criterios de contagem da auditoria oficial. Recebe apenas produtos
// ja filtrados por hasPublicMultiStore.
export function computePresentationCounters(
  publicProducts: PublicProductLike[],
  nonPublicProductsSkipped: number,
): PresentationCounters {
  let titleIssues = 0;
  let descriptionIssues = 0;
  let brandConflicts = 0;
  let invalidCanonicalBrands = 0;
  let structuredBrandCleanupNeeded = 0;
  const productsWithAnyIssue = new Set<string>();

  for (const product of publicProducts) {
    const presentation = createProductPresentation({
      name: product.name,
      description: product.description,
      brand: product.brand,
      specifications: product.specifications,
    });

    const displayName = sanitizeProductTitle(product.name);

    let hasTitleIssue = false;
    if (
      product.name.trim().endsWith(",") ||
      product.name.includes("\n") ||
      product.name !== product.name.replace(/\s+/g, " ").trim() ||
      CONTROL_CHARS_PATTERN.test(product.name) ||
      product.name !== displayName
    ) {
      titleIssues += 1;
      hasTitleIssue = true;
    }
    if (hasTitleIssue) productsWithAnyIssue.add(product.id);

    if (product.description && isDescriptionInvalid(product.description)) {
      descriptionIssues += 1;
      productsWithAnyIssue.add(product.id);
    }

    if (presentation.brandConflict) {
      brandConflicts += 1;
      productsWithAnyIssue.add(product.id);
    }

    if (
      product.brand &&
      !presentation.resolvedBrand &&
      !presentation.brandConflict
    ) {
      invalidCanonicalBrands += 1;
      productsWithAnyIssue.add(product.id);
    }

    if (
      presentation.structuredBrand &&
      presentation.resolvedBrand === presentation.structuredBrand
    ) {
      const rawStructured = product.specifications
        ? (Object.entries(product.specifications).find(
            ([key]) =>
              key.toLowerCase().includes("marca") ||
              key.toLowerCase().includes("brand"),
          )?.[1] as string | undefined)
        : null;
      if (rawStructured && rawStructured !== presentation.structuredBrand) {
        structuredBrandCleanupNeeded += 1;
        productsWithAnyIssue.add(product.id);
      }
    }
  }

  const productsWithIssues = productsWithAnyIssue.size;
  return {
    publicProductsScanned: publicProducts.length,
    nonPublicProductsSkipped,
    productsOk: publicProducts.length - productsWithIssues,
    productsWithIssues,
    titleIssues,
    descriptionIssues,
    brandConflicts,
    invalidCanonicalBrands,
    structuredBrandCleanupNeeded,
  };
}

export function evaluateCatalogRegression(
  counters: Pick<
    PresentationCounters,
    | "publicProductsScanned"
    | "productsOk"
    | "productsWithIssues"
    | "titleIssues"
    | "descriptionIssues"
    | "brandConflicts"
    | "invalidCanonicalBrands"
    | "structuredBrandCleanupNeeded"
  >,
  offers: ProtectedOfferStatus[],
): RegressionEvaluation {
  const reasons: string[] = [];

  if (counters.productsWithIssues > 0)
    reasons.push(`PRODUCTS_WITH_ISSUES=${counters.productsWithIssues}`);
  if (counters.titleIssues > 0)
    reasons.push(`TITLE_ISSUES=${counters.titleIssues}`);
  if (counters.descriptionIssues > 0)
    reasons.push(`DESCRIPTION_ISSUES=${counters.descriptionIssues}`);
  if (counters.brandConflicts > 0)
    reasons.push(`BRAND_CONFLICTS=${counters.brandConflicts}`);
  if (counters.invalidCanonicalBrands > 0)
    reasons.push(
      `INVALID_CANONICAL_BRANDS=${counters.invalidCanonicalBrands}`,
    );
  if (counters.structuredBrandCleanupNeeded > 0)
    reasons.push(
      `STRUCTURED_BRAND_CLEANUP_NEEDED=${counters.structuredBrandCleanupNeeded}`,
    );

  const regressedOfferIds = offers
    .filter((offer) => !offer.found || offer.matchStatus !== "REJECTED")
    .map((offer) => offer.id);
  for (const offer of offers) {
    if (!offer.found || offer.matchStatus !== "REJECTED") {
      reasons.push(
        `REGRESSED_OFFER_ID=${offer.id} EXPECTED_MATCH_STATUS=REJECTED ACTUAL_MATCH_STATUS=${offer.found ? (offer.matchStatus ?? "null") : "NOT_FOUND"}`,
      );
    }
  }

  // NOTA: PUBLIC_PRODUCTS_SCANNED nao e alerta fixo — o catalogo pode
  // crescer/diminuir legitimamente. O invariante obrigatorio e a soma.
  const productCountInvariant =
    counters.productsOk + counters.productsWithIssues ===
    counters.publicProductsScanned;
  if (!productCountInvariant) {
    reasons.push(
      `PRODUCT_COUNT_INVARIANT_VIOLATION: PRODUCTS_OK(${counters.productsOk}) + PRODUCTS_WITH_ISSUES(${counters.productsWithIssues}) !== PUBLIC_PRODUCTS_SCANNED(${counters.publicProductsScanned})`,
    );
  }

  const protectedInvariant =
    offers.length === PROTECTED_REJECTED_OFFER_IDS.length;
  if (!protectedInvariant) {
    reasons.push(
      `PROTECTED_OFFERS_INVARIANT_VIOLATION: checked=${offers.length} expected=${PROTECTED_REJECTED_OFFER_IDS.length}`,
    );
  }

  return {
    regression: reasons.length > 0,
    reasons,
    regressedOfferIds,
    productCountInvariant,
    protectedInvariant,
  };
}

async function runCatalogRegressionMonitor(): Promise<void> {
  console.log("CATALOG_MONITOR_MODE=READ_ONLY");

  let counters: PresentationCounters;
  let offerStatuses: ProtectedOfferStatus[];
  try {
    // READ-ONLY: mesma consulta/filtro da auditoria oficial.
    const allProducts = await prisma.product.findMany({
      where: {
        active: true,
        publicationStatus: { not: "DRAFT" },
      },
      select: {
        id: true,
        name: true,
        description: true,
        brand: true,
        specifications: true,
        offers: {
          where: {
            active: true,
            matchStatus: "EXACT",
          },
          select: {
            marketplace: true,
            active: true,
            available: true,
            status: true,
            matchStatus: true,
            price: true,
          },
        },
      },
    });

    const publicProducts = allProducts.filter(hasPublicMultiStore);
    counters = computePresentationCounters(
      publicProducts.map((product) => ({
        ...product,
        specifications: product.specifications as Record<
          string,
          unknown
        > | null,
      })),
      allProducts.length - publicProducts.length,
    );

    // READ-ONLY: verificacao das 5 ofertas protegidas.
    const protectedOffers = await prisma.marketplaceOffer.findMany({
      where: { id: { in: [...PROTECTED_REJECTED_OFFER_IDS] } },
      select: { id: true, matchStatus: true },
    });
    const byId = new Map(protectedOffers.map((offer) => [offer.id, offer]));
    offerStatuses = PROTECTED_REJECTED_OFFER_IDS.map((id) => {
      const found = byId.get(id);
      return {
        id,
        found: Boolean(found),
        matchStatus: found ? found.matchStatus : null,
      };
    });

    console.log("DATABASE_CONNECTION=PASS");
  } catch (error) {
    console.log("DATABASE_CONNECTION=FAIL");
    const message = error instanceof Error ? error.message : String(error);
    console.log(`DATABASE_ERROR=${sanitizeDbErrorMessage(message)}`);
    console.log("PRODUCT_COUNT_INVARIANT=FAIL");
    console.log("DB_WRITES=0");
    console.log("CATALOG_REGRESSION=true");
    console.log("MONITOR_RESULT=ERROR");
    process.exitCode = 2;
    return;
  }

  const evaluation = evaluateCatalogRegression(counters, offerStatuses);
  const okCount =
    PROTECTED_REJECTED_OFFER_IDS.length - evaluation.regressedOfferIds.length;

  console.log(`PUBLIC_PRODUCTS_SCANNED=${counters.publicProductsScanned}`);
  console.log(`PRODUCTS_OK=${counters.productsOk}`);
  console.log(`PRODUCTS_WITH_ISSUES=${counters.productsWithIssues}`);
  console.log("");
  console.log(`TITLE_ISSUES=${counters.titleIssues}`);
  console.log(`DESCRIPTION_ISSUES=${counters.descriptionIssues}`);
  console.log(`BRAND_CONFLICTS=${counters.brandConflicts}`);
  console.log(`INVALID_CANONICAL_BRANDS=${counters.invalidCanonicalBrands}`);
  console.log(
    `STRUCTURED_BRAND_CLEANUP_NEEDED=${counters.structuredBrandCleanupNeeded}`,
  );
  console.log("");
  console.log(
    `PROTECTED_REJECTED_OFFERS_EXPECTED=${PROTECTED_REJECTED_OFFER_IDS.length}`,
  );
  console.log(`PROTECTED_REJECTED_OFFERS_OK=${okCount}`);
  console.log(
    `PROTECTED_REJECTED_OFFERS_REGRESSED=${evaluation.regressedOfferIds.length}`,
  );
  for (const offer of offerStatuses) {
    if (!offer.found || offer.matchStatus !== "REJECTED") {
      console.log(`REGRESSED_OFFER_ID=${offer.id}`);
      console.log("EXPECTED_MATCH_STATUS=REJECTED");
      console.log(
        `ACTUAL_MATCH_STATUS=${offer.found ? (offer.matchStatus ?? "null") : "NOT_FOUND"}`,
      );
    }
  }
  console.log("");
  console.log(
    `PRODUCT_COUNT_INVARIANT=${evaluation.productCountInvariant ? "PASS" : "FAIL"}`,
  );
  console.log("DB_WRITES=0");
  console.log("");
  if (evaluation.regression) {
    for (const reason of evaluation.reasons) {
      console.log(`REGRESSION_REASON=${reason}`);
    }
  }
  console.log(`CATALOG_REGRESSION=${evaluation.regression}`);
  console.log(`MONITOR_RESULT=${evaluation.regression ? "REGRESSION" : "PASS"}`);
  process.exitCode = evaluation.regression ? 1 : 0;
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  process.argv[1].endsWith("catalogRegressionMonitor.ts");

if (invokedDirectly) {
  runCatalogRegressionMonitor().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.log("DATABASE_CONNECTION=FAIL");
    console.log(`DATABASE_ERROR=${sanitizeDbErrorMessage(message)}`);
    console.log("DB_WRITES=0");
    console.log("CATALOG_REGRESSION=true");
    console.log("MONITOR_RESULT=ERROR");
    process.exitCode = 2;
  });
}
