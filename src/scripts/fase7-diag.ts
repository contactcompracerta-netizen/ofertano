import prisma from "@/lib/prisma";
async function main() {
  console.log("typeof rml:", typeof (prisma as any).rawMarketplaceListing);
  console.log("typeof rml.count:", typeof (prisma as any).rawMarketplaceListing?.count);
  console.log("typeof product.count:", typeof (prisma as any).product?.count);
  console.log("keys rml:", Object.keys((prisma as any).rawMarketplaceListing ?? {}).slice(0,20).join(","));
}
main().catch((e)=>{ console.error("ERR", e.message); process.exit(1); });
