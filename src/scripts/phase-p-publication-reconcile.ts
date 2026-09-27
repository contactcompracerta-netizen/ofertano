/**
 * FASE P (FASE Q/S/T) — RECONCILIADOR DE ESTADO DE PUBLICAÇÃO.
 *
 * ============================================================================
 * O QUE ELE FAZ
 * ============================================================================
 * Encontra `Product` com `autoCreated=true` e `active=true` para os quais a
 * POLÍTICA CENTRAL responde `eligible=false` — ou seja, o estado persistido
 * diz "publicado" enquanto o contrato de publicação diz o contrário.
 *
 * Foi assim que a Fase P encontrou o produto `0add0a7e…` (Carregador iPhone
 * 20W): MERCADO_LIVRE público + SHOPEE em SHADOW. Peso real = 1 marketplace
 * público, abaixo de `PUBLIC_MULTISTORE_MIN_MARKETPLACES`.
 *
 * ============================================================================
 * O QUE ELE NÃO FAZ
 * ============================================================================
 * - Não reimplementa a regra. A detecção é `evaluatePublicationEligibility`
 *   (política central) e o peso vem de `countPublicMarketplacesWithWeight`.
 *   Não há `COUNT(DISTINCT ...)` cru neste arquivo: foi justamente um SQL cru
 *   sem peso de shadow que produziu a medição errada da Fase P.
 * - Não roda `--apply` sozinho. O default é DRY-RUN e, sem `--apply`, o
 *   número de escritas é ZERO por construção (o caminho de escrita só é
 *   alcançado dentro de `if (aplicar)`).
 * - Não faz bulk update cego. Cada escrita re-lê o produto, compara com o
 *   estado esperado do dry-run (CAS) e roda em transação.
 *
 * ============================================================================
 * AÇÃO CANÔNICA DE DEMOTÇÃO (PROVADA PELO CÓDIGO EXISTENTE)
 * ============================================================================
 * Não é escolha deste script. `sincronizarMelhorOfertaDoProduto`
 * (src/services/database/saveProduct.ts) já faz exatamente isto no caminho de
 * escrita normal, e o reconciliador de apresentação existente
 * (src/services/catalog/reconciliation.ts) usa a mesma combinação:
 *
 *     publicationStatus = "DRAFT"
 *     active            = false
 *
 * Trecho que prova (saveProduct.ts):
 *
 *     const semMultiLojaPublica =
 *       !permitirAtivacaoProdutoAutoCriado(autoCreated, ofertasExatas);
 *     const publicationStatus =
 *       semMultiLojaPublica ? "DRAFT" : ...;
 *     const activeFinal = !semMultiLojaPublica;
 *
 * Logo "produto auto-criado que não é public-ready" ≡ DRAFT + active=false,
 * e este script apenas converge o estado para essa mesma forma.
 *
 * USO
 *   npx tsx --env-file=.env.local src/scripts/phase-p-publication-reconcile.ts
 *   npx tsx --env-file=.env.local src/scripts/phase-p-publication-reconcile.ts \
 *     --apply --limit=1 --product-id=<id> --expect-active=true \
 *     --expect-publication-status=LIVE_PARTIAL
 */

import prisma from "../lib/prisma";
import { readShadowFlags, maskShadowFlags } from "../services/architecture/v1/shadow/flags";
import { evaluatePublicationEligibility } from "../services/architecture/v1/publication/publicationEligibility";
import { countPublicMarketplacesWithWeight, toCanonicalMarketplaceId, toPublicOfferMarketplaceIds } from "../services/architecture/v1/publication/shadowWeight";
import { PUBLIC_MULTISTORE_MIN_MARKETPLACES } from "../services/publicVisibility/multiStoreVisibility";

/* ============================== CLI ============================== */

/*
 * O `--apply` é explícito e não tem default. Sem ele, DRY-RUN com ZERO
 * escritas. `parseReconcileArgs` é exportado e testado isoladamente porque
 * "o default é dry-run" é uma propriedade de SEGURANÇA, não um detalhe: se
 * alguém inverter o default, o teste tem de falhar.
 */
export type ReconcileArgs = {
  aplicar: boolean;
  limite: number;
  productId?: string;
  expectActive?: string;
  expectStatus?: string;
};

