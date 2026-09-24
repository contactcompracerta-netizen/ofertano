/**
 * CATALOG_ARCHITECTURE_V1 — REAL AUTHORITATIVE COMMITS (FASE D).
 *
 * Commits reais do writer V1 autoritativo, injetáveis no runner:
 *
 *   commitV1Structural — commit STRUCTURAL canônico: reutiliza o saveProduct
 *     (mesma semântica do fluxo legado), com autoCreated + discoverySource
 *     OPPORTUNITY e o gate de publicação multiloja EXATO do fluxo real
 *     (PUBLIC_MULTISTORE_MIN_MARKETPLACES). Paridade garantida com o legado
 *     porque É o mesmo caminho canônico.
 *
 *   commitV1FastOffer  — fast path OFFER_ONLY: atualiza a oferta existente
 *     (preço/estoque/disponibilidade) sem heavy matching de identidade;
 *     feeda PriceHistory somente quando o preço muda de verdade (FASE R).
 *
 *   legacyWrite        — fallback controlado: assume quando o V1 falhou
 *     ANTES do commit com erro fallback-eligible. Nunca é chamado após
 *     commit V1 (single-write ownership).
 *
 * Commit point: `saveProduct` roda seu próprio prisma.$transaction
 * (linha 2513 do saveProduct.ts) — sucesso aqui = catálogo commitado.
 */

import type { PrismaClient, Marketplace } from "@prisma/client";

import type { ProductImport } from "@/services/importers/core/types";
import { saveProduct } from "@/services/database/saveProduct";
import { historicoPrecisaNovaEntrada } from "@/services/priceHistory/priceHistoryService";

import { resolveDisplayName, resolveLegacyEnumValue } from "../marketplaceRegistry";
import type { V1WriteContext } from "./writer";

export interface RealAuthoritativeCommits {
  commitV1Structural: (ctx: V1WriteContext) => Promise<{ productId: string | null }>;
  commitV1FastOffer: (ctx: V1WriteContext) => Promise<{ productId: string | null }>;
  legacyWrite: (ctx: V1WriteContext) => Promise<{ productId: string | null }>;
}

/** Monta o ProductImport canônico a partir da listing V1 (marketplace agnóstico). */
export function buildProductImportFromV1Context(
  ctx: V1WriteContext,
): ProductImport {
  const { listing } = ctx;

  const images = listing.catalog.images.filter(Boolean);
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(listing.catalog.attributes ?? {})) {
    if (typeof value === "string") {
      attributes[key] = value;
    }
  }

  const title =
    typeof listing.catalog.title === "string"
      ? listing.catalog.title
      : "";
  const url =
    typeof ctx.row.sourceUrl === "string" && ctx.row.sourceUrl.trim()
      ? ctx.row.sourceUrl.trim()
      : "";

  return {
    marketplace: resolveDisplayName(listing.marketplaceId) as ProductImport["marketplace"],
    externalId: listing.externalListingId,
    url,
    title,
    description: null,
    brand:
      typeof listing.identity.brand === "string" ? listing.identity.brand : null,
    category:
      typeof listing.catalog.category === "string"
        ? listing.catalog.category
        : null,
    image: images[0] ?? "",
    images,
    price: listing.commerce.price,
    oldPrice:
      typeof listing.commerce.oldPrice === "number"
        ? listing.commerce.oldPrice
        : null,
    discount: null,
    installments: null,
    rating: null,
    reviews: null,
    sales: null,
    stock:
      typeof listing.commerce.stock === "number"
        ? listing.commerce.stock
        : null,
    seller:
      typeof listing.seller.name === "string" ? listing.seller.name : null,
    attributes,
  };
}

export function createRealAuthoritativeCommits(
  prisma: PrismaClient,
): RealAuthoritativeCommits {
  return {
    async commitV1Structural(ctx) {
      const product = buildProductImportFromV1Context(ctx);
      const saved = await saveProduct(product, null, {
        autoCreated: true,
        discoverySource: "OPPORTUNITY",
        // Gate EXATO do fluxo real: para autoCreated, a ativação exige
        // hasPublicMultiStore (>=2 marketplaces públicos) — guarda CENTRAL
        // dentro do saveProduct (permitirAtivacaoProdutoAutoCriado).
        // 1 marketplace => produto permanece DRAFT/inativo (AUTO_ACTIVE_LT2=0).
      });
      return { productId: saved.id };
    },

    async commitV1FastOffer(ctx) {
      const marketplaceEnum = resolveLegacyEnumValue(ctx.marketplaceId);
      if (!marketplaceEnum) {
        throw new Error(
          `MULTISTORE_NOT_READY:marketplace-sem-evento-legado:${ctx.marketplaceId}`,
        );
      }
      const marketplace = marketplaceEnum as Marketplace;

      const offer = await prisma.marketplaceOffer.findUnique({
        where: {
          marketplace_externalId: {
            marketplace,
            externalId: ctx.externalListingId,
          },
        },
        include: {
          priceHistory: {
            orderBy: { recordedAt: "desc" },
            take: 1,
          },
        },
      });

      if (!offer) {
        // Fast path exige oferta existente; sem oferta a estrutura mudou =>
        // o writer deve ter decidido STRUCTURAL. Fail-closed.
        throw new Error(
          `INVALID_DATA:fast-offer-sem-oferta-existente:${ctx.externalListingId}`,
        );
      }

      const price = ctx.listing.commerce.price;
      const oldPrice =
        typeof ctx.listing.commerce.oldPrice === "number"
          ? ctx.listing.commerce.oldPrice
          : null;
      const stock =
        typeof ctx.listing.commerce.stock === "number"
          ? ctx.listing.commerce.stock
          : null;
      const available =
        ctx.listing.commerce.availability === "IN_STOCK" ||
        ctx.listing.commerce.availability === "PRE_ORDER";

      const updated = await prisma.marketplaceOffer.update({
        where: { id: offer.id },
        data: {
          price,
          oldPrice:
            typeof oldPrice === "number" && oldPrice !== price ? oldPrice : null,
          stock,
          available,
          status: available ? "ACTIVE" : "UNAVAILABLE",
          lastCheckedAt: new Date(),
          lastPriceChangeAt: price !== offer.price ? new Date() : undefined,
        },
      });

      // FASE R: preço igual => sem PriceHistory; mudança real => 1 entrada.
      const ultimoHistorico = offer.priceHistory[0]?.price ?? null;
      if (historicoPrecisaNovaEntrada({
        precoAnterior: ultimoHistorico,
        precoNovo: price,
      })) {
        await prisma.priceHistory.create({
          data: {
            productId: updated.productId,
            offerId: updated.id,
            marketplace,
            price,
            oldPrice: typeof oldPrice === "number" ? oldPrice : null,
            source: "OPPORTUNITY",
          },
        });
      }

      return { productId: updated.productId };
    },

    async legacyWrite(ctx) {
      // Fallback controlado: o legado assume com o MESMO saveProduct
      // canônico (paridade). Só é alcançado em falha V1 pré-commit
      // fallback-eligible (DB_TRANSIENT / INTERNAL / UNEXPECTED).
      const product = buildProductImportFromV1Context(ctx);
      const saved = await saveProduct(product, null, {
        autoCreated: true,
        discoverySource: "OPPORTUNITY",
      });
      return { productId: saved.id };
    },
  };
}