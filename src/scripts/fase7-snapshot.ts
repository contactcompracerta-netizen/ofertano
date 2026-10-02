import prisma from "@/lib/prisma";
async function main() {
  const t0 = Date.now();
  const raw = await prisma.rawMarketplaceListing.count();
  const prod = await prisma.product.count();
  const off = await prisma.marketplaceOffer.count();
  const ph = await prisma.priceHistory.count();
  const iq = await prisma.importQueue.count();
  const po = await prisma.productOpportunity.count();
  const ir = await prisma.importRun.count();
  const ib = await prisma.importBatch.count();
  const iqPend = await prisma.importQueue.count({ where: { status: "PENDING" } });
  const iqProc = await prisma.importQueue.count({ where: { status: "PROCESSING" } });
  const mc = await prisma.marketplaceConnection.count();
  console.log(`elapsed_ms=${Date.now()-t0}`);
  console.log(`RAW=${raw} PRODUCT=${prod} OFFER=${off} PRICE_HISTORY=${ph}`);
  console.log(`IMPORT_QUEUE=${iq} (PENDING=${iqPend} PROCESSING=${iqProc}) PRODUCT_OPPORTUNITY=${po}`);
  console.log(`IMPORT_RUN=${ir} IMPORT_BATCH=${ib} MARKETPLACE_CONNECTION=${mc}`);
}
main().catch((e)=>{ console.error("ERR", e.message); process.exit(1); });
