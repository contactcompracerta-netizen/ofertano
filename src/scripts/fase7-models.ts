import prisma from "@/lib/prisma";
async function main() {
  const d = prisma as any;
  const names = Object.keys(d).filter(k => k !== "$").sort();
  console.log("MODEL ACCESSORS:", names.join(", "));
}
main().catch((e)=>{ console.error("ERR", e.message); process.exit(1); });
