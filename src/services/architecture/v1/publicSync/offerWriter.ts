/**
 * CATALOG_ARCHITECTURE_V1 — WRITER DE OFERTA PÚBLICA (FASE 9.10 a 9.13).
 *
 * Recebe drafts JA aceitos pela identidade (EXACT_UNIQUE, sem hard conflict)
 * e grava a oferta pelo caminho canonico de banco. Tres responsabilidades:
 *
 *   1. SELECAO DETERMINISTICA quando varias listings do mesmo marketplace
 *      sao aceitas para o mesmo Product. O schema atual admite 1 oferta por
 *      (productId, marketplace), entao escolher e obrigatorio. Criterio:
 *      menor preco valido; empate resolvido por externalId em ordem
 *      lexicografica. A ordem da API NUNCA decide.
 *
 *   2. UPSERT IDEMPOTENTE em `@@unique([productId, marketplace])`, respeitando
 *      tambem `@@unique([marketplace, externalId])`. Se o externalId ja
 *      pertence a OUTRO Product, o writer NAO move a oferta entre produtos:
 *      falha fechada e reporta.
 *
 *   3. PUBLICATION GATE pelo caminho CENTRAL ja certificado
 *      (`sincronizarMelhorOfertaDoProduto`). Este writer nunca escreve
 *      `Product.active` diretamente - a policy decide `active`,
 *      `publicationStatus` e `isBest`.
 *
 * ATTACH-ONLY (FASE 9.4): este modulo nunca cria Product. O `productId` veio do
 * indice de CandidateBlockingKey e o writer so o referencia.
 */

import type { PrismaClient } from "@prisma/client";
import { resolveLegacyEnumValue } from "../marketplaceRegistry";
import { sincronizarMelhorOfertaDoProduto } from "../../../database/saveProduct";
import { toCanonicalMarketplaceId } from "../publication/shadowWeight";
import type {
  OfferCommitResultV1,
  PublicOfferCommitter,
  PublicOfferDraftV1,
} from "./types";

/* ------------------------------------------------------------------ */
/* 1. SELECAO DETERMINISTICA                                            */
/* ------------------------------------------------------------------ */

/** true quando o draft tem preco publicavel. */
function hasValidPrice(draft: PublicOfferDraftV1): boolean {
  return Number.isFinite(draft.price) && draft.price > 0;
}

/**
 * Escolhe a oferta vencedora entre drafts do MESMO (productId, marketplace).
 *
 * Deterministico e independente da ordem de chegada:
 *   1o menor preco valido
 *   2o empate -> externalId lexicograficamente menor
 *
 * Devolve null quando nenhum draft tem preco valido - nesse caso nada e
 * gravado, porque uma oferta sem preco nao e oferta.
 */
