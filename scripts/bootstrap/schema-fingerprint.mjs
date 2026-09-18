/**
 * Extrai um fingerprint determinístico do schema public (somente metadados,
 * sem dados) para comparar dois bancos. Ignora a tabela interna
 * `_prisma_migrations` e seus tipos associados.
 *
 * Uso:
 *   DIRECT_URL=... node scripts/bootstrap/schema-fingerprint.mjs > fingerprint.json
 */

import { Client } from "pg";
import { validateLocalTarget, assertLocalConnection } from "./local-supabase-compatibility.mjs";

const target = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!target) {
  console.error("CONNECTION_ENV_ABSENT");
  process.exit(1);
}

validateLocalTarget(target);
const client = new Client({ connectionString: target });
await client.connect();
await assertLocalConnection(client, target);
await client.query("BEGIN TRANSACTION READ ONLY");
const q = async (sql) => (await client.query(sql)).rows;

const fingerprint = {
  objects: await q(
    `SELECT c.relname AS name, c.relkind AS kind FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S') AND c.relname <> '_prisma_migrations'
     ORDER BY c.relname`
  ),
  columns: await q(
    `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale, datetime_precision
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
  rls: await q(`SELECT c.relname AS table_name,c.relrowsecurity,c.relforcerowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`),
  policies: await q(`SELECT tablename,policyname,permissive,roles::text[] AS roles,cmd,qual,with_check
    FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname`),
  grants: await q(`SELECT c.relname AS table_name, CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,
    pg_get_userbyid(a.grantor) AS grantor,a.privilege_type,a.is_grantable
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
    ORDER BY table_name,grantee,privilege_type`),
  defaultPrivileges: await q(`SELECT pg_get_userbyid(d.defaclrole) AS owner,n.nspname AS schema,d.defaclobjtype AS object_type,
    CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END AS grantee,a.privilege_type,a.is_grantable
    FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    ORDER BY owner,schema,object_type,grantee,privilege_type`),
  localRoles: await q(`SELECT rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
    FROM pg_roles WHERE rolname IN ('anon','authenticated') ORDER BY rolname`),
  authFunctions: await q(`SELECT p.proname,p.prosrc,p.prosecdef,p.provolatile,p.proconfig,pg_get_function_result(p.oid) AS result
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='auth' ORDER BY p.proname`),

};

console.log(JSON.stringify(fingerprint, null, 2));
await client.query("ROLLBACK");
await client.end();
