/**
 * FECHAMENTO — PARTE 9: snapshot READ-ONLY da migration e da tabela.
 * Nenhuma escrita. `--phase=before|after` rotula o artefato.
 */
import prisma from "../lib/prisma";
const PHASE = (process.argv.find((a) => a.startsWith("--phase=")) || "--phase=?").split("=")[1];
const MIG = "20260926220000_candidate_blocking_keys";
async function main() {
  const out: Record<string, unknown> = { PHASE, MODE: "READ_ONLY" };
  const m = await prisma.$queryRaw<any[]>`
    SELECT migration_name, checksum, started_at, finished_at,
           applied_steps_count, rolled_back_at
      FROM "_prisma_migrations" WHERE migration_name = ${MIG}`;
  out.LEDGER_ROW = m[0] ?? null;
  const t = await prisma.$queryRaw<any[]>`SELECT COUNT(*)::int AS n FROM "CandidateBlockingKey"`;
  out.CANDIDATE_BLOCKING_KEY_ROWS = t[0]?.n ?? 0;
  const i = await prisma.$queryRaw<any[]>`
    SELECT indexname FROM pg_indexes WHERE tablename='CandidateBlockingKey' ORDER BY indexname`;
  out.INDEXES = i.map((x) => x.indexname);
  const tot = await prisma.$queryRaw<any[]>`SELECT COUNT(*)::int AS n FROM "_prisma_migrations"`;
  out.LEDGER_TOTAL = tot[0]?.n ?? 0;
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error("SNAP_FAILED", e instanceof Error ? e.message.slice(0,150) : "X"); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
