/**
 * CATALOG_ARCHITECTURE_V1 — FAKE MARKETPLACE CONNECTORS (FASE Q).
 *
 * FakeConnectorA: marketplace "MARKET_A" — rico (gtin, variantes, pix, stock).
 * FakeConnectorB: marketplace "MARKET_B" — mínimo (sem gtin/variantes/pix/stock).
 *
 * Ambos passam pelo MESMO fluxo (conector -> contrato normalizado -> raw ->
 * ingest -> projeção -> publicação) sem alterar o núcleo. Prove a
 * extensibilidade da Architecture V1.
 *
 * Nomes A/B/C/D/E são fictícios: NUNCA nomes reais de marketplace.
 */

import type {
  CollectedListingBatch,
  MarketplaceConnector,
} from "../types/connector";
import {
  NORMALIZED_LISTING_V1,
  UNKNOWN,
} from "../types/normalizedListingV1";
import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import { computeRawHash } from "../hashing";

export interface FakeListingFixtureV1 {
  marketplaceId: string;
  externalListingId: string;
  seller?: { externalSellerId?: string | null; name?: string | null } | null;
  identity?: Partial<NormalizedMarketplaceListingV1["identity"]> | null;
  catalog?: Partial<NormalizedMarketplaceListingV1["catalog"]> | null;
  variant?: Partial<NormalizedMarketplaceListingV1["variant"]> | null;
  commerce?: Partial<NormalizedMarketplaceListingV1["commerce"]> | null;
  metadata?: { sourceUpdatedAt?: string | null; payloadVersion?: string } | null;
}

/**
 * Constrói uma listing normalizada a partir de fixture determinística.
 * Campo ausente vira null (fonte não informou) — nunca UNKNOWN a menos que o
 * fixture declare explicitamente.
 */
export function buildFakeListing(
  fixture: FakeListingFixtureV1,
  overrides?: { price?: number; stock?: number | null; title?: string },
): NormalizedMarketplaceListingV1 {
  const price = overrides?.price ?? fixture.commerce?.price ?? 1999.9;
  const base: NormalizedMarketplaceListingV1 = {
    contractVersion: NORMALIZED_LISTING_V1,
    source: "fake-connector-a",
    marketplaceId: fixture.marketplaceId,
    externalListingId: fixture.externalListingId,
    seller: {
      externalSellerId: fixture.seller?.externalSellerId ?? null,
      name: fixture.seller?.name ?? null,
    },
    identity: {
      gtin: fixture.identity?.gtin ?? [],
      mpn: fixture.identity?.mpn ?? null,
      manufacturerModel: fixture.identity?.manufacturerModel ?? null,
      brand: fixture.identity?.brand ?? null,
      model: fixture.identity?.model ?? null,
    },
    catalog: {
      title: overrides?.title ?? fixture.catalog?.title ?? null,
      description: fixture.catalog?.description ?? null,
      category: fixture.catalog?.category ?? null,
      images: fixture.catalog?.images ?? [],
      attributes: fixture.catalog?.attributes ?? {},
      primaryImageUrl: fixture.catalog?.primaryImageUrl ?? null,
    },
    variant: {
      color: fixture.variant?.color ?? null,
      storage: fixture.variant?.storage ?? null,
      memory: fixture.variant?.memory ?? null,
      voltage: fixture.variant?.voltage ?? null,
      size: fixture.variant?.size ?? null,
      otherAttributes: fixture.variant?.otherAttributes ?? {},
    },
    commerce: {
      price,
      oldPrice: overrides?.price !== undefined ? fixture.commerce?.oldPrice ?? null : fixture.commerce?.oldPrice ?? null,
      pixPrice: fixture.commerce?.pixPrice ?? null,
      installments: fixture.commerce?.installments ?? null,
      stock: overrides?.stock !== undefined ? (overrides.stock ?? UNKNOWN) : (fixture.commerce?.stock ?? null),
      availability: fixture.commerce?.availability ?? "IN_STOCK",
      shippingHint: fixture.commerce?.shippingHint ?? null,
      promotion: fixture.commerce?.promotion ?? null,
    },
    metadata: {
      sourceUpdatedAt:
        fixture.metadata?.sourceUpdatedAt ?? new Date().toISOString(),
      collectedAt: new Date().toISOString(),
      rawHash: "",
      payloadVersion: fixture.metadata?.payloadVersion ?? "raw/v1",
    },
  };
  // rawHash do payload bruto (o "raw" é o próprio fixture).
  base.metadata.rawHash = computeRawHash(fixture);
  return base;
}

