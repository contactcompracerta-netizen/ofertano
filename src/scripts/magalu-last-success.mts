/** Ultima execucao real de Magalu. READ ONLY. */
import prismaMod from "../lib/prisma";
const prisma = ((prismaMod as any)?.default ?? prismaMod) as any;

async function main() {
  const ofertas = await prisma.marketplaceOffer.findMany({
    where: { marketplace: "MAGAZINE_LUIZA" },
    select: { externalId: true, price: true, affiliateLink: true, createdAt: true, updatedAt: true, active: true },
    orderBy: { updatedAt: "desc" },
  });
  console.log(`MAGALU_OFFERS=${ofertas.length}`);
  for (const o of ofertas) {
    console.log(`  ext=${o.externalId} price=${o.price} active=${o.active} temLink=${Boolean(o.affiliateLink)} updatedAt=${o.updatedAt.toISOString()}`);
  }
  const maisNova = ofertas[0]?.updatedAt;
  console.log(`MAGALU_LAST_OFFER_TOUCH=${maisNova ? maisNova.toISOString() : "<nenhuma>"}`);

  const runs = await prisma.importRun.findMany({
    orderBy: { startedAt: "desc" }, take: 5,
    select: { id: true, marketplaceId: true, mode: true, status: true, startedAt: true, finishedAt: true, itemsReceived: true, itemsChanged: true, itemsUnchanged: true, lastSeenAt: true },
  });
  console.log("IMPORT_RUNS_RECENTES:");
  for (const r of runs) console.log(`  mp=${r.marketplaceId} mode=${r.mode} status=${r.status} started=${r.startedAt?.toISOString?.() ?? r.startedAt} recv=${r.itemsReceived} changed=${r.itemsChanged} unchanged=${r.itemsUnchanged} lastSeen=${r.lastSeenAt?.toISOString?.() ?? "-"}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error("FALHOU:", e instanceof Error ? e.message : e); process.exit(1); });
