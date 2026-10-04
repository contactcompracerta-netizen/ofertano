/**
 * FASE 8.3C — PARTE A: FORENSE DE MIGRATION (somente leitura).
 *
 * Lê _prisma_migrations e identifica EXATAMENTE qual migration criou
 * CandidateBlockingKey, com nome, checksum, timestamps e passos.
 * Nada é escrito aqui.
 */
import prisma from "../lib/prisma";

type MigrationRow = {
  migration_name: string;
  checksum: string;
  started_at: Date;
  finished_at: Date | null;
  applied_steps_count: number;
  rolled_back_at: Date | null;
  logs: string | null;
};

type TableRow = { table_name: string };
type ColumnRow = { column_name: string; data_type: string };
type IndexRow = { indexname: string };
type EnumRow = { typname: string };
type CountRow = { n: number };

async function main() {
  const out: Record<string, unknown> = { MODE: "READ_ONLY_FORENSICS" };
  const rows = await prisma.$queryRaw<MigrationRow[]>`
    SELECT migration_name, checksum, started_at, finished_at,
           applied_steps_count, rolled_back_at, logs
      FROM "_prisma_migrations"
     ORDER BY started_at DESC LIMIT 8`;
  out.RECENT_MIGRATIONS = rows.map((r) => ({
    migration_name: r.migration_name,
    checksum: r.checksum,
    started_at: r.started_at,
    finished_at: r.finished_at,
    applied_steps_count: r.applied_steps_count,
    rolled_back_at: r.rolled_back_at,
    // logs pode ser null; nao imprimimos o SQL inteiro aqui.
    has_logs: r.logs !== null && r.logs !== undefined,
  }));

  // Existe a tabela no banco de fato?
  const rel = await prisma.$queryRaw<TableRow[]>`
    SELECT table_name FROM information_schema.tables
     WHERE table_name = 'CandidateBlockingKey'`;
  out.CANDIDATE_BLOCKING_KEY_TABLE_EXISTS = rel.length > 0;

  if (rel.length > 0) {
    const cols = await prisma.$queryRaw<ColumnRow[]>`
      SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'CandidateBlockingKey' ORDER BY ordinal_position`;
    out.COLUMNS = cols.map((c) => `${c.column_name}:${c.data_type}`);
    const idx = await prisma.$queryRaw<IndexRow[]>`
      SELECT indexname FROM pg_indexes WHERE tablename='CandidateBlockingKey'`;
    out.INDEXES = idx.map((i) => i.indexname);
    const n = await prisma.candidateBlockingKey?.count?.().catch(() => null);
    out.ROWS = n ?? null;
    const cnt = await prisma.$queryRaw<CountRow[]>`SELECT COUNT(*)::int AS n FROM "CandidateBlockingKey"`;
    out.ROWS = cnt[0]?.n ?? null;
    // Enums criados
    const enums = await prisma.$queryRaw<EnumRow[]>`
      SELECT t.typname FROM pg_type t JOIN pg_namespace ns ON ns.oid=t.typnamespace
       WHERE t.typname LIKE 'CandidateBlocking%' AND t.typtype='e'`;
    out.MIGRATION_ENUMS = enums.map((e) => e.typname);
  }
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => { console.error("FORENSICS_FAILED", e instanceof Error ? e.message.slice(0,200) : "X"); process.exitCode=1; })
  .finally(async () => { await prisma.$disconnect(); });
