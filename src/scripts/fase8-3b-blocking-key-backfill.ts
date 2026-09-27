/*
 * ============================================================================
 * FASE 8.3B — BACKFILL DE CANDIDATE BLOCKING KEYS (ESTADO ATUAL)
 * ============================================================================
 * CORREÇÃO DOCUMENTAL (FASE P, 2026-09-27): o cabeçalho anterior deste arquivo
 * afirmava que a migration `20260926220000_candidate_blocking_keys` "foi
 * APLICADA e VALIDADA no banco real — e depois REMOVIDA deste repositório",
 * e que a tabela "NÃO é recreate aqui". Isso era VERDADEIRO na época em que
 * foi escrito e hoje é FALSO. Estado factual verificado nesta data:
 *
 *   - a migration EXISTE em disco: prisma/migrations/20260926220000_candidate_blocking_keys/
 *   - ela está no manifesto do bootstrap (scripts/bootstrap/manifest.json) e
 *     no pin forense (scripts/migration-history/forensic-pins.json);
 *   - ela está na allowlist do ledger (verify-ledger-compatibility.mjs →
 *     `blockingKeyMigration`) e no ledger real de produção;
 *   - em PRODUÇÃO ela está APLICADA e NÃO revertida
 *     (`_prisma_migrations.finished_at` preenchido, `rolled_back_at` nulo);
 *   - a tabela existe em produção com 428 chaves para 22 produtos, os 5
 *     índices declarados presentes, e `model CandidateBlockingKey` está em
 *     prisma/schema.prisma.
 *
 * Portanto o bloqueio NÃO é "a migration está ausente". O backfill continua
 * bloqueado por PROCESSO E GATES — decisão explícita de execução, não uma
 * limitação técnica do schema:
 *
 *   1. o dry-run (`--apply` ausente; ver `dryRun = !hasFlag("apply")` abaixo)
 *      precisa ser revisado e aprovado por uma pessoa;
 *   2. a execução é uma escrita real em produção e exige missão própria.
 *
 * NADA aqui foi reabilitado: a única mudança nesta commit é o texto. O
 * comportamento de execução, o default dry-run, o teto `--limit` e as
 * garantias de idempotência permanecem idênticos.
 * ============================================================================
 */
/**
 * FASE 8.3B — BACKILL SEGURO DE CANDIDATE BLOCKING KEYS.
 *
 * Materializa as chaves de bloqueio de cada Product do catálogo na tabela
 * CandidateBlockingKey.
 *
 * REGRAS QUE ESTE SCRIPT RESPETA (FASE N):
 *
 *  1. IDEMPOTENTE — a chave tem unique (productId, keyType, normalizedValue,
 *     policyVersion). Reexecutar não duplica nem altera nada.
 *  2. VERSIONADO — cada chave guarda a policyVersion que a produziu, para
 *     que um reprocessamento saiba qual regra gerou o match anterior.
 *  3. PROVENANCE-AWARE — STRUCTURED_FIELD / TITLE_EXTRACTED / CANONICAL_DERIVED
 *     ficam gravados. Uma TITLE_EXTRACTED nunca vira STRONG.
 *  4. SEM RESPOSTA PRONTA — as chaves saem dos DADOS CANÔNICOS de cada
 *     produto (name/brand/modelNumber/gtin/ean/mpn das próprias SourceListing
 *     e RawMarketplaceListing). A ASSOCIAÇÃO LEGACY nunca é lida: ela diz
 *     qual listing corresponde a qual produto, e usar isso seria usar a
 *     resposta. O Product é o DONO da chave; quem corresponde a quem continua
 *     sendo decidido pela IdentityPolicy.
 *
 * CANÁRIO: --dry-run (default) -> --limit=1 -> 10 -> 100 -> tudo.
 * Nenhuma escrita em dry-run.
 */