/** Fixtures de catálogo fictício usado pelos conectores. */
export const FAKE_LISTING_FIXTURES_V1: FakeListingFixtureV1[] = [
  // Produto A — Smartphone "Nova X" 256GB Preto
  {
    marketplaceId: "MARKET_A",
    externalListingId: "a1",
    seller: { externalSellerId: "s-a-1", name: "Loja A Oficial" },
    identity: {
      gtin: ["7891234567890"],
      mpn: "NX-256-BLK",
      manufacturerModel: "Nova X",
      brand: "Nova",
      model: "Nova X",
    },
    catalog: {
      title: "Smartphone Nova X 256GB Preto",
      description: "Smartphone 6.7 polegadas",
      category: "Celulares",
      images: ["https://img.invalid/nova-x-black.jpg"],
      attributes: { screen: "6.7\"", battery: "5000mAh" },
      primaryImageUrl: "https://img.invalid/nova-x-black.jpg",
    },
    variant: { color: "Preto", storage: "256GB", memory: "8GB" },
    commerce: { price: 1999.9, oldPrice: 2299.0, pixPrice: 1899.9, stock: 42 },
  },
  // Produto A — Mesmo SKU, outra cor (variante)
  {
    marketplaceId: "MARKET_A",
    externalListingId: "a2",
    seller: { externalSellerId: "s-a-1", name: "Loja A Oficial" },
    identity: {
      gtin: ["7891234567890"],
      mpn: "NX-256-WHT",
      manufacturerModel: "Nova X",
      brand: "Nova",
      model: "Nova X",
    },
    catalog: {
      title: "Smartphone Nova X 256GB Branco",
      description: "Smartphone 6.7 polegadas",
      category: "Celulares",
      images: ["https://img.invalid/nova-x-white.jpg"],
      primaryImageUrl: "https://img.invalid/nova-x-white.jpg",
    },
    variant: { color: "Branco", storage: "256GB", memory: "8GB" },
    commerce: { price: 2019.9, pixPrice: 1919.9, stock: 15 },
  },
  // Produto B — Fone "Som Max"
  {
    marketplaceId: "MARKET_A",
    externalListingId: "a3",
    seller: { externalSellerId: "s-a-9", name: "Audio Store" },
    identity: { gtin: ["7899999999"], brand: "Som", model: "Max" },
    catalog: {
      title: "Fone Bluetooth Som Max",
      category: "Áudio",
      images: ["https://img.invalid/som-max.jpg"],
      primaryImageUrl: "https://img.invalid/som-max.jpg",
    },
    variant: { color: "Preto" },
    commerce: { price: 249.9, stock: 100 },
  },
];

function collectFromFixtures(
  fixtures: FakeListingFixtureV1[],
  marketplaceId: string,
  source: string,
  fromCursor: string | null,
): CollectedListingBatch {
  const pageSize = 2;
  const start = fromCursor ? Number.parseInt(fromCursor, 10) : 0;
  const slice = fixtures.slice(start, start + pageSize);
  const items = slice.map((f) => buildFakeListing({ ...f, marketplaceId }));
  const next = start + pageSize < fixtures.length ? String(start + pageSize) : null;
  return {
    items: items.map((listing) => ({ ...listing, source })),
    nextCursor: next,
    snapshotComplete: next === null,
  };
}

/** Conector fictício rico. */
export class FakeMarketplaceConnectorA implements MarketplaceConnector {
  readonly id = "fake-connector-a";
  readonly marketplaceId = "MARKET_A";
  readonly capabilities = {
    catalog: true,
    inventory: true,
    stock: true,
    shipping: true,
    seller: true,
    variants: true,
    gtin: true,
    incrementalUpdates: true,
    fullSnapshot: true,
    webhook: false,
    pixPrice: true,
  };

