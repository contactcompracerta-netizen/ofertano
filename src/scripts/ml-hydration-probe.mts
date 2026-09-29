/** Prova de que getItem entrega permalink do ANUNCIO. READ ONLY. 1 item. */
import prismaMod from "../lib/prisma";
import { getItem } from "../services/importers/mercadolivre/api";
import { hydrateExactItemPermalink } from "../services/affiliates/mercadolivre/itemHydration";

const prisma = ((prismaMod as any)?.default ?? prismaMod) as any;

async function main() {
  const o = await prisma.marketplaceOffer.findFirst({
    where: { marketplace: "MERCADO_LIVRE", active: true, externalId: { not: null } },
    select: { externalId: true, sourceUrl: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`OFERTA_MLB=${o?.externalId}`);
  console.log(`SOURCE_URL_E_CATALOGO=${Boolean(o?.sourceUrl?.includes("/p/"))}`);

  // API crua: o que o ML realmente devolve.
  try {
    const item = await getItem(o!.externalId!);
    console.log(`GET_ITEM=ok id=${item.id} catalog=${item.catalog_product_id ?? "-"}`);
    console.log(`PERMALINK_E_CATALOGO=${Boolean(item.permalink?.includes("/p/"))}`);
    console.log(`PERMALINK_TEM_MLB_ITEM=${Boolean(item.permalink?.match(/MLB-?\d{9,}/))}`);
  } catch (e) {
    console.log(`GET_ITEM=ERRO ${(e as Error).message}`);
  }

  // A política aplicada pelo worker.
  const h = await hydrateExactItemPermalink(o!.externalId!);
  console.log(`HIDRATE=${h.ok ? "OK" : `${h.status}/${h.disposition}`}`);
  if (h.ok) console.log(`  inputMode=${h.inputMode} provaDoAnuncio=${h.provaDoAnuncio}`);
  else console.log(`  motivo=${h.reason}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("FALHOU:", e instanceof Error ? e.message : e); process.exit(1); });
