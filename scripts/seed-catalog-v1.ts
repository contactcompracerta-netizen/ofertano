/**
 * Seed local — Integração do Catálogo V1 validado ao runtime real do Ofertano.
 *
 * Reutiliza EXATAMENTE os módulos reais que passaram na validação (292/292):
 *   - identity/agruparPorIdentidadeExata ..... agrupamento exato conservador
 *   - identity/exactMatcher ................. matcher EXACT (via persistPublicSearchCluster)
 *   - search/persistPublicSearchCluster ..... fluxo real de persistência de busca
 *   - database/saveProduct .................. persistência real (Product + MarketplaceOffer)
 *
 * Adaptação de dados (sem tocar nos módulos):
 *   - `ProductImport.marketplace` real é o display name ("Mercado Livre", "Amazon", ...).
 *     As fixtures usam códigos de enum ("MERCADO_LIVRE", ...) → mapeados aqui.
 *   - KABUM / CASAS_BAHIA / CARREFOUR não existem no importers/persist real
 *     (converterMarketplace rejeita) → entradas com esses marketplaces são
 *     mantidas nas fixtures do harness, mas fora da integração de runtime.
 *
 * Regras de segurança:
 *   - APENAS banco LOCAL descartável (127.0.0.1:55433), nunca Production.
 *   - Não altera prisma/schema.prisma, migrations, src/lib/prisma.ts ou flags.
 *   - Nenhum fallback público de runtime é criado.
 *
 * Uso:
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55433/ofertano_catalog_v1 \
 *   npx tsx scripts/seed-catalog-v1.ts
 */

import prisma from "../src/lib/prisma";

import { agruparPorIdentidadeExata } from "../src/services/identity";
import type { IdentityEvidence } from "../src/services/identity";

import { catalogV1Fixtures } from "../src/services/catalog-v1-test-fixtures/data";

import { avaliarSearchCompletionBarrier } from "../src/services/search/searchCompletionBarrier";
import {
  escolherClusterExatoDaPesquisaPublica,
  persistPublicSearchCluster,
} from "../src/services/search/persistPublicSearchCluster";
import type { PublicSearchOffer } from "../src/services/search/persistPublicSearchCluster";

import type { ProductImport } from "../src/services/importers/core/types";

// ─── Mapeamento marketplace → display name real do ProductImport ───
const MARKETPLACE_DISPLAY_NAME: Record<string, string> = {
  MERCADO_LIVRE: "Mercado Livre",
  AMAZON: "Amazon",
  SHOPEE: "Shopee",
  MAGAZINE_LUIZA: "Magazine Luiza",
  ALIEXPRESS: "AliExpress",
};

// Códigos de discovery (barrier) — os 5 marketplaces reais codificam.
const DISCOVERY_CODE: Record<string, string> = {
  "Mercado Livre": "MERCADO_LIVRE",
  MERCADO_LIVRE: "MERCADO_LIVRE",
  Amazon: "AMAZON",
  AMAZON: "AMAZON",
  Shopee: "SHOPEE",
  SHOPEE: "SHOPEE",
  "Magazine Luiza": "MAGAZINE_LUIZA",
  MAGAZINE_LUIZA: "MAGAZINE_LUIZA",
  AliExpress: "ALIEXPRESS",
  ALIEXPRESS: "ALIEXPRESS",
};

function codificarMarketplace(marketplace: string): string | null {
  return DISCOVERY_CODE[marketplace] ?? null;
}