  collect(fromCursor: string | null = null): Promise<CollectedListingBatch> {
    return Promise.resolve(
      collectFromFixtures(FAKE_LISTING_FIXTURES_V1, "MARKET_A", this.id, fromCursor),
    );
  }

  collectIncremental(fromCursor: string | null = null): Promise<CollectedListingBatch> {
    return this.collect(fromCursor);
  }

  normalize(raw: unknown): NormalizedMarketplaceListingV1 {
    const fixture = raw as FakeListingFixtureV1;
    if (!fixture?.externalListingId) {
      throw new Error("FakeConnectorA: fixture sem externalListingId");
    }
    return buildFakeListing({ ...fixture, marketplaceId: this.marketplaceId });
  }

  validate(listing: NormalizedMarketplaceListingV1): string[] {
    const codes: string[] = [];
    if (!Number.isFinite(listing.commerce.price) || listing.commerce.price <= 0) {
      codes.push("INVALID_PRICE");
    }
    return codes;
  }

  getCursor(): string | null {
    return null;
  }

  healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return Promise.resolve({ ok: true, detail: "fake-connector-a ready" });
  }
}

/** Conector fictício mínimo (capacidades distintas — prova extensibilidade). */
export class FakeMarketplaceConnectorB implements MarketplaceConnector {
  readonly id = "fake-connector-b";
  readonly marketplaceId = "MARKET_B";
  readonly capabilities = {
    catalog: true,
    inventory: true,
    stock: false,
    shipping: false,
    seller: false,
    variants: false,
    gtin: false,
    incrementalUpdates: false,
    fullSnapshot: true,
    webhook: false,
    pixPrice: false,
  };

  collect(fromCursor: string | null = null): Promise<CollectedListingBatch> {
    const fixtures: FakeListingFixtureV1[] = [
      {
        externalListingId: "b1",
        identity: { brand: "Nova", model: "Nova X" },
        catalog: {
          title: "Smartphone Nova X 256GB - Oferta B",
          category: "Celulares",
        },
        commerce: { price: 2049.9, availability: "IN_STOCK" },
        metadata: { sourceUpdatedAt: new Date().toISOString(), payloadVersion: "raw/v1" },
      },
      {
        externalListingId: "b2",
        identity: { brand: "Som", model: "Max" },
        catalog: {
          title: "Fone Bluetooth Som Max - Oferta B",
          category: "Áudio",
        },
        commerce: { price: 259.9, availability: "IN_STOCK" },
        metadata: { sourceUpdatedAt: new Date().toISOString(), payloadVersion: "raw/v1" },
      },
    ];
    return Promise.resolve(
      collectFromFixtures(fixtures, "MARKET_B", this.id, fromCursor),
    );
  }

  normalize(raw: unknown): NormalizedMarketplaceListingV1 {
    const fixture = raw as FakeListingFixtureV1;
    if (!fixture?.externalListingId) {
      throw new Error("FakeConnectorB: fixture sem externalListingId");
    }
    const listing = buildFakeListing({
      ...fixture,
      marketplaceId: this.marketplaceId,
      seller: null,
      identity: {
        gtin: [],
        mpn: null,
        manufacturerModel: fixture.identity?.manufacturerModel ?? null,
        brand: fixture.identity?.brand ?? null,
        model: fixture.identity?.model ?? null,
      },
      variant: {},
      commerce: { ...fixture.commerce, stock: UNKNOWN, pixPrice: UNKNOWN },
    });
    return listing;
  }

  validate(listing: NormalizedMarketplaceListingV1): string[] {
    const codes: string[] = [];
    if (!Number.isFinite(listing.commerce.price) || listing.commerce.price <= 0) {
      codes.push("INVALID_PRICE");
    }
    return codes;
  }

  getCursor(): string | null {
    return null;
  }

  healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    return Promise.resolve({ ok: true, detail: "fake-connector-b ready" });
  }
}