import prisma from "../lib/prisma";
import {
  buildBlockingKeys,
  canonicalModel,
  CANDIDATE_BLOCKING_KEY_V1,
  type BlockingKeyType,
  type KeyProvenance,
} from "../services/architecture/v1/identity/candidateGeneration";
import { IDENTITY_POLICY_V1 } from "../services/architecture/v1/identity/identityPolicy";
import {
  NORMALIZED_LISTING_V1,
  UNKNOWN,
  type NormalizedMarketplaceListingV1,
} from "../services/architecture/v1/types/normalizedListingV1";
import { resolveMarketplaceIdFromLegacyEnum } from "../services/architecture/v1/marketplaceRegistry";
import { computeRawHash } from "../services/architecture/v1/hashing";

function arg(name: string, fallback = ""): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const hasFlag = (n: string) => process.argv.includes(`--${n}`);

type SrcRow = {
  productId: string;
  name: string;
  brand: string | null;
  category: string | null;
  modelNumber: string | null;
  ean: string | null;
  gtin: string | null;
  mpn: string | null;
  title: string | null;
  attributes: Record<string, string> | null;
  marketplace: string | null;
};

async function main() {
  const dryRun = !hasFlag("apply");
  const limitRaw = Number.parseInt(arg("limit", "0"), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 500;

  const out: Record<string, unknown> = {
    MODE: dryRun ? "DRY_RUN" : "APPLY",
    BLOCKING_KEY_VERSION: CANDIDATE_BLOCKING_KEY_V1,
    IDENTITY_POLICY_VERSION: IDENTITY_POLICY_V1,
    LIMIT: limit,
    USES_LEGACY_ASSOCIATION: false,
    USES_OFFER_PRODUCTID_AS_CROSS_MARKET_EVIDENCE: false,
  };

  /*
   * Fonte das chaves: dados CANÔNICOS do produto + suas próprias
   * RawMarketplaceListing, ligadas por `canonicalProductId` (o vínculo
   * canônico produto<->listing, gravado na ingestão).
   *
   * `MarketplaceOffer` NÃO é consultado: ela é justamente a tabela que guarda
   * a associação cross-market a VALIDAR. Usá-la seria usar a resposta.
   */
  /*
   * LIMIT entra por interpolacao, mas so depois de validado como inteiro
   * positivo. Nao e dado externo: e um parametro de operador, e um inteiro
   * nunca altera o significado da query.
   */
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 500;
  const rows = await prisma.$queryRaw<SrcRow[]>`
    SELECT p.id::text AS "productId",
           p.name AS name,
           p.brand AS brand,
           p.category AS category,
           p."modelNumber" AS "modelNumber",
           p.ean AS ean, p.gtin AS gtin, p.mpn AS mpn,
           r.title AS title,
           r.attributes AS attributes,
           r.marketplace::text AS marketplace
      FROM "Product" p
      LEFT JOIN "RawMarketplaceListing" r
             ON r."canonicalProductId" = p.id
     ORDER BY p.name
     LIMIT ${safeLimit}`;
  out.SOURCE_ROWS = rows.length;

  // Léxico de marcas derivado do próprio catálogo.
  const brandLexicon = new Set<string>();
  for (const r of rows) if (r.brand) brandLexicon.add(canonicalModel(r.brand));
  out.BRAND_LEXICON_SIZE = brandLexicon.size;

  type KeyRow = {
    productId: string;
    keyType: BlockingKeyType;
    normalizedValue: string;
    category: string;
    strength: "STRONG" | "MEDIUM";
    provenance: KeyProvenance;
    policyVersion: string;
    sourceMarketplace: string | null;
  };

  const allKeys: KeyRow[] = [];
  for (const r of rows) {
    // Listing canônica do produto, montada a partir dos SEUS dados.
    const gtin = [r.ean, r.gtin]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v.length > 0);
    const mid = r.marketplace
      ? resolveMarketplaceIdFromLegacyEnum(r.marketplace) ?? r.marketplace.toLowerCase()
      : null;
    const listing: NormalizedMarketplaceListingV1 = {
      contractVersion: NORMALIZED_LISTING_V1,
      source: "backfill-canonical",
      marketplaceId: mid ?? "unknown",
      externalListingId: `${r.productId}:${r.marketplace ?? "none"}`,
      seller: { externalSellerId: null, name: null },
      identity: {
        gtin,
        mpn: r.mpn ?? null,
        manufacturerModel: r.modelNumber ?? null,
        brand: r.brand ?? null,
        model: r.modelNumber ?? null,
      },
      catalog: {
        title: r.title ?? r.name,
        description: null,
        category: r.category ?? null,
        images: [],
        attributes: r.attributes ?? {},
        primaryImageUrl: null,
      },
      variant: { color: UNKNOWN, storage: UNKNOWN, memory: UNKNOWN, voltage: UNKNOWN, size: UNKNOWN, otherAttributes: {} },
      commerce: { price: 1, oldPrice: null, pixPrice: UNKNOWN, installments: UNKNOWN, stock: UNKNOWN, availability: "IN_STOCK", shippingHint: UNKNOWN, promotion: null },
      metadata: { sourceUpdatedAt: null, collectedAt: new Date().toISOString(), rawHash: computeRawHash({ p: r.productId }), payloadVersion: "backfill/v1" },
    };

    for (const key of buildBlockingKeys(listing, { brandLexicon })) {
      // REGRA: chave derivada nunca é STRONG, mesmo que o extrator diga.
      const strength = key.strength === "STRONG" && key.provenance === "STRUCTURED_FIELD"
        ? "STRONG"
        : "MEDIUM";
      allKeys.push({
        productId: r.productId,
        keyType: key.type,
        normalizedValue: key.normalizedValue,
        category: key.category ?? "",
        strength,
        provenance: key.provenance,
        policyVersion: CANDIDATE_BLOCKING_KEY_V1,
        sourceMarketplace: mid,
      });
    }
  }

  // Deduplica por (productId, keyType, value) — o resto é reexecução.
  const seen = new Set<string>();
  const unique: KeyRow[] = [];
  for (const k of allKeys) {
    const id = `${k.productId}|${k.keyType}|${k.normalizedValue}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(k);
  }
  out.KEYS_DERIVED = allKeys.length;
  out.KEYS_UNIQUE = unique.length;
  out.KEYS_BY_TYPE = unique.reduce<Record<string, number>>((acc, k) => {
    acc[k.keyType] = (acc[k.keyType] ?? 0) + 1;
    return acc;
  }, {});
  out.KEYS_BY_PROVENANCE = unique.reduce<Record<string, number>>((acc, k) => {
    acc[k.provenance] = (acc[k.provenance] ?? 0) + 1;
    return acc;
  }, {});
  out.KEYS_BY_STRENGTH = unique.reduce<Record<string, number>>((acc, k) => {
    acc[k.strength] = (acc[k.strength] ?? 0) + 1;
    return acc;
  }, {});
  out.DERIVED_KEYS_MARKED_STRONG = unique.filter(
    (k) => k.strength === "STRONG" && k.provenance !== "STRUCTURED_FIELD",
  ).length;

  if (dryRun) {
    out.WRITES = 0;
    out.NOTE = "dry-run: nada foi gravado. Use --apply para gravar.";
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  /* APPLY idempotente: upsert por chave natural. */
  let written = 0;
  for (const k of unique) {
    await prisma.candidateBlockingKey.upsert({
      where: {
        productId_keyType_normalizedValue_policyVersion: {
          productId: k.productId,
          keyType: k.keyType as never,
          normalizedValue: k.normalizedValue,
          policyVersion: k.policyVersion,
        },
      },
      create: {
        productId: k.productId,
        keyType: k.keyType as never,
        normalizedValue: k.normalizedValue,
        category: k.category,
        strength: k.strength as never,
        provenance: k.provenance as never,
        policyVersion: k.policyVersion,
        sourceMarketplace: k.sourceMarketplace,
      },
      update: {
        category: k.category,
        strength: k.strength as never,
        provenance: k.provenance as never,
        sourceMarketplace: k.sourceMarketplace,
      },
    });
    written += 1;
  }
  out.WRITES = written;
  out.TOTAL_IN_TABLE = await prisma.candidateBlockingKey.count();
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch((e) => {
    console.error("BACKFILL_FAILED", e instanceof Error ? e.message.slice(0, 300) : "UNKNOWN");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
