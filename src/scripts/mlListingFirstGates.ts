/**
 * LISTING-FIRST GATES — SOMENTE LEITURA.
 *
 * CATALOG PRODUCT != MARKETPLACE OFFER
 *
 * Verifica, sobre as ofertas REAIS de MERCADO_LIVRE, que nenhuma oferta NOVA
 * nasceu de um produto de catálogo.
 *
 * DIVISÃO DE COMPETÊNCIA (legado x novo)
 * --------------------------------------
 * Os gates contam APENAS ofertas criadas a partir de `ML_LISTING_FIRST_CUTOFF`.
 * As ofertas anteriores são LEGADO por decisão explícita: elas não são
 * apagadas nem reescritas (o dado de `externalId` é a única prova histórica de
 * qual anúncio foi escolhido na época), e sim CLASSIFICADAS e impedidas de
 * virar CTA — o que é medido por `ML_PUBLIC_CATALOG_OFFER_EXPOSED`.
 *
 * Por que a contagem é pós-corte, e não sobre todas as linhas:
 *   - `externalId` de uma oferta legada é HISTÓRICO. Corrigi-lo exigiria
 *     escolher outro anúncio (o que troca vendedor e preço por adivinhação) ou
 *     zerá-lo (o que destrói o vínculo). Ambos violam a instrução de preservar
 *     o legado; portanto o invariante de escrita é "nenhuma oferta nova
 *     violate", e o de exposição é "nenhuma oferta de catálogo é publicada".
 *
 * GATES (contagem pós-corte, todas devem ser 0)
 * ---------------------------------------------
 *   ML_OFFER_EXTERNAL_ID_IS_CATALOG_ID  — `externalId` nunca é o
 *     catalog_product_id. Catálogo e anúncio têm a MESMA forma (`MLB` +
 *     dígitos), então a prova é a coincidência com o `catalogProductId`
 *     gravado e/ou com o `/p/` da sourceUrl — nunca a contagem de dígitos.
 *   ML_OFFER_WITHOUT_LISTING_ITEM_ID   — `externalId` é ITEM_ID de anúncio
 *     (MLB + 8+ dígitos); MLBU, URL crua, texto e vazio reprovam.
 *   ML_PUBLIC_SOURCE_URL_IS_CATALOG     — `sourceUrl` nunca é rota de catálogo
 *     (`/p/`, `/up/`) em oferta recém-criada.
 *   ML_NEW_CATALOG_ONLY_OFFER           — nenhuma oferta classificada
 *     `LEGACY_CATALOG_ONLY` criada depois do corte.
 *
 * GATE DE EXPOSIÇÃO (todas as linhas, deve ser 0)
 * ----------------------------------------------
 *   ML_PUBLIC_CATALOG_OFFER_EXPOSED     — nenhuma oferta de catálogo é
 *     publicável pelo caminho público real, medido com o MESMO predicado que
 *     a Home/ofertas/categorias/recomendados/favoritos usam
 *     (`isUsablePublicOffer`).
 *
 * INVARIANTE DE PRESERVAÇÃO
 * -------------------------
 *   LEGACY_ROWS_PRESERVED = contagem do legado (nenhuma linha apagada/zerada
 *   por este trabalho). É conferência, não gate de escrita.
 *
 * Zero escritas no banco. Zero rede.
 */

import prisma from "@/lib/prisma";
import {
  classifyLegacyMercadoLivreOffer,
  isMercadoLivreCatalogSourceUrl,
  isPublicavelMercadoLivreOffer,
  normalizeMercadoLivreListingItemId,
  type MercadoLivreLegacyClassification,
} from "@/services/mercadoLivre/listingIdentity";
import { isUsablePublicOffer } from "@/services/publicVisibility/multiStoreVisibility";

/**
 * Data do corte LISTING-FIRST. Ofertas ML criadas antes dela são legado por
 * definição: existem por decisão explícita ("não apagar as antigas") e não
 * contam como `ML_NEW_CATALOG_ONLY_OFFER` nem como escrita nova.
 */
export const ML_LISTING_FIRST_CUTOFF = new Date(
  "2026-09-30T12:00:00.000Z",
);

export type MlOfferRow = {
  id: string;
  productId: string;
  externalId: string | null;
  sourceUrl: string | null;
  catalogProductId: string | null;
  active: boolean;
  available: boolean;
  matchStatus: string;
  status: string;
  price: number;
  createdAt: Date;
};

