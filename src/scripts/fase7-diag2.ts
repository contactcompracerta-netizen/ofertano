import prisma from "@/lib/prisma";
async function main() {
  try { const r:any = await prisma.$queryRaw`SELECT 1 AS ok`; console.log("RAW-QUERY OK:", JSON.stringify(r)); }
  catch(e:any) { console.log("RAW-QUERY FAIL:", e.message); }
  for (const m of ["rawMarketplaceListing","product","marketplaceOffer","priceHistory","importQueue","productOpportunity","marketplaceConnection"]) {
    try { const c:any = await (prisma as any)[m].count(); console.log(m, "=", c); }
    catch(e:any) { console.log(m, "FAIL:", e.message); }
  }
}
main().catch((e)=>{ console.error("FATAL", e.message); process.exit(1); });