export function parseReconcileArgs(argv: string[]): ReconcileArgs {
  const has = (name: string) => argv.includes(`--${name}`);
  const value = (name: string) => {
    const prefix = `--${name}=`;
    return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  };
  const rawLimit = value("limit");
  let limite = 1;
  if (rawLimit !== undefined) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`--limit precisa ser um inteiro >= 0 (recebido: ${rawLimit})`);
    }
    limite = parsed;
  }

  return {
    aplicar: has("apply"),
    limite,
    productId: value("product-id"),
    expectActive: value("expect-active"),
    expectStatus: value("expect-publication-status"),
  };
}

const ARGS = parseReconcileArgs(process.argv);
const APLICAR = ARGS.aplicar;
const LIMITE = ARGS.limite;
const PRODUCT_ID = ARGS.productId;
const EXPECT_ACTIVE = ARGS.expectActive;
const EXPECT_STATUS = ARGS.expectStatus;

/* ============================ tipos ============================ */

type Violacao = {
  productId: string;
  name: string;
  currentState: {
    autoCreated: boolean;
    active: boolean;
    publicationStatus: string;
  };
  weightedMarketplaces: string[];
  shadowMarketplacesExcluded: string[];
  weightedMarketplaceCount: number;
  unweightedMarketplaceCount: number;
  minRequired: number;
  reasonCodes: string[];
  eligible: boolean;
  proposed: {
    publicationStatus: "DRAFT";
    active: false;
  };
};

/* ======================= leitura (read-only) ======================= */

async function listCandidates() {
  /*
   * A busca traz SOMENTE autoCreated + active, que é o recorte da pergunta
   * ("o estado persistido diz publicado?"). A REGRA não é aplicada aqui: o
   * veredito vem da política central, abaixo.
   */
  return prisma.product.findMany({
    where: {
      autoCreated: true,
      active: true,
      ...(PRODUCT_ID ? { id: PRODUCT_ID } : {}),
    },
    select: {
      id: true,
      name: true,
      autoCreated: true,
      active: true,
      publicationStatus: true,
      updatedAt: true,
      offers: {
        where: { active: true, matchStatus: "EXACT" },
        select: {
          marketplace: true,
          active: true,
          matchStatus: true,
          available: true,
          status: true,
          price: true,
        },
      },
    },
    orderBy: { updatedAt: "asc" },
  });
}

export type ReconcilableProduct = {
  id: string;
  name: string;
  autoCreated: boolean;
  active: boolean;
  publicationStatus: string;
  offers: Array<{
    marketplace: string;
    active?: boolean;
    matchStatus?: string;
    available?: boolean;
    status?: string;
    price?: number | null;
  }>;
};

/**
 * Avaliação PURA (sem I/O) de um produto. A regra NÃO é reimplementada: o
 * veredito vem de `evaluatePublicationEligibility`, e o peso, da mesma
 * `countPublicMarketplacesWithWeight` que o funil público usa. Se a política
 * mudar, o reconciliador muda junto — que é o ponto.
 */
export function evaluateProductViolation(
  product: ReconcilableProduct,
  flags = readShadowFlags(),
): Violacao | null {
  const verdict = evaluatePublicationEligibility({
    autoCreated: product.autoCreated,
    offers: product.offers,
    shadowFlags: flags,
  });

  if (verdict.eligible) {
    return null;
  }

  /* Marketplaces que PESAM (excluem a fonte SHADOW) e os que não pesam. */
  const publicIds = toPublicOfferMarketplaceIds(
    product.offers.map((o) => ({ marketplace: o.marketplace })),
    flags,
  );
  const shadowIds = [
    ...new Set(
      product.offers
        .map((o) => toCanonicalMarketplaceId(o.marketplace))
        .filter((id) => !publicIds.includes(id)),
    ),
  ].sort();

  return {
    productId: product.id,
    name: product.name,
    currentState: {
      autoCreated: product.autoCreated,
      active: product.active,
      publicationStatus: product.publicationStatus,
    },
    weightedMarketplaces: [...new Set(publicIds)].sort(),
    shadowMarketplacesExcluded: shadowIds,
    weightedMarketplaceCount: countPublicMarketplacesWithWeight(
      product.offers.map((o) => ({ marketplace: o.marketplace })),
      flags,
    ),
    unweightedMarketplaceCount: new Set(
      product.offers.map((o) => toCanonicalMarketplaceId(o.marketplace)),
    ).size,
    minRequired: PUBLIC_MULTISTORE_MIN_MARKETPLACES,
    reasonCodes: verdict.reasonCodes,
    eligible: false,
    /* CANÔNICO — igual ao caminho de escrita real (ver cabeçalho). */
    proposed: { publicationStatus: "DRAFT", active: false },
  };
}

/* ==================== escrita (fail-closed) ==================== */

