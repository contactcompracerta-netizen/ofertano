import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import {
  collectShopeeCatalogCandidates,
  type ShopeeSeedCandidate,
} from "@/lib/catalog/shopeeSeeder";
import { saveProduct } from "@/services/database/saveProduct";
import { authorizePublicSync } from "@/services/architecture/v1/publicSync/flags";
import { hasPublicMultiStore } from "@/services/publicVisibility/multiStoreVisibility";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Phase = "SHADOW" | "CANARY" | "LIVE";

function parsePhase(value: string | null): Phase | null {
  const phase = value?.trim().toUpperCase();
  return phase === "SHADOW" || phase === "CANARY" || phase === "LIVE"
    ? phase
    : null;
}

function phaseLimit(raw: string | null, phase: Phase): number {
  const fallback = phase === "SHADOW" ? 250 : phase === "CANARY" ? 25 : 100;
  const cap = phase === "SHADOW" ? 500 : phase === "CANARY" ? 25 : 500;
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.trunc(parsed), cap)
    : fallback;
}

function canonicalShopeeId(externalId: string, sourceUrl: string | null): string | null {
  const raw = externalId.trim();
  const composite = /^(\d+)\.(\d+)$/.exec(raw);
  if (composite) return `${composite[1]}.${composite[2]}`;

  const bare = /^(\d+)$/.exec(raw);
  if (!bare || !sourceUrl) return null;

  try {
    const url = new URL(sourceUrl);
    const match = decodeURIComponent(url.pathname).match(
      /\/product\/(\d+)\/(\d+)(?:\/|$)/i,
    );
    if (!match?.[1] || !match[2] || match[2] !== bare[1]) return null;
    return `${match[1]}.${match[2]}`;
  } catch {
    return null;
  }
}

async function identityCollisions() {
  const rows = await prisma.marketplaceOffer.findMany({
    where: { marketplace: "SHOPEE" },
    select: {
      id: true,
      productId: true,
      externalId: true,
      sourceUrl: true,
    },
  });

  const groups = new Map<
    string,
    Array<{ id: string; productId: string; externalId: string }>
  >();

  for (const row of rows) {
    if (!row.externalId) continue;
    const canonical = canonicalShopeeId(row.externalId, row.sourceUrl);
    if (!canonical) continue;
    const list = groups.get(canonical) ?? [];
    list.push({ id: row.id, productId: row.productId, externalId: row.externalId });
    groups.set(canonical, list);
  }

  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([canonicalId, items]) => ({ canonicalId, items }));
}

async function countPublicationViolations(): Promise<number> {
  const products = await prisma.product.findMany({
    where: { autoCreated: true, active: true },
    select: {
      offers: {
        select: {
          marketplace: true,
          active: true,
          available: true,
          status: true,
          matchStatus: true,
          price: true,
          externalId: true,
          sourceUrl: true,
        },
      },
    },
  });

  return products.filter((product) => !hasPublicMultiStore(product.offers)).length;
}

