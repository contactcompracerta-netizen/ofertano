import prisma from "@/lib/prisma";
import { createProductPresentation } from "@/lib/product/productPresentation";
import { isDescriptionInvalid, sanitizeProductTitle } from "@/lib/seo/product";
import { hasPublicMultiStore } from "@/services/publicVisibility/multiStoreVisibility";

interface PresentationIssue {
  productId: string;
  rawName: string;
  displayName: string;
  issue: string;
  details?: string;
}

async function auditCatalogPresentation() {
  console.log("CATALOG_AUDIT_MODE=READ_ONLY");
  console.log("Starting catalog presentation audit (read-only)...\n");

  // Fetch products with offers needed for Multi Loja visibility check
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

  // Filter to only public Multi Loja products using the official rule
  const publicProducts = allProducts.filter(hasPublicMultiStore);
  const nonPublicSkipped = allProducts.length - publicProducts.length;

  console.log(`PUBLIC_PRODUCTS_SCANNED=${publicProducts.length}`);
  console.log(`NON_PUBLIC_PRODUCTS_SKIPPED=${nonPublicSkipped}\n`);

  const titleIssues: PresentationIssue[] = [];
  const descriptionIssues: PresentationIssue[] = [];
  const brandConflicts: PresentationIssue[] = [];
  const invalidCanonicalBrands: PresentationIssue[] = [];
  const structuredBrandCleanupNeeded: PresentationIssue[] = [];

  // Track unique products with any issue
  const productsWithAnyIssue = new Set<string>();

  for (const product of publicProducts) {
    const presentation = createProductPresentation({
      name: product.name,
      description: product.description,
      brand: product.brand,
      specifications: product.specifications as Record<string, unknown> | null,
    });

    // TITLE AUDIT
    const displayName = sanitizeProductTitle(product.name);

    // Check for trailing comma
    if (product.name.trim().endsWith(',')) {
      titleIssues.push({
        productId: product.id,
        rawName: product.name,
        displayName,
        issue: "Trailing comma",
      });
      productsWithAnyIssue.add(product.id);
    }

    // Check for newlines
    if (product.name.includes('\n')) {
      titleIssues.push({
        productId: product.id,
        rawName: product.name,
        displayName,
        issue: "Contains newline",
      });
      productsWithAnyIssue.add(product.id);
    }

    // Check for extra spaces
    if (product.name !== product.name.replace(/\s+/g, ' ').trim()) {
      titleIssues.push({
        productId: product.id,
        rawName: product.name,
        displayName,
        issue: "Extra whitespace",
      });
      productsWithAnyIssue.add(product.id);
    }

    // Check for control characters
    if (/[\x00-\x1F\x7F-\x9F]/.test(product.name)) {
      titleIssues.push({
        productId: product.id,
        rawName: product.name,
        displayName,
        issue: "Control characters",
      });
      productsWithAnyIssue.add(product.id);
    }

    // Check for divergence between raw and display name
    if (product.name !== displayName && !titleIssues.some(i => i.productId === product.id)) {
      titleIssues.push({
        productId: product.id,
        rawName: product.name,
        displayName,
        issue: "Display name differs from raw",
      });
      productsWithAnyIssue.add(product.id);
    }

    // DESCRIPTION AUDIT
    if (product.description && isDescriptionInvalid(product.description)) {
      descriptionIssues.push({
        productId: product.id,
        rawName: product.name,
        displayName,
        issue: "Invalid description",
        details: product.description?.substring(0, 100),
      });
      productsWithAnyIssue.add(product.id);
    }

    // BRAND AUDIT
    if (presentation.brandConflict) {
      brandConflicts.push({
        productId: product.id,
        rawName: product.name,
        displayName,
        issue: "Brand conflict",
        details: `canonical: ${product.brand} vs structured: ${presentation.structuredBrand}`,
      });
      productsWithAnyIssue.add(product.id);
    }

    // Check for invalid canonical brand (marketplaces treated as brands)
    if (product.brand && !presentation.resolvedBrand && !presentation.brandConflict) {
      invalidCanonicalBrands.push({
        productId: product.id,
        rawName: product.name,
        displayName,
        issue: "Invalid canonical brand",
        details: product.brand,
      });
      productsWithAnyIssue.add(product.id);
    }

    // Check for structured brand needing cleanup
    if (presentation.structuredBrand && presentation.resolvedBrand === presentation.structuredBrand) {
      const rawStructured = product.specifications
        ? Object.entries(product.specifications as Record<string, unknown>)
            .find(([key]) => key.toLowerCase().includes('marca') || key.toLowerCase().includes('brand'))
            ?.[1] as string | undefined
        : null;

      if (rawStructured && rawStructured !== presentation.structuredBrand) {
        structuredBrandCleanupNeeded.push({
          productId: product.id,
          rawName: product.name,
          displayName,
          issue: "Structured brand cleanup needed",
          details: `raw: "${rawStructured}" -> "${presentation.structuredBrand}"`,
        });
        productsWithAnyIssue.add(product.id);
      }
    }
  }

  const productsWithIssuesCount = productsWithAnyIssue.size;
  const productsOk = publicProducts.length - productsWithIssuesCount;

  console.log("=== CATALOG PRESENTATION AUDIT SUMMARY ===\n");
  console.log(`PRODUCTS_OK=${productsOk}`);
  console.log(`PRODUCTS_WITH_ISSUES=${productsWithIssuesCount}`);
  console.log(`TITLE_ISSUES=${titleIssues.length}`);
  console.log(`DESCRIPTION_ISSUES=${descriptionIssues.length}`);
  console.log(`BRAND_CONFLICTS=${brandConflicts.length}`);
  console.log(`INVALID_CANONICAL_BRANDS=${invalidCanonicalBrands.length}`);
  console.log(`STRUCTURED_BRAND_CLEANUP_NEEDED=${structuredBrandCleanupNeeded.length}`);
  console.log(`DB_WRITES=0\n`);

  // Show sample issues (max 20 per category)
  function showSampleIssues(issues: PresentationIssue[], category: string) {
    if (issues.length === 0) return;

    console.log(`=== ${category} (sample, max 20) ===\n`);
    const sampleIssues = issues.slice(0, 20);

    for (const issue of sampleIssues) {
      console.log(`Product ID: ${issue.productId}`);
      console.log(`Issue: ${issue.issue}`);
      console.log(`Raw name: "${issue.rawName}"`);
      console.log(`Display name: "${issue.displayName}"`);
      if (issue.details) {
        console.log(`Details: ${issue.details}`);
      }
      console.log("---");
    }

    if (issues.length > 20) {
      console.log(`... and ${issues.length - 20} more ${category.toLowerCase()}\n`);
    } else {
      console.log();
    }
  }

  showSampleIssues(titleIssues, "TITLE ISSUES");
  showSampleIssues(descriptionIssues, "DESCRIPTION ISSUES");
  showSampleIssues(brandConflicts, "BRAND CONFLICTS");
  showSampleIssues(invalidCanonicalBrands, "INVALID CANONICAL BRANDS");
  showSampleIssues(structuredBrandCleanupNeeded, "STRUCTURED BRAND CLEANUP NEEDED");

  console.log("=== AUDIT COMPLETE ===");
  console.log("This was a READ-ONLY audit. No database changes were made.");

  process.exit(productsWithIssuesCount > 0 ? 1 : 0);
}

auditCatalogPresentation().catch((error) => {
  console.error("Audit failed:", error);
  process.exit(1);
});