type ApplyOutcome = "APPLIED" | "SKIPPED_STATE_CHANGED" | "SKIPPED_EXPECTATION" | "SKIPPED_ALREADY_TARGET";

async function applyOne(violation: Violacao): Promise<ApplyOutcome> {
  return prisma.$transaction(async (tx) => {
    /*
     * RE-LEITURA DENTRO DA TRANSAÇÃO. O dry-run pode ter sido executado há
     * horas; se o produto mudou desde então, o que o dry-run mediu já não é
     * o estado atual e a escrita seria um bulk update cego.
     */
    const atual = await tx.product.findUnique({
      where: { id: violation.productId },
      select: { active: true, publicationStatus: true, autoCreated: true },
    });

    if (!atual) return "SKIPPED_STATE_CHANGED";
    if (atual.autoCreated !== true) return "SKIPPED_STATE_CHANGED";

    /* CAS: o estado observado no dry-run ainda é o estado de hoje? */
    if (atual.active !== violation.currentState.active) return "SKIPPED_STATE_CHANGED";
    if (atual.publicationStatus !== violation.currentState.publicationStatus) {
      return "SKIPPED_STATE_CHANGED";
    }

    /* CAS explícito pedido pela missão. */
    if (EXPECT_ACTIVE !== undefined) {
      const esperado = EXPECT_ACTIVE === "true";
      if (atual.active !== esperado) return "SKIPPED_EXPECTATION";
    }
    if (EXPECT_STATUS !== undefined && atual.publicationStatus !== EXPECT_STATUS) {
      return "SKIPPED_EXPECTATION";
    }

    if (atual.active === false && atual.publicationStatus === "DRAFT") {
      return "SKIPPED_ALREADY_TARGET";
    }

    await tx.product.update({
      where: { id: violation.productId },
      data: {
        publicationStatus: violation.proposed.publicationStatus,
        active: violation.proposed.active,
      },
    });

    return "APPLIED";
  });
}

/* ============================== main ============================== */

async function main() {
  const flags = readShadowFlags();
  const candidates = await listCandidates();

  const violacoes = candidates
    .map((product) => evaluateProductViolation(product as ReconcilableProduct, flags))
    .filter((v): v is Violacao => v !== null);

  const alvo = APLICAR ? violacoes.slice(0, LIMITE) : [];
  const results: Array<{ productId: string; outcome: ApplyOutcome }> = [];

  if (APLICAR) {
    for (const violacao of alvo) {
      results.push({ productId: violacao.productId, outcome: await applyOne(violacao) });
    }
  }

  const out = {
    MODE: APLICAR ? "APPLY" : "DRY_RUN",
    SCRIPT: "phase-p-publication-reconcile",

    /* Contexto de política — sempre mascarado, nunca dumpar segredo. */
    SHADOW_FLAGS_EFFECTIVE: maskShadowFlags(flags),
    GLOBAL_CUTOVER:
      String(process.env.CATALOG_V1_GLOBAL_CUTOVER ?? "").toUpperCase() === "YES"
        ? "YES"
        : "NO",
    PUBLIC_MULTISTORE_MIN_MARKETPLACES,

    SCANNED_AUTO_CREATED_ACTIVE: candidates.length,
    VIOLATION_COUNT: violacoes.length,
    PRODUCT_IDS: violacoes.map((v) => v.productId),
    WRITES_EMITTED: results.filter((r) => r.outcome === "APPLIED").length,
    APPLY_LIMIT: LIMITE,
    PRODUCT_ID_FILTER: PRODUCT_ID ?? null,
    EXPECTED_STATE: {
      expectActive: EXPECT_ACTIVE ?? null,
      expectPublicationStatus: EXPECT_STATUS ?? null,
    },
    VIOLATIONS: violacoes,
    APPLY_RESULTS: results,
  };

  console.log(JSON.stringify(out, null, 2));
}

/*
 * Só executa quando este arquivo é o ENTRYPOINT. Os testes importam
 * `parseReconcileArgs` e `evaluateProductViolation`; sem esta guarda, importar
 * o módulo dispararia uma consulta ao banco de produção dentro do teste.
 */
const ehEntrypoint =
  process.argv[1]?.includes("phase-p-publication-reconcile") ?? false;

if (ehEntrypoint) {
  main()
    .catch((error) => {
      console.error(
        JSON.stringify(
          {
            MODE: APLICAR ? "APPLY" : "DRY_RUN",
            STATUS: "ERROR",
            ERROR: error instanceof Error ? error.message : String(error),
            WRITES_EMITTED: null,
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
