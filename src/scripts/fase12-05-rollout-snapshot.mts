/**
 * SNAPSHOT DE ROLLOUT — READ ONLY, config cruzada com o banco real.
 *
 * Três dimensões que costumam ser confundidas, deliberadamente separadas:
 *   V1_INTEGRATED                 existe conector
 *   PUBLIC_SYNC_WRITER_ENABLED    autorizado pelo public sync (source-scoped)
 *   LEGACY_WRITER_ENABLED         caminho legado (o ÚNICO que o cutover global apaga)
 *   MARKETPLACES_WITH_PUBLIC_OFFERS   oferta real no banco
 */
import { writeFile } from "node:fs/promises";
import prismaMod from "../lib/prisma";
import {
  rolloutRows,
  classifyPublicationStatus,
  countV1IntegratedMarketplaces,
  countPublicSyncWriterEnabled,
  countLegacyWriterEnabled,
  legacyWriterEnabled,
  countMarketplacesWithPublicOffers,
} from "../services/architecture/v1/rolloutStatus";

const prisma = ((prismaMod as any)?.default ?? prismaMod) as any;
const OUT = process.env.ML_ROLLOUT_OUT ?? "/home/evaldo/Projetos/ofertano-forensics/go-live";
const TABELA = "MARKETPLACE_STATUS_TABLE";

const COLUNAS = [
  "marketplace",
  "v1Integrated",
  "publicSyncMode",
  "publicSyncAuthorized",
  "legacyWriter",
  "publicOfferCount",
  "publicationStatus",
] as const;

const LARGURAS = [16, 13, 31, 21, 12, 17] as const;

function linha(celulas: readonly string[]): string {
  return celulas
    .map((c, i) => (i === celulas.length - 1 ? c : c.padEnd(LARGURAS[i])))
    .join(" ");
}

async function main() {
  const config = rolloutRows(process.env);

  /* Ofertas REAIS, por marketplace, visíveis ao público. */
  const publicas = await prisma.marketplaceOffer.groupBy({
    by: ["marketplace"],
    where: { active: true, available: true, status: { notIn: ["UNAVAILABLE", "ERROR"] } },
    _count: { _all: true },
  });

  const porMarketplace: Record<string, number> = {};
  for (const m of publicas) porMarketplace[m.marketplace] = m._count._all;

  const rows = config.map((c) => {
    const publicOfferCount = porMarketplace[c.legacyEnumValue] ?? 0;
    const withCount = { ...c, publicOfferCount };
    return {
      ...withCount,
      publicationStatus: classifyPublicationStatus(withCount),
    };
  });

  const mlPublicas = porMarketplace.MERCADO_LIVRE ?? 0;
  const rel = {
    gerado_em: new Date().toISOString(),

    V1_INTEGRATED_MARKETPLACES: countV1IntegratedMarketplaces(),
    PUBLIC_SYNC_WRITER_ENABLED: countPublicSyncWriterEnabled(process.env),
    LEGACY_WRITER_ENABLED: legacyWriterEnabled(process.env)
      ? countLegacyWriterEnabled(process.env)
      : 0,
    MARKETPLACES_WITH_PUBLIC_OFFERS: countMarketplacesWithPublicOffers(porMarketplace),

    GLOBAL_CUTOVER: process.env.CATALOG_V1_GLOBAL_CUTOVER ?? "NO (ausente)",
    NOTA_SEMANTICA:
      "CATALOG_V1_GLOBAL_CUTOVER apaga SÓ o caminho legado. Não inferir " +
      "public sync OFF a partir dele: são mecanismos separados.",

    por_marketplace: rows,
    legado_fora_do_runner: { MERCADO_LIVRE: mlPublicas },

    TABELA_TEXTO: "",
  };

  rel.TABELA_TEXTO = [
    linha(COLUNAS),
    ...rows.map((r) =>
      linha([
        r.marketplaceId,
        String(r.v1Integrated),
        r.publicSyncMode,
        String(r.publicSyncAuthorized),
        String(r.legacyWriter),
        String(r.publicOfferCount),
        r.publicationStatus,
      ]),
    ),
  ].join("\n");

  await writeFile(`${OUT}/rollout-snapshot.json`, JSON.stringify(rel, null, 2), "utf8");
  console.log(rel.TABELA_TEXTO);
  console.log("");
  console.log(
    `V1_INTEGRATED=${rel.V1_INTEGRATED_MARKETPLACES}  ` +
      `PUBLIC_SYNC_WRITER=${rel.PUBLIC_SYNC_WRITER_ENABLED}  ` +
      `LEGACY_WRITER=${rel.LEGACY_WRITER_ENABLED}  ` +
      `WITH_PUBLIC_OFFERS=${rel.MARKETPLACES_WITH_PUBLIC_OFFERS}`,
  );
  console.log(`GLOBAL_CUTOVER=${rel.GLOBAL_CUTOVER}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FALHOU:", e instanceof Error ? e.message : e);
  process.exit(1);
});
