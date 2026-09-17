/**
 * Extrai um fingerprint determinístico do schema public (somente metadados,
 * sem dados) para comparar dois bancos. Ignora a tabela interna
 * `_prisma_migrations` e seus tipos associados.
 *
 * Uso:
 *   DIRECT_URL=... node scripts/bootstrap/schema-fingerprint.mjs > fingerprint.json
 */

import { Client } from "pg";

const target = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!target) {
  console.error("CONNECTION_ENV_ABSENT");
  process.exit(1);
}

const client = new Client({ connectionString: target });
await client.connect();
const q = async (sql) => (await client.query(sql)).rows;

const fingerprint = {
  objects: await q(
    `SELECT c.relname AS name, c.relkind AS kind FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S') AND c.relname <> '_prisma_migrations'
     ORDER BY c.relname`
  ),
  columns: await q(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
     ORDER BY table_name, column_name`
  ),
  enums: await q(
    `SELECT t.typname, e.enumlabel, e.enumsortorder FROM pg_type t
     JOIN pg_enum e ON e.enumtypid = t.oid
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' ORDER BY t.typname, e.enumsortorder`
  ),
  indexes: await q(
    `SELECT tablename, indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
     ORDER BY tablename, indexname`
  ),
  constraints: await q(
    `SELECT conrelid::regclass::text AS relation, conname, contype, pg_get_constraintdef(oid) AS definition
     FROM pg_constraint
     WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text <> '_prisma_migrations'
     ORDER BY relation, conname`
  ),
};

console.log(JSON.stringify(fingerprint, null, 2));
await client.end();
