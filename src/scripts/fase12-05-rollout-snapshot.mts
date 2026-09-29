/**
 * FASE 12 (fechamento) — SNAPSHOT DE ROLLOUT, READ ONLY.
 *
 * As três contagens separadas, cruzando configuração com o banco real.
 * Nenhuma escrita.
 */
import { writeFile } from "node:fs/promises";
import prismaMod from "../lib/prisma";
import {
  rolloutRows,
  countV1IntegratedMarketplaces,
  countWriterEnabledMarketplaces,
  countMarketplacesWithPublicOffers,
} from "../services/architecture/v1/rolloutStatus";

const prisma = ((prismaMod as any)?.default ?? prismaMod) as any;
const OUT = "/home/evaldo/Projetos/ofertano-forensics/aliexpress-v1/production";

async function main() {
  const config = rolloutRows(process.env);

  /* Ofertas REAIS, por marketplace, visíveis ao público. */
  const publicas = await prisma.marketplaceOffer.groupBy({
    by: ["marketplace"],
    where: { active: true, available: true },
    _count: { _all: true },
  });

  const porMarketplace: Record<string, number> = {};
  for (const m of publicas) porMarketplace[m.marketplace] = m._count._all;

  /* Alinhar com os enums legados do registry. */
  const porIdCanonico: Record<string, number> = {};
  for (const row of config) {
    porIdCanonico[row.marketplaceId] = porMarketplace[row.legacyEnumValue] ?? 0;
  }

  /* Mercado Livre publica pelo caminho legado, fora deste runner. */
  const mlPublicas = porMarketplace.MERCADO_LIVRE ?? 0;

  const V1_INTEGRATED_MARKETPLACES = countV1IntegratedMarketplaces();
  const WRITER_ENABLED_MARKETPLACES = countWriterEnabledMarketplaces(process.env);
  const MARKETPLACES_WITH_PUBLIC_OFFERS = countMarketplacesWithPublicOffers(porMarketplace);

  const rel = {
    gerado_em: new Date().toISOString(),
    V1_INTEGRATED_MARKETPLACES,
    WRITER_ENABLED_MARKETPLACES,
    MARKETPLACES_WITH_PUBLIC_OFFERS,
    GLOBO_CUTOVER: process.env.CATALOG_V1_GLOBAL_CUTOVER ?? "NO",
    por_marketplace: config.map((c) => ({
      ...c,
      publicOffers: porIdCanonico[c.marketplaceId] ?? 0,
    })),
    legado_fora_do_runner: { MERCADO_LIVRE: mlPublicas },
    alias_amazon: {
      V1_INTEGRATED: "YES",
      WRITER_ENABLED: "YES",
      PUBLIC_OFFERS_COUNT: porIdCanonico.amazon ?? 0,
    },
    alias_aliexpress: {
      ALIEXPRESS_INTEGRATION: "COMPLETE",
      ALIEXPRESS_PUBLICATION: "BLOCKED_IDENTITY",
      ALIEXPRESS_RUNTIME: getModeOf(config, "aliexpress"),
      ALIEXPRESS_PUBLIC_OFFERS: porIdCanonico.aliexpress ?? 0,
    },
    observacao:
      "MARKETPLACES_WITH_PUBLIC_OFFERS conta apenas ofertas ativas e " +
      "disponiveis. Amazon e AliExpress tem 0: integracao != publicacao.",
  };

  await writeFile(`${OUT}/rollout-snapshot.json`, JSON.stringify(rel, null, 2), "utf8");
  console.log(JSON.stringify(rel, null, 2));
  await prisma.$disconnect();
}

function getModeOf(rows: { marketplaceId: string; runtimeMode: string }[], id: string): string {
  return rows.find((r) => r.marketplaceId === id)?.runtimeMode ?? "UNKNOWN";
}

main().catch((e) => {
  console.error("FALHOU:", e instanceof Error ? e.message : e);
  process.exit(1);
});
