/**
 * Bootstrap versionado de banco FRESH para o Ofertano.
 *
 * Problema: a cadeia histórica de migrations não roda em um banco vazio
 * (20260905120000_price_alerts assume objetos legados). A solução é aplicar
 * o DDL canônico pinado (initial-schema.sql), resolver APENAS as 7 migrations baseline como
 * aplicadas; executar migrations forward com migrate deploy e validar equivalência de schema.
 *
 * Contrato de classificação (fail-closed):
 *   A FRESH     -> banco vazio: aplica DDL + resolve + deploy + valida.
 *   B MIGRATED  -> banco canônico já migrado: NO-OP seguro.
 *   C PARTIAL   -> migrations parciais/incompletas: ABORTA.
 *   D UNKNOWN   -> schema não reconhecido / alvo não descartável: RECUSA.
 *
 * Guardas de segurança (hard tripwire):
 *   - host deve ser 127.0.0.1 e porta 55433 (nunca 55432).
 *   - nome do banco deve estar na allowlist descartável.
 *   - manifest.json precisa bater com schema.prisma e migrations.
 *
 * Uso:
 *   node scripts/bootstrap/fresh-bootstrap.mjs            # executa
 *   node scripts/bootstrap/fresh-bootstrap.mjs --check    # só classifica
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { validateLocalTarget, scaffoldLocalSupabase, localEquivalenceSchema, verifyLocalRls } from "./local-supabase-compatibility.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(HERE, "manifest.json"), "utf8"));
const DDL = fs.readFileSync(path.join(HERE, "initial-schema.sql"));
const SCHEMA_PATH = path.join(ROOT, "prisma/schema.prisma");
const PRISMA_CLI = path.join(ROOT, "node_modules/prisma/build/index.js");

const CHECK_MODE = process.argv.includes("--check") || process.argv.includes("--dry-run");
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");


function result(verdict, category, detail) {
  console.log(JSON.stringify({ verdict, category, dryRun: CHECK_MODE, ...detail }));
  process.exitCode = verdict === "PASS" || verdict === "NOOP" ? 0 : 1;
}

function abort(code, extra = {}) {
  result("BLOCKED", extra.category ?? "UNKNOWN", { error: code, ...extra });
  throw new Error(code);
}

function verifyManifest() {
  if (Object.keys(MANIFEST.baselineMigrations ?? {}).length !== 7) abort("BOOTSTRAP_MANIFEST_DIVERGED", {artifact:"immutable baseline inventory"});
  if (MANIFEST.version !== 3) abort("BOOTSTRAP_MANIFEST_DIVERGED");
  if (sha256(fs.readFileSync(path.join(HERE, "local-legacy-tables.sql"))) !== MANIFEST.localCompatibility?.legacyTablesSQLSHA256) abort("BOOTSTRAP_MANIFEST_DIVERGED", { artifact: "local compatibility DDL" });
  const forwardNames = Object.keys(MANIFEST.forwardMigrations);
  if (JSON.stringify(forwardNames) !== JSON.stringify([...forwardNames].sort())) abort("BOOTSTRAP_MANIFEST_DIVERGED", { artifact: "forward order" });
  const tracked = Object.keys({...MANIFEST.baselineMigrations, ...MANIFEST.forwardMigrations}).sort();
  const actual = fs.readdirSync(path.join(ROOT, "prisma/migrations")).filter(n => fs.existsSync(path.join(ROOT, "prisma/migrations", n, "migration.sql"))).sort();
  if (JSON.stringify(tracked) !== JSON.stringify(actual)) abort("BOOTSTRAP_MANIFEST_DIVERGED", { artifact: "migration inventory" });
  if (Object.keys(MANIFEST.forwardMigrations).some(n => n <= Object.keys(MANIFEST.baselineMigrations).sort().at(-1))) abort("BOOTSTRAP_MANIFEST_DIVERGED", {artifact: "migration order"});
  if (sha256(DDL) !== MANIFEST.baselineDDLHash) abort("BOOTSTRAP_MANIFEST_DIVERGED", { artifact: "initial-schema.sql" });
  if (sha256(fs.readFileSync(SCHEMA_PATH)) !== MANIFEST.currentSchemaSHA256) abort("BOOTSTRAP_MANIFEST_DIVERGED", { artifact: "schema.prisma" });
  for (const [name, sum] of Object.entries({...MANIFEST.baselineMigrations, ...MANIFEST.forwardMigrations})) {
    const file = path.join(ROOT, "prisma/migrations", name, "migration.sql");
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== sum) {
      abort("HISTORICAL_CHECKSUM_DIVERGED", { migration: name });
    }
  }
}

function resolveTarget() {
  const target = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!target) abort("CONNECTION_ENV_ABSENT", { category: "D" });
  try { validateLocalTarget(target); } catch (error) { abort(error.message, { category: "D" }); }
  return target;
}

function runPrisma(args, target) {
  const proc = spawnSync(process.execPath, [PRISMA_CLI, ...args], {
    cwd: ROOT,
    env: { ...process.env, DIRECT_URL: target, DATABASE_URL: target, DOTENV_CONFIG_PATH: "/dev/null" },
    encoding: "utf8",
    timeout: 180000,
  });
  return { status: proc.status, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

function requirePrisma(args, target) {
  const out = runPrisma(args, target);
  if (out.status !== 0) {
    abort(`PRISMA_STEP_FAILED_${args.join("_").toUpperCase()}`, { category: "C", stderr: out.stderr.trim().slice(0, 800) });
  }
  return out;
}

async function classify(client) {
  const relations = await client.query(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S') AND c.relname <> '_prisma_migrations'`
  );
  const types = await client.query(
    `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'`
  );
  const ledger = await client.query(
    `SELECT to_regclass('public."_prisma_migrations"') IS NOT NULL AS present`
  );
  let rows = [];
  if (ledger.rows[0].present) {
    rows = (
      await client.query(
        `SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at`
      )
    ).rows;
  }
  const expected = {...MANIFEST.baselineMigrations, ...MANIFEST.forwardMigrations};
  const expectedNames = Object.keys(expected);
  const emptySchema = relations.rowCount === 0 && types.rowCount === 0;
  if (emptySchema && rows.length === 0) {
    return { category: "A", detail: { relations: 0, types: 0, migrations: 0 } };
  }
  const migratedCanonical =
    rows.length === expectedNames.length &&
    rows.every((r) => expected[r.migration_name] === r.checksum && r.finished_at && !r.rolled_back_at) &&
    new Set(rows.map((r) => r.migration_name)).size === expectedNames.length;
  if (migratedCanonical && !emptySchema) {
    return { category: "B", detail: { relations: relations.rowCount, types: types.rowCount, migrations: rows.length } };
  }
  if (rows.length > 0) {
    return {
      category: "C",
      detail: {
        relations: relations.rowCount,
        types: types.rowCount,
        migrations: rows.length,
        mismatched: rows.filter((r) => !expected[r.migration_name] || expected[r.migration_name] !== r.checksum).map((r) => r.migration_name),
      },
    };
  }
  return { category: "D", detail: { relations: relations.rowCount, types: types.rowCount, migrations: 0 } };
}

async function bootstrapFresh(client, target) {
  await client.query("BEGIN");
  try {
    await client.query(DDL.toString());
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    abort("DDL_APPLY_FAILED", { category: "A", reason: String(error.message).slice(0, 400) });
  }
  for (const name of Object.keys(MANIFEST.baselineMigrations)) {
    requirePrisma(["migrate", "resolve", "--applied", name], target);
  }
}

async function checkEquivalence(client, target, category) {
  const schema = localEquivalenceSchema(SCHEMA_PATH);
  try {
    const diff = runPrisma(["migrate", "diff", "--from-config-datasource", "--to-schema", schema.file, "--exit-code"], target);
    if (diff.status === 2) abort("SCHEMA_DIVERGENCE_DETECTED", { category });
    if (diff.status !== 0) abort("SCHEMA_DIFF_ERROR", { category, stderr: diff.stderr.trim().slice(0, 800) });
    await verifyLocalRls(client, target);
  } finally { schema.cleanup(); }
}

function deployAndStatus(target) {
  requirePrisma(["migrate", "deploy"], target);
  requirePrisma(["migrate", "status"], target);
}

async function main() {
  verifyManifest();
  const target = resolveTarget();
  const client = new Client({ connectionString: target });
  try {
    await client.connect();
    if (client.connection.stream.remoteAddress !== "127.0.0.1" || client.connection.stream.remotePort !== 55433) {
      abort("LOCAL_SOCKET_DIVERGED", { category: "D" });
    }
    await client.query("SELECT pg_advisory_lock(hashtext($1))", ["ofertano-versioned-fresh-bootstrap-v1"]);
    const { category, detail } = await classify(client);
    if (category === "A") {
      if (CHECK_MODE) {
        result("PASS", "A", { classification: "A", action: "would bootstrap", ...detail });
        return;
      }
      await bootstrapFresh(client, target);
      await scaffoldLocalSupabase(client, target);
      deployAndStatus(target);
      await checkEquivalence(client, target, "A");
      result("PASS", "A", { classification: "A", ...detail });
      return;
    }
    if (category === "B") {
      await checkEquivalence(client, target, "B");
      if (CHECK_MODE) {
        result("PASS", "B", { classification: "B", action: "already canonical", ...detail });
        return;
      }
      deployAndStatus(target);
      result("NOOP", "B", { classification: "B", message: "already migrated canonical schema", ...detail });
      return;
    }
    abort("TARGET_SCHEMA_NOT_BOOTSTRAPPABLE", { category, ...detail });
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((error) => {
  process.exitCode = 1;
  if (!/^(BOOTSTRAP_MANIFEST_DIVERGED|HISTORICAL_CHECKSUM_DIVERGED|CONNECTION_ENV_ABSENT|CONNECTION_URL_INVALID|LOCAL_TRIPWIRE_VIOLATED|TARGET_NOT_DISPOSABLE|LOCAL_SOCKET_DIVERGED|DDL_APPLY_FAILED|PRISMA_STEP_FAILED_|SCHEMA_DIVERGENCE_DETECTED|SCHEMA_DIFF_ERROR|TARGET_SCHEMA_NOT_BOOTSTRAPPABLE)/.test(error.message)) {
    console.error("VERSIONED_FRESH_BOOTSTRAP=UNEXPECTED_ERROR", /^[A-Z0-9_]+$/.test(error.message) ? error.message : "SANITIZED_ERROR");
  }
});
