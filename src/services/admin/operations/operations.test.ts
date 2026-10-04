import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import type { NextRequest } from "next/server";

import { proxy } from "../../../proxy";
import {
  buildOperationsMetrics,
  freshness,
} from "./metrics";

const now = new Date("2026-10-04T12:00:00.000Z");

test("dashboard metrics summarize real product and offer buckets", () => {
  const metrics = buildOperationsMetrics({
    productStates: [
      { active: true, publicationStatus: "LIVE_COMPLETE", count: 1 },
      { active: true, publicationStatus: "LIVE_PARTIAL", count: 1 },
      { active: false, publicationStatus: "DRAFT", count: 2 },
    ],
    offersByProduct: [
      { productId: "p1", count: 2 },
      { productId: "p2", count: 1 },
    ],
    offersBySource: [
      {
        marketplace: "SHOPEE",
        active: true,
        productId: "p1",
        count: 1,
        latestUpdatedAt: new Date("2026-10-04T11:00:00.000Z"),
        latestCheckedAt: new Date("2026-10-04T10:00:00.000Z"),
      },
      {
        marketplace: "SHOPEE",
        active: false,
        productId: "p2",
        count: 1,
        latestUpdatedAt: new Date("2026-10-03T11:00:00.000Z"),
        latestCheckedAt: null,
      },
      {
        marketplace: "MAGAZINE_LUIZA",
        active: true,
        productId: "p1",
        count: 1,
        latestUpdatedAt: new Date("2026-10-04T09:00:00.000Z"),
        latestCheckedAt: new Date("2026-10-04T08:00:00.000Z"),
      },
    ],
    publicProducts: 1,
    offersWithoutSourceUrl: 1,
    incompleteOffers: 2,
    dueOffers: 1,
    latestProductUpdate: new Date("2026-10-04T07:00:00.000Z"),
    latestPriceRecord: new Date("2026-10-04T08:00:00.000Z"),
    now,
  });

  assert.deepEqual(metrics.catalog, {
    products: 4,
    activeProducts: 2,
    inactiveProducts: 2,
    publishedProducts: 2,
    unpublishedProducts: 2,
    publicProducts: 1,
    productsWithoutOffers: 2,
    productsWithOneOffer: 1,
    productsWithMultipleOffers: 1,
    productsWithPublicComparison: 1,
    publicationStatuses: [
      { status: "LIVE_COMPLETE", count: 1 },
      { status: "LIVE_PARTIAL", count: 1 },
      { status: "DRAFT", count: 2 },
    ],
    latestUpdate: new Date("2026-10-04T07:00:00.000Z"),
  });
  assert.equal(metrics.offers.total, 3);
  assert.equal(metrics.offers.active, 2);
  assert.equal(metrics.offers.inactive, 1);
  assert.equal(metrics.offers.averagePerProduct, 0.75);
  assert.equal(metrics.offers.bySource[0].label, "Shopee");
  assert.equal(metrics.offers.bySource[0].products, 2);
  assert.equal(metrics.priceMonitor.mode, "REFRESH_ONLY");
  assert.equal(metrics.priceMonitor.productCreation, 0);
  assert.equal(metrics.priceMonitor.dueOffers, 1);
  assert.equal(metrics.priceMonitor.freshness, "RECENT");
});

test("empty catalog produces zero metrics and unknown freshness", () => {
  const metrics = buildOperationsMetrics({
    productStates: [],
    offersByProduct: [],
    offersBySource: [],
    publicProducts: 0,
    offersWithoutSourceUrl: 0,
    incompleteOffers: 0,
    dueOffers: 0,
    latestProductUpdate: null,
    latestPriceRecord: null,
    now,
  });

  assert.equal(metrics.catalog.products, 0);
  assert.equal(metrics.catalog.productsWithoutOffers, 0);
  assert.equal(metrics.offers.total, 0);
  assert.equal(metrics.offers.averagePerProduct, 0);
  assert.equal(metrics.priceMonitor.freshness, "UNKNOWN");
});

test("freshness uses conservative 24-hour boundary and unknown for missing time", () => {
  assert.equal(freshness(null, now), "UNKNOWN");
  assert.equal(
    freshness(new Date("2026-10-03T11:59:59.000Z"), now),
    "STALE",
  );
  assert.equal(
    freshness(new Date("2026-10-03T12:00:00.000Z"), now),
    "RECENT",
  );
});

test("the existing admin proxy challenges unauthenticated operations requests", () => {
  const response = proxy({
    nextUrl: { pathname: "/admin/operacoes" },
    headers: new Headers(),
  } as unknown as NextRequest);

  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get("www-authenticate"),
    'Basic realm="Painel Ofertano"',
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("operations query layer contains no Prisma mutations", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/services/admin/operations/queries.ts"),
    "utf8",
  );
  const mutationCall = /\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert|executeRaw|executeRawUnsafe)\s*\(/i;

  assert.doesNotMatch(source, mutationCall);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
});

test("operations page has no action form or command button", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/app/admin/operacoes/page.tsx"),
    "utf8",
  );

  assert.doesNotMatch(source, /<(?:button|form)\b/i);
});