async function persistCandidate(candidate: ShopeeSeedCandidate) {
  return saveProduct(candidate.product, candidate.product.affiliateLink, {
    autoCreated: true,
    discoverySource: "API",
    sourceQuery: candidate.keyword,
    rawListingContext: {
      marketplace: "SHOPEE",
      externalId: candidate.product.externalId,
      sourceUrl: candidate.product.url,
      title: candidate.product.title,
      price: candidate.product.price,
    },
  });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, error: "Acesso não autorizado." },
      { status: 401 },
    );
  }

  const authorization = authorizePublicSync("shopee");
  if (!authorization.authorized) {
    return NextResponse.json(
      {
        success: false,
        error: `WRITER_NOT_AUTHORIZED: ${authorization.reason}`,
      },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const phase = parsePhase(url.searchParams.get("phase"));
  if (!phase) {
    return NextResponse.json(
      { success: false, error: "PHASE_REQUIRED: SHADOW|CANARY|LIVE" },
      { status: 400 },
    );
  }

  const limit = phaseLimit(url.searchParams.get("limit"), phase);
  const keywordOffset = Number.parseInt(
    url.searchParams.get("keywordOffset") ?? "0",
    10,
  );
  const keywordCount = Number.parseInt(
    url.searchParams.get("keywordCount") ?? "12",
    10,
  );

  const [productsBefore, offersBefore, collisionsBefore] = await Promise.all([
    prisma.product.count(),
    prisma.marketplaceOffer.count(),
    identityCollisions(),
  ]);

  try {
    const collection = await collectShopeeCatalogCandidates({
      limit,
      keywordOffset: Number.isFinite(keywordOffset) ? keywordOffset : 0,
      keywordCount: Number.isFinite(keywordCount) ? keywordCount : 12,
    });

    const sample = collection.candidates.slice(0, 5).map((candidate) => ({
      externalId: candidate.externalId,
      title: candidate.product.title,
      price: candidate.product.price,
      keyword: candidate.keyword,
    }));

    if (collection.candidates.length === 0) {
      return NextResponse.json(
        {
          success: false,
          phase,
          error: "SHOPEE_REAL_ACQUISITION_EMPTY",
          collection,
          productsBefore,
          offersBefore,
        },
        { status: 503 },
      );
    }

    if (phase === "SHADOW") {
      return NextResponse.json({
        success: collisionsBefore.length === 0,
        phase,
        mode: "READ_ONLY",
        writerMode: authorization.mode,
        productsBefore,
        productsAfter: productsBefore,
        offersBefore,
        offersAfter: offersBefore,
        productWrites: 0,
        offerWrites: 0,
        collisions: collisionsBefore,
        collection: {
          scanned: collection.scanned,
          valid: collection.candidates.length,
          invalid: collection.invalid,
          duplicateExternalIds: collection.duplicateExternalIds,
          keywordsQueried: collection.keywordsQueried,
          sample,
        },
      });
    }

    if (collisionsBefore.length > 0) {
      return NextResponse.json(
        {
          success: false,
          phase,
          error: "SHOPEE_IDENTITY_COLLISIONS_EXIST",
          collisions: collisionsBefore,
        },
        { status: 409 },
      );
    }

    let failures = 0;
    const errors: Array<{ externalId: string; error: string }> = [];
    const savedSamples: Array<{ id: string; name: string; active: boolean; publicationStatus: string | null }> = [];

    for (const candidate of collection.candidates) {
      try {
        const saved = await persistCandidate(candidate);
        if (savedSamples.length < 5) {
          savedSamples.push({
            id: saved.id,
            name: saved.name,
            active: saved.active,
            publicationStatus: saved.publicationStatus,
          });
        }
      } catch (error) {
        failures += 1;
        if (errors.length < 10) {
          errors.push({
            externalId: candidate.externalId,
            error: error instanceof Error ? error.message.slice(0, 300) : "UNKNOWN_ERROR",
          });
        }
      }
    }

    const [
      productsAfter,
      offersAfter,
      collisionsAfter,
      orphanProducts,
      publicationViolations,
    ] = await Promise.all([
      prisma.product.count(),
      prisma.marketplaceOffer.count(),
      identityCollisions(),
      prisma.product.count({ where: { offers: { none: {} } } }),
      countPublicationViolations(),
    ]);

    const success =
      failures === 0 &&
      collisionsAfter.length === 0 &&
      orphanProducts === 0 &&
      publicationViolations === 0;

    return NextResponse.json(
      {
        success,
        phase,
        writerMode: authorization.mode,
        productsBefore,
        productsAfter,
        offersBefore,
        offersAfter,
        productWrites: productsAfter - productsBefore,
        offerWrites: offersAfter - offersBefore,
        failures,
        errors,
        orphanProducts,
        publicationViolations,
        collisions: collisionsAfter,
        collection: {
          scanned: collection.scanned,
          valid: collection.candidates.length,
          invalid: collection.invalid,
          duplicateExternalIds: collection.duplicateExternalIds,
          keywordsQueried: collection.keywordsQueried,
          sample,
        },
        savedSamples,
      },
      { status: success ? 200 : 207 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        phase,
        productsBefore,
        offersBefore,
        error: error instanceof Error ? error.message : "SHOPEE_ROLLOUT_FAILED",
      },
      { status: 500 },
    );
  }
}