export function selectWinningOffer(
  drafts: readonly PublicOfferDraftV1[],
): PublicOfferDraftV1 | null {
  const valid = drafts.filter(hasValidPrice);
  if (valid.length === 0) return null;

  let best = valid[0];
  for (const candidate of valid.slice(1)) {
    if (candidate.price < best.price) {
      best = candidate;
    } else if (candidate.price === best.price) {
      // Empate: desempate deterministico pelo externalId.
      if (candidate.externalId < best.externalId) best = candidate;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* 2. WRITER REAL                                                      */
/* ------------------------------------------------------------------ */

/** Campos observaveis que a oferta publica carrega. */
const OBSERVABLE_FIELDS = [
  "title",
  "seller",
  "image",
  "price",
  "sourceUrl",
  "affiliateLink",
  "available",
  "status",
  "active",
] as const;

export type CommitContext = { dryRun: boolean };

/**
 * Constroi o `data` de escrita a partir de um draft aceito.
 * `status` reflete a disponibilidade de link de afiliado (FASE 9.7):
 *   - com link seguro  -> ACTIVE (compravel)
 *   - sem link seguro  -> PENDING_AFFILIATE (existe e compara preco, mas nao
 *                        e apresentada como compravel; nenhum link e inventado)
 */
function buildOfferData(draft: PublicOfferDraftV1) {
  const hasAffiliate = Boolean(draft.affiliateLink?.trim());
  return {
    externalId: draft.externalId,
    title: draft.title,
    seller: draft.seller,
    image: draft.image,
    price: draft.price,
    sourceUrl: draft.sourceUrl,
    affiliateLink: draft.affiliateLink,
    available: draft.available,
    active: true,
    matchStatus: draft.matchStatus,
    discoverySource: draft.discoverySource,
    status: hasAffiliate ? ("ACTIVE" as const) : ("PENDING_AFFILIATE" as const),
    isBest: false,
  };
}

/** Campos cujo valor difere entre o estado persistido e o draft. */
function diffFields(
  existing: Record<string, unknown>,
  data: Record<string, unknown>,
): string[] {
  const changed: string[] = [];
  for (const field of OBSERVABLE_FIELDS) {
    const before = existing[field];
    const after = data[field];
    if (field === "price" || field === "available" || field === "active") {
      if (before !== after) changed.push(field);
      continue;
    }
    const b = before === null || before === undefined ? null : String(before);
    const a = after === null || after === undefined ? null : String(after);
    if (b !== a) changed.push(field);
  }
  return changed;
}

/**
 * Cria o committer real, ligado a um cliente Prisma.
 * Isolado em uma factory para que o runner e os testes compartilhem a MESMA
 * implementacao, sem que o teste precise de banco.
 */
export function createPrismaPublicOfferCommitter(
  prisma: PrismaClient,
): PublicOfferCommitter {
  return {
    async commit(
      draft: PublicOfferDraftV1,
      context: CommitContext,
    ): Promise<OfferCommitResultV1> {
      const legacyEnum = resolveLegacyEnumValue(draft.marketplaceId);
      if (legacyEnum === null) {
        throw new Error(`MARKETPLACE_NOT_IN_REGISTRY: ${draft.marketplaceId}`);
      }
      if (!hasValidPrice(draft)) {
        throw new Error(`INVALID_PRICE: ${draft.externalId}`);
      }

      const existing = await prisma.marketplaceOffer.findUnique({
        where: {
          productId_marketplace: {
            productId: draft.productId,
            marketplace: legacyEnum as never,
          },
        },
      });

      // `@@unique([marketplace, externalId])`: se a listing ja pertence a
      // OUTRO Product, nao movemos. Fail-closed.
      if (existing === null) {
        const byExternal = await prisma.marketplaceOffer.findFirst({
          where: {
            marketplace: legacyEnum as never,
            externalId: draft.externalId,
          },
          select: { productId: true },
        });
        if (byExternal !== null && byExternal.productId !== draft.productId) {
          throw new Error(
            `EXTERNAL_ID_BELONGS_TO_OTHER_PRODUCT: ${draft.externalId}`,
          );
        }
      }

      const data = buildOfferData(draft);

      if (existing === null) {
        if (context.dryRun) {
          return {
            productId: draft.productId,
            marketplaceId: draft.marketplaceId,
            externalId: draft.externalId,
            action: "CREATE",
            changed: true,
            publicationSynced: false,
            changedFields: [...OBSERVABLE_FIELDS],
          };
        }
        await prisma.$transaction(async (tx) => {
          await tx.marketplaceOffer.create({
            data: {
              productId: draft.productId,
              marketplace: legacyEnum as never,
              ...data,
            },
          });
          // Publication gate CENTRAL. Nunca escrevo Product.active aqui.
          await sincronizarMelhorOfertaDoProduto(tx, draft.productId);
        });
        return {
          productId: draft.productId,
          marketplaceId: draft.marketplaceId,
          externalId: draft.externalId,
          action: "CREATE",
          changed: true,
          publicationSynced: true,
          changedFields: [...OBSERVABLE_FIELDS],
        };
      }

      const changedFields = diffFields(
        existing as unknown as Record<string, unknown>,
        data as unknown as Record<string, unknown>,
      );

      if (changedFields.length === 0) {
        return {
          productId: draft.productId,
          marketplaceId: draft.marketplaceId,
          externalId: draft.externalId,
          action: "NOOP",
          changed: false,
          publicationSynced: false,
          changedFields: [],
        };
      }

      if (context.dryRun) {
        return {
          productId: draft.productId,
          marketplaceId: draft.marketplaceId,
          externalId: draft.externalId,
          action: "UPDATE",
          changed: true,
          publicationSynced: false,
          changedFields,
        };
      }

      await prisma.$transaction(async (tx) => {
        await tx.marketplaceOffer.update({
          where: { id: existing.id },
          data: data as never,
        });
        await sincronizarMelhorOfertaDoProduto(tx, draft.productId);
      });

      return {
        productId: draft.productId,
        marketplaceId: draft.marketplaceId,
        externalId: draft.externalId,
        action: "UPDATE",
        changed: true,
        publicationSynced: true,
        changedFields,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* 3. AUDITORIA DE PERSISTIDO (FASE 9.19 / 9.37)                        */
/* ------------------------------------------------------------------ */

/** Uma oferta ja persistida, como a auditoria a enxerga. */
export interface PersistedOfferAuditInput {
  productId: string;
  /** enum do banco, ex.: "SHOPEE". */
  marketplace: string;
  externalId: string | null;
  price: number;
  matchStatus: string | null;
  status: string | null;
  active: boolean;
  available: boolean;
  hasAffiliateLink: boolean;
  hardConflicts: number;
}

export interface PersistedOfferAuditRow {
  productId: string;
  marketplaceId: string;
  externalId: string | null;
  price: number;
  matchStatus: string | null;
  status: string | null;
  hasAffiliateLink: boolean;
  hardConflicts: number;
  /** A oferta seria servida na superficie publica? */
  publiclyServed: boolean;
  /** A oferta alimenta a contagem de marketplace publico (peso 1)? */
  countsTowardPublicMarketplace: boolean;
}

export interface PersistedOfferAudit {
  TOTAL: number;
  /** Ofertas servidas publicamente cujo matchStatus NAO e EXACT. */
  REVIEW_PUBLIC_OFFERS: number;
  REJECT_PUBLIC_OFFERS: number;
  /** Ofertas servidas publicamente com hard conflict. */
  HARD_CONFLICT_PUBLIC_OFFERS: number;
  AMBIGUOUS_PUBLIC_OFFERS: number;
  /** Ofertas publicas do marketplace SEM link de afiliado seguro. */
  PUBLIC_WITHOUT_AFFILIATE_LINK: number;
  DUPLICATE_EXTERNAL_IDS: number;
  ROWS: PersistedOfferAuditRow[];
}

/**
 * Predicado "esta oferta seria servida na superficie publica".
 * Deliberadamente declarado AQUI e nao herdado de `isUsablePublicOffer`:
 * a auditoria precisa ser capaz de CONTRADIR a regra, senao um bug na regra
 * se auto-aprovar. Por isso o predicado e o inverso explicito: servido =
 * ativo E disponivel E preco>0 (o filtro de peso e aplicado a parte, na
 * coluna `countsTowardPublicMarketplace`).
 */
function wouldBePubliclyServed(row: PersistedOfferAuditInput): boolean {
  return (
    row.active === true &&
    row.available === true &&
    row.status !== "UNAVAILABLE" &&
    row.status !== "ERROR" &&
    Number.isFinite(row.price) &&
    row.price > 0
  );
}

/**
 * Audita ofertas ja persistidas de um marketplace. Nao escreve.
 *
 * Os contadores de seguranca medem o que a superficie SERVE, e nao o que a
 * regra deveria servir. `REVIEW_PUBLIC_OFFERS` e `REJECT_PUBLIC_OFFERS` sao
 * medidos diretamente do `matchStatus` persistido, para que um matchStatus
 * errado apareca como vazao e nao como conformidade.
 */
export function auditPersistedPublicOffers(
  rows: readonly PersistedOfferAuditInput[],
): PersistedOfferAudit {
  const auditRows: PersistedOfferAuditRow[] = [];
  const seenExternal = new Map<string, number>();
  let duplicateExternalIds = 0;
  let reviewPublic = 0;
  let rejectPublic = 0;
  let hardConflictPublic = 0;
  let publicWithoutAffiliateLink = 0;

  for (const row of rows) {
    // Normalizacao pura de id. NAO usar `toPublicOfferMarketplaceIds`: ele
    // aplica o filtro de shadow e ESCONDERIA justamente as ofertas que a
    // auditoria precisa inspecionar enquanto a fonte ainda e shadow.
    const marketplaceId = toCanonicalMarketplaceId(row.marketplace);
    const served = wouldBePubliclyServed(row);

    if (row.externalId) {
      const key = `${marketplaceId} ${row.externalId}`;
      const seen = seenExternal.get(key) ?? 0;
      seenExternal.set(key, seen + 1);
      if (seen > 0) duplicateExternalIds += 1;
    }

    const matchStatus = row.matchStatus;
    if (served) {
      if (matchStatus === "REVIEW" || matchStatus === "HIGH") {
        reviewPublic += 1;
      }
      if (matchStatus === "REJECTED") {
        rejectPublic += 1;
      }
      if (row.hardConflicts > 0) {
        hardConflictPublic += 1;
      }
      if (!row.hasAffiliateLink) {
        publicWithoutAffiliateLink += 1;
      }
    }

    auditRows.push({
      productId: row.productId,
      marketplaceId,
      externalId: row.externalId,
      price: row.price,
      matchStatus,
      status: row.status,
      hasAffiliateLink: row.hasAffiliateLink,
      hardConflicts: row.hardConflicts,
      publiclyServed: served,
      countsTowardPublicMarketplace:
        served && matchStatus === "EXACT" && row.hardConflicts === 0,
    });
  }

  return {
    TOTAL: rows.length,
    REVIEW_PUBLIC_OFFERS: reviewPublic,
    REJECT_PUBLIC_OFFERS: rejectPublic,
    HARD_CONFLICT_PUBLIC_OFFERS: hardConflictPublic,
    AMBIGUOUS_PUBLIC_OFFERS: 0,
    PUBLIC_WITHOUT_AFFILIATE_LINK: publicWithoutAffiliateLink,
    DUPLICATE_EXTERNAL_IDS: duplicateExternalIds,
    ROWS: auditRows,
  };
}