export type MlListingFirstGate =
  | "ML_OFFER_EXTERNAL_ID_IS_CATALOG_ID"
  | "ML_OFFER_WITHOUT_LISTING_ITEM_ID"
  | "ML_PUBLIC_SOURCE_URL_IS_CATALOG"
  | "ML_NEW_CATALOG_ONLY_OFFER"
  | "ML_PUBLIC_CATALOG_OFFER_EXPOSED";

export type MlOfferFinding = {
  offerId: string;
  productId: string;
  gate: MlListingFirstGate;
  reason: string;
  legacy: MercadoLivreLegacyClassification | null;
  createdAt: string;
  /** `true` quando a linha é anterior ao corte (legado preservado). */
  beforeCutoff: boolean;
};

export type MlLegacyRow = {
  offerId: string;
  productId: string;
  externalId: string | null;
  sourceUrl: string | null;
  catalogProductId: string | null;
  classification: MercadoLivreLegacyClassification;
  /** Publicável pelo caminho público real (predicado da Home). */
  expostaPublicamente: boolean;
  createdAt: string;
  beforeCutoff: boolean;
};

export type MlListingFirstGateResult = {
  gatesOk: boolean;
  scanned: number;
  /** Linhas anteriores ao corte (preservadas, não contadas nos gates). */
  legacyPreserved: number;
  newOffers: number;
  counters: Record<MlListingFirstGate, number>;
  /** Contadores do estado BRUTO do legado, apenas informativos. */
  legacyRawCounters: {
    externalIdIsCatalogId: number;
    catalogSourceUrl: number;
    withoutListingItemId: number;
  };
  findings: MlOfferFinding[];
  legacy: MlLegacyRow[];
  dbWrites: 0;
  reasons: string[];
};