function canonicalOf(product: ProductImport): string {
  const modelo = (product.attributes?.MODELO ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return `${product.brand?.toLowerCase() ?? "s/marca"}-${modelo}`;
}

function marcarDisponivel(product: ProductImport): ProductImport {
  return {
    ...product,
    marketplace: MARKETPLACE_DISPLAY_NAME[product.marketplace] ?? product.marketplace,
  };
}

/**
 * Queries de "usuario real" por canônico — usadas quando usar o titulo-ancora
 * como query nao gera cluster exato. O matcher conservador de identidade
 * rejeita o titulo completo quando a resolucao da query produz codigos de
 * modelo divergentes (ex.: "Inspiron 15 5510 Intel i5" → INSPIRON15 vs
 * identidade do item INSPIRON155510). Essas queries sao o que um usuario
 * digitaria e PASSAM no `avaliarCompatibilidadeComConsulta` real.
 *
 * IMPORTANTE: nenhum modulo real e alterado — apenas o dado de entrada do seed.
 */
const QUERY_FALLBACK_CANONICO: Record<string, string[]> = {
  // Classe NOTEBOOK reconhecida; query sem codigo-de-modelo conflitante.
  "dell-inspiron155510": ["notebook dell inspiron"],
  // Classe UNKNOWN (AirFryer nao tem familia no classificador real); o aceite
  // entra por "modelo forte compativel" quando a query declara HD925290 exato.
  "philips-hd925290": ["philips hd925290"],
};

function queriesDoGrupo(canonical: string, tituloAncora: string): string[] {
  return [
    tituloAncora,
    ...(QUERY_FALLBACK_CANONICO[canonical] ?? []),
  ];
}

function toCandidate(product: ProductImport) {
  return {
    marketplace: codificarMarketplace(product.marketplace),
    marketplaceName: product.marketplace,
    externalId: product.externalId,
    sourceUrl: product.url,
    title: product.title,
    brand: product.brand,
    category: product.category,
    image: product.image,
    price: product.price,
    oldPrice: product.oldPrice,
    attributes: product.attributes ?? {},
    affiliateLink: product.affiliateLink ?? null,
    status: "FOUND",
  };
}

type GrupoSeed = {
  canonical: string;
  query: string;
  offers: PublicSearchOffer[];
  members: ProductImport[];
};

async function main(): Promise<void> {
  // ─── Filtro: marketplaces não suportados pelo persist real ficam de fora ───
  const descartados = catalogV1Fixtures.filter(
    (product) => !MARKETPLACE_DISPLAY_NAME[product.marketplace],
  );
  const suportados = catalogV1Fixtures
    .filter((product) => MARKETPLACE_DISPLAY_NAME[product.marketplace])
    .map(marcarDisponivel);

  console.log("=== FILTRO DE MARKETPLACE (persist real) ===");
  console.log(
    `fixtures=${catalogV1Fixtures.length} suportados=${suportados.length} ` +
      `descartados=${descartados.length}`,
  );
  for (const product of descartados) {
    console.log(
      `  fora-do-runtime ${product.externalId} (${product.marketplace}) ` +
        `— marketplace nao suportado pelo importers/persist`,
    );
  }

  const evidences: IdentityEvidence<ProductImport>[] = suportados.map(
    (product) => ({ item: product, product }),
  );

  const clusters = agruparPorIdentidadeExata(evidences);

  const grupos: GrupoSeed[] = clusters.map((cluster) => {
    const members = cluster.members.map((evidence) => evidence.item);
    return {
      canonical: canonicalOf(members[0]),
      query: cluster.anchor.product.title,
      offers: members.map((product) => ({
        product,
        affiliateLink: product.affiliateLink ?? null,
      })),
      members,
    };
  });

  console.log("\n=== AGRUPAMENTO EXATO (identity/agruparPorIdentidadeExata) ===");
  console.log(`suportados=${suportados.length} grupos=${grupos.length}`);
  for (const grupo of grupos) {
    console.log(
      `  [${grupo.canonical}] query="${grupo.query}" ofertas=${grupo.offers.length} ` +
        `lojas=${grupo.offers.map((o) => o.product.marketplace).join(",")}`,
    );
  }

  console.log("\n=== PERSISTÊNCIA REAL (search/persistPublicSearchCluster) ===");
  const resultados: Array<{
    canonical: string;
    query: string;
    productId: string | null;
    storeCount: number;
    clusterSize: number;
    barrier: string;
    persisted: ProductImport[];
  }> = [];

  for (const grupo of grupos) {
    const enabled = Array.from(
      new Set(
        grupo.offers
          .map((offer) => codificarMarketplace(offer.product.marketplace))
          .filter(Boolean),
      ),
    ) as string[];

    let productId: string | null = null;
    let storeCount = 0;
    let persisted: ProductImport[] = [];
    let queryUsada = grupo.query;
    let clusterExact: typeof grupo.offers = [];

    for (const query of queriesDoGrupo(grupo.canonical, grupo.query)) {
      const results = enabled.map((marketplace) => ({
        marketplace,
        query,
        success: true,
        candidates: grupo.offers
          .filter(
            (offer) => codificarMarketplace(offer.product.marketplace) === marketplace,
          )
          .map((offer) => toCandidate(offer.product)),
        scanned: grupo.offers.length,
        sourcesTried: ["catalog-v1-fixture"],
      }));

      const exactCluster = escolherClusterExatoDaPesquisaPublica(
        query,
        grupo.offers,
      );
      const barrier = avaliarSearchCompletionBarrier({
        query,
        enabledMarketplaces: enabled,
        results,
        exactOffers: exactCluster,
      });

      if (barrier.publicationAllowed && exactCluster.length > 0) {
        queryUsada = query;
        clusterExact = exactCluster;
        try {
          const save = await persistPublicSearchCluster(
            query,
            grupo.offers,
            null,
            { enabledMarketplaces: enabled, results },
          );

          if (save) {
            productId = save.productId;
            storeCount = save.storeCount;
            persisted = exactCluster.map((offer) => offer.product);
            break;
          }
        } catch (error) {
          console.error(
            `  ERRO ao persistir ${grupo.canonical}:`,
            error instanceof Error ? error.message : String(error),
          );
          break;
        }
      }
    }

    if (!productId) {
      const results = enabled.map((marketplace) => ({
        marketplace,
        query: queryUsada,
        success: true,
        candidates: grupo.offers
          .filter(
            (offer) => codificarMarketplace(offer.product.marketplace) === marketplace,
          )
          .map((offer) => toCandidate(offer.product)),
        scanned: grupo.offers.length,
        sourcesTried: ["catalog-v1-fixture"],
      }));
      const barrier = avaliarSearchCompletionBarrier({
        query: queryUsada,
        enabledMarketplaces: enabled,
        results,
        exactOffers: clusterExact,
      });
      console.log(
        `  SKIP ${grupo.canonical} — barrier=${barrier.result} ` +
          `cluster_exact=${clusterExact.length}/${grupo.offers.length}`,
      );
    }

    if (productId) {
      console.log(
        `  OK ${grupo.canonical} query="${queryUsada}" productId=${productId} storeCount=${storeCount} ` +
          `cluster_exact=${clusterExact.length}/${grupo.offers.length}`,
      );
    }

    resultados.push({
      canonical: grupo.canonical,
      query: queryUsada,
      productId,
      storeCount,
      clusterSize: clusterExact.length,
      barrier: "",
      persisted,
    });
  }

  console.log("\n=== DUPLICAÇÃO CANÔNICA (matcher conservador preservado) ===");
  const porCanonical = new Map<string, Set<string>>();
  const splitsMerge = new Map<string, number>();
  for (const resultado of resultados) {
    if (!resultado.productId) {
      continue;
    }
    const conjunto = porCanonical.get(resultado.canonical) ?? new Set<string>();
    conjunto.add(resultado.productId);
    porCanonical.set(resultado.canonical, conjunto);
    splitsMerge.set(
      resultado.canonical,
      (splitsMerge.get(resultado.canonical) ?? 0) + 1,
    );
  }

  const duplicacoesReais: string[] = [];
  for (const [canonical, ids] of porCanonical) {
    // Split de identidade no matcher que converge no MESMO productId no persist
    // (canonicalKey identica → merge em saveProduct) NAO e duplicacao no DB.
    const mergiadoPeloPersist = ids.size === 1 && (splitsMerge.get(canonical) ?? 0) > 1;
    if (mergiadoPeloPersist) {
      console.log(
        `  ➜  ${canonical} SPLIT no matcher (${splitsMerge.get(canonical)} grupos) ` +
          `→ MERGE no persist (1 productId ${Array.from(ids)[0]} por canonicalKey)`,
      );
      continue;
    }
    const duplicado = ids.size > 1;
    if (duplicado) {
      duplicacoesReais.push(canonical);
    }
    console.log(
      `${duplicado ? "  ⚠️  DUPLICADO (produtos distintos no DB)" : "  ✔"} ${canonical}: ${Array.from(ids).join(", ")}`,
    );
  }

  console.log("\n=== ESTADO FINAL NO BANCO LOCAL ===");
  const products = await prisma.product.findMany({
    include: {
      offers: {
        select: {
          marketplace: true,
          price: true,
          status: true,
          available: true,
          active: true,
          matchStatus: true,
          externalId: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  const ativos = products.filter((product) => product.active);
  console.log(
    `products=${products.length} ativos=${ativos.length} ` +
      `offers=${products.reduce((acc, p) => acc + p.offers.length, 0)}`,
  );
  for (const product of products) {
    const lojas = [...new Set(product.offers.map((offer) => offer.marketplace))];
    console.log(
      `  ${product.id} | active=${product.active} | publicacao=${product.publicationStatus} | ` +
        `lojas=${lojas.join(",")} | ofertas=${product.offers.length} | ${product.name}`,
    );
    for (const offer of product.offers) {
      console.log(
        `      - ${offer.externalId} ${offer.marketplace} R$${offer.price} ` +
          `status=${offer.status} available=${offer.available} active=${offer.active} match=${offer.matchStatus}`,
      );
    }
  }

  console.log("\n=== SUMMARY ===");
  const persistedProducts = resultados.filter((r) => r.productId).length;
  const persistedOffers = resultados.reduce((acc, r) => acc + r.storeCount, 0);
  console.log(
    `grupos=${grupos.length} persistidos=${persistedProducts} ` +
      `ofertas_persistidas=${persistedOffers} duplicacoes_reais=${duplicacoesReais.length}`,
  );

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error("SEED_FALHOU:", error);
  process.exitCode = 1;
});