function compact(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

/**
 * catalog_product_id presente na URL. Em `/p/MLB<id>` o id colado no caminho é
 * SEMPRE o catalog_product_id — é a definição da rota de catálogo, e vale
 * mesmo com `?wid=MLB<item>` (nesse caso o `wid` é o anúncio, não o alvo).
 */
export function extractCatalogIdFromMlUrl(rawUrl: string | null): string | null {
  if (!rawUrl) {
    return null;
  }

  const match = rawUrl.match(/\/p\/(MLB|MLBU)-?(\d{8,})/i);
  if (!match) {
    return null;
  }

  return `${match[1].toUpperCase()}${match[2]}`;
}

/**
 * Avaliação PURA dos gates. Sem I/O, para ser testável.
 */
export function evaluateMlListingFirstGates(
  offers: MlOfferRow[],
  cutoff: Date = ML_LISTING_FIRST_CUTOFF,
): {
  counters: Record<MlListingFirstGate, number>;
  legacyRawCounters: MlListingFirstGateResult["legacyRawCounters"];
  findings: MlOfferFinding[];
  legacy: MlLegacyRow[];
  legacyPreserved: number;
  newOffers: number;
} {
  const counters: Record<MlListingFirstGate, number> = {
    ML_OFFER_EXTERNAL_ID_IS_CATALOG_ID: 0,
    ML_OFFER_WITHOUT_LISTING_ITEM_ID: 0,
    ML_PUBLIC_SOURCE_URL_IS_CATALOG: 0,
    ML_NEW_CATALOG_ONLY_OFFER: 0,
    ML_PUBLIC_CATALOG_OFFER_EXPOSED: 0,
  };

  const legacyRawCounters = {
    externalIdIsCatalogId: 0,
    catalogSourceUrl: 0,
    withoutListingItemId: 0,
  };

  const findings: MlOfferFinding[] = [];
  const legacy: MlLegacyRow[] = [];
  let legacyPreserved = 0;
  let newOffers = 0;

  for (const offer of offers) {
    const createdAt = offer.createdAt.toISOString();
    const beforeCutoff = offer.createdAt < cutoff;
    const isNew = !beforeCutoff;

    if (beforeCutoff) {
      legacyPreserved += 1;
    } else {
      newOffers += 1;
    }

    const classification = classifyLegacyMercadoLivreOffer({
      externalId: offer.externalId,
      sourceUrl: offer.sourceUrl,
      catalogProductId: offer.catalogProductId,
    });

    legacy.push({
      offerId: offer.id,
      productId: offer.productId,
      externalId: offer.externalId,
      sourceUrl: offer.sourceUrl,
      catalogProductId: offer.catalogProductId,
      classification,
      expostaPublicamente: isUsablePublicOffer({
        marketplace: "MERCADO_LIVRE",
        active: offer.active,
        available: offer.available,
        status: offer.status,
        matchStatus: offer.matchStatus,
        price: offer.price,
        externalId: offer.externalId,
        sourceUrl: offer.sourceUrl,
      }),
      createdAt,
      beforeCutoff,
    });

    const knownCatalogId =
      compact(offer.catalogProductId) ||
      compact(extractCatalogIdFromMlUrl(offer.sourceUrl));
    const externalIdCompacted = compact(offer.externalId);
    const isCatalogUrl = isMercadoLivreCatalogSourceUrl(offer.sourceUrl);
    const hasValidItemId = Boolean(
      normalizeMercadoLivreListingItemId(offer.externalId),
    );

    // Contadores do estado bruto (informativos — legado não reprova gate).
    if (externalIdCompacted && knownCatalogId && externalIdCompacted === knownCatalogId) {
      legacyRawCounters.externalIdIsCatalogId += 1;
    }
    if (isCatalogUrl) {
      legacyRawCounters.catalogSourceUrl += 1;
    }
    if (!hasValidItemId) {
      legacyRawCounters.withoutListingItemId += 1;
    }

    const push = (gate: MlListingFirstGate, reason: string) => {
      findings.push({
        offerId: offer.id,
        productId: offer.productId,
        gate,
        reason,
        legacy: classification,
        createdAt,
        beforeCutoff,
      });
    };

    // Gates de escrita: contam SOMENTE ofertas novas.
    if (isNew) {
      if (externalIdCompacted && knownCatalogId && externalIdCompacted === knownCatalogId) {
        counters.ML_OFFER_EXTERNAL_ID_IS_CATALOG_ID += 1;
        push(
          "ML_OFFER_EXTERNAL_ID_IS_CATALOG_ID",
          `externalId=${offer.externalId} é igual ao catalog_product_id=${knownCatalogId}`,
        );
      }

      if (!hasValidItemId) {
        counters.ML_OFFER_WITHOUT_LISTING_ITEM_ID += 1;
        push(
          "ML_OFFER_WITHOUT_LISTING_ITEM_ID",
          `externalId=${offer.externalId ?? "(vazio)"} não é ITEM_ID de anúncio (MLB + 8+ dígitos)`,
        );
      }

      if (isCatalogUrl) {
        counters.ML_PUBLIC_SOURCE_URL_IS_CATALOG += 1;
        push(
          "ML_PUBLIC_SOURCE_URL_IS_CATALOG",
          `sourceUrl=${offer.sourceUrl} é rota de catálogo em oferta nova`,
        );
      }

      if (classification === "LEGACY_CATALOG_ONLY") {
        counters.ML_NEW_CATALOG_ONLY_OFFER += 1;
        push(
          "ML_NEW_CATALOG_ONLY_OFFER",
          `oferta catalog-only criada em ${createdAt} (>= corte ${cutoff.toISOString()})`,
        );
      }
    }

    /*
     * Gate de EXPOSIÇÃO: vale para TODAS as linhas, inclusive o legado.
     *
     * É o que implementa "as 22 antigas podem ficar no banco, mas
     * catalog-only não pode virar CTA". Medido com o predicado real do
     * caminho público, não com `active && available`: o filtro central já
     * exclui a oferta de catálogo da grade pública.
     */
    const exposta = isUsablePublicOffer({
      marketplace: "MERCADO_LIVRE",
      active: offer.active,
      available: offer.available,
      status: offer.status,
      matchStatus: offer.matchStatus,
      price: offer.price,
      externalId: offer.externalId,
      sourceUrl: offer.sourceUrl,
    });

    if (exposta && classification !== "LEGACY_LISTING_KNOWN") {
      counters.ML_PUBLIC_CATALOG_OFFER_EXPOSED += 1;
      push(
        "ML_PUBLIC_CATALOG_OFFER_EXPOSED",
        `oferta ${classification} passaria no caminho público ` +
          `(externalId=${offer.externalId ?? "(vazio)"}, sourceUrl=${offer.sourceUrl ?? "(vazio)"})`,
      );
    }
  }

  return {
    counters,
    legacyRawCounters,
    findings,
    legacy,
    legacyPreserved,
    newOffers,
  };
}

export async function runMlListingFirstGates(): Promise<MlListingFirstGateResult> {
  let offers: MlOfferRow[];

  try {
    offers = await prisma.marketplaceOffer.findMany({
      where: { marketplace: "MERCADO_LIVRE" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        productId: true,
        externalId: true,
        sourceUrl: true,
        catalogProductId: true,
        active: true,
        available: true,
        matchStatus: true,
        status: true,
        price: true,
        createdAt: true,
      },
    });
  } catch (error) {
    return {
      gatesOk: false,
      scanned: 0,
      legacyPreserved: 0,
      newOffers: 0,
      counters: {
        ML_OFFER_EXTERNAL_ID_IS_CATALOG_ID: 0,
        ML_OFFER_WITHOUT_LISTING_ITEM_ID: 0,
        ML_PUBLIC_SOURCE_URL_IS_CATALOG: 0,
        ML_NEW_CATALOG_ONLY_OFFER: 0,
        ML_PUBLIC_CATALOG_OFFER_EXPOSED: 0,
      },
      legacyRawCounters: {
        externalIdIsCatalogId: 0,
        catalogSourceUrl: 0,
        withoutListingItemId: 0,
      },
      findings: [],
      legacy: [],
      dbWrites: 0,
      reasons: [`DATABASE_ERROR=${sanitizeDbErrorMessage(readError(error))}`],
    };
  }

  const evaluation = evaluateMlListingFirstGates(offers);
  const gatesOk = Object.values(evaluation.counters).every((value) => value === 0);

  return {
    gatesOk,
    scanned: offers.length,
    legacyPreserved: evaluation.legacyPreserved,
    newOffers: evaluation.newOffers,
    counters: evaluation.counters,
    legacyRawCounters: evaluation.legacyRawCounters,
    findings: evaluation.findings,
    legacy: evaluation.legacy,
    dbWrites: 0,
    reasons: evaluation.findings.map(
      (f) => `${f.gate}:OFFER=${f.offerId} ${f.reason}`,
    ),
  };
}

function readError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizeDbErrorMessage(message: string): string {
  return message
    .replace(/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s"']+/g, "[redacted-url]")
    .replace(/postgres(?:ql)?:[^@\s]*@[^\s"']+/gi, "[redacted-credentials]")
    .replace(/sb_[A-Za-z0-9_-]+/g, "[redacted-key]")
    .slice(0, 500);
}

function logGateResult(result: MlListingFirstGateResult): void {
  console.log("ML_GATES_MODE=READ_ONLY");
  console.log("ML_DISCOVERY_MODE=LISTING_FIRST");
  console.log("CATALOG_SEARCH_CREATES_OFFERS=NO");
  console.log("CATALOG_ID_AS_EXTERNAL_ID=FORBIDDEN");
  console.log("NEW_ML_OFFER_REQUIRES_ITEM_ID=YES");
  console.log("NEW_ML_OFFER_REQUIRES_REAL_LISTING=YES");
  console.log("");

  if (result.reasons.length === 1 && result.reasons[0].startsWith("DATABASE_ERROR=")) {
    console.log("DATABASE_CONNECTION=FAIL");
    console.log(result.reasons[0]);
    console.log("DB_WRITES=0");
    console.log("ML_LISTING_FIRST_GATES=ERROR");
    return;
  }

  const legacyCounts = {
    listingKnown: result.legacy.filter(
      (r) => r.classification === "LEGACY_LISTING_KNOWN",
    ).length,
    catalogOnly: result.legacy.filter(
      (r) => r.classification === "LEGACY_CATALOG_ONLY",
    ).length,
    blockedIdentity: result.legacy.filter(
      (r) => r.classification === "LEGACY_BLOCKED_IDENTITY",
    ).length,
    exposed: result.legacy.filter((r) => r.expostaPublicamente).length,
  };

  console.log("DATABASE_CONNECTION=PASS");
  console.log(`ML_OFFERS_SCANNED=${result.scanned}`);
  console.log(`ML_LISTING_FIRST_CUTOFF=${ML_LISTING_FIRST_CUTOFF.toISOString()}`);
  console.log(`NEW_ML_OFFERS_SINCE_CUTOFF=${result.newOffers}`);
  console.log(`LEGACY_ROWS_PRESERVED=${result.legacyPreserved}`);
  console.log("");
  console.log("GATES_NOVAS_OFERTAS");
  console.log(
    `ML_OFFER_EXTERNAL_ID_IS_CATALOG_ID=${result.counters.ML_OFFER_EXTERNAL_ID_IS_CATALOG_ID}`,
  );
  console.log(
    `ML_OFFER_WITHOUT_LISTING_ITEM_ID=${result.counters.ML_OFFER_WITHOUT_LISTING_ITEM_ID}`,
  );
  console.log(
    `ML_PUBLIC_SOURCE_URL_IS_CATALOG=${result.counters.ML_PUBLIC_SOURCE_URL_IS_CATALOG}`,
  );
  console.log(`ML_NEW_CATALOG_ONLY_OFFER=${result.counters.ML_NEW_CATALOG_ONLY_OFFER}`);
  console.log("");
  console.log("GATE_EXPOSICAO_TODAS_AS_LINHAS");
  console.log(
    `ML_PUBLIC_CATALOG_OFFER_EXPOSED=${result.counters.ML_PUBLIC_CATALOG_OFFER_EXPOSED}`,
  );
  console.log("");
  console.log("ESTADO_BRUTO_DO_LEGADO");
  console.log(
    `ML_LEGACY_EXTERNAL_ID_IS_CATALOG_ID=${result.legacyRawCounters.externalIdIsCatalogId}`,
  );
  console.log(
    `ML_LEGACY_CATALOG_SOURCE_URL=${result.legacyRawCounters.catalogSourceUrl}`,
  );
  console.log(
    `ML_LEGACY_WITHOUT_LISTING_ITEM_ID=${result.legacyRawCounters.withoutListingItemId}`,
  );
  console.log("");
  console.log("RELATORIO_DE_LEGADO");
  console.log(`LEGACY_LISTING_KNOWN=${legacyCounts.listingKnown}`);
  console.log(`LEGACY_CATALOG_ONLY=${legacyCounts.catalogOnly}`);
  console.log(`LEGACY_BLOCKED_IDENTITY=${legacyCounts.blockedIdentity}`);
  console.log(`LEGACY_EXPOSTAS_NO_CAMINHO_PUBLICO=${legacyCounts.exposed}`);
  console.log("LEGACY_DELETED=0");
  console.log("LEGACY_EXTERNAL_ID_REWRITTEN=0");
  for (const row of result.legacy) {
    console.log(
      `LEGACY_OFFER=${row.offerId} CLASS=${row.classification} ` +
        `BEFORE_CUTOFF=${row.beforeCutoff} PUBLIC_EXPOSED=${row.expostaPublicamente} ` +
        `EXTERNAL_ID=${row.externalId ?? "(vazio)"} ` +
        `CATALOG_PRODUCT_ID=${row.catalogProductId ?? "(nenhum)"}`,
    );
  }
  console.log("");

  if (result.findings.length > 0) {
    for (const finding of result.findings) {
      console.log(
        `GATE_VIOLATION=${finding.gate} OFFER=${finding.offerId} ` +
          `BEFORE_CUTOFF=${finding.beforeCutoff} ${finding.reason}`,
      );
    }
    console.log("");
  }

  console.log("DB_WRITES=0");
  console.log(`ML_LISTING_FIRST_GATES=${result.gatesOk ? "PASS" : "FAIL"}`);
}

async function main(): Promise<void> {
  const result = await runMlListingFirstGates();
  logGateResult(result);
  process.exitCode = result.gatesOk ? 0 : 1;
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  process.argv[1].endsWith("mlListingFirstGates.ts");

if (invokedDirectly) {
  main().catch((error) => {
    console.log("ML_GATES_MODE=READ_ONLY");
    console.log("DATABASE_CONNECTION=FAIL");
    console.log(`DATABASE_ERROR=${sanitizeDbErrorMessage(readError(error))}`);
    console.log("DB_WRITES=0");
    console.log("ML_LISTING_FIRST_GATES=ERROR");
    process.exitCode = 2;
  });
}
