/** AUDITORIA DE RUNTIME MAGALU — READ ONLY. Nao infere PublicSync de cutover. */
import {
  authorizePublicSync,
  getEffectiveMode,
  isCronSyncAllowed,
  PUBLIC_SYNC_CRON_ALLOWLIST,
  PUBLIC_SYNC_SUPPORTED_SOURCES,
} from "../services/architecture/v1/publicSync/flags";

async function main() {
  const env = { ...process.env } as Record<string, string | undefined>;
  const id = "magazine_luiza";
  const eff = getEffectiveMode(id, env);
  const auth = authorizePublicSync(id, PUBLIC_SYNC_SUPPORTED_SOURCES, env);

  console.log(`MAGALU_STATIC_MODE=${PUBLIC_SYNC_SUPPORTED_SOURCES[id]?.mode}`);
  console.log(`MAGALU_EFFECTIVE_MODE=${eff.runtimeMode}`);
  console.log(`MAGALU_PUBLIC_SYNC_AUTHORIZED=${auth.authorized}${auth.authorized ? "" : ` reason=${auth.reason}`}`);
  console.log(`MAGALU_ENV_PRESENT=${Boolean(env.PUBLIC_SYNC_MODE_MAGAZINE_LUIZA)} value=${env.PUBLIC_SYNC_MODE_MAGAZINE_LUIZA ?? "<ausente>"}`);
  console.log(`MAGALU_IN_CRON_ALLOWLIST=${isCronSyncAllowed(id)} (allowlist=${[...PUBLIC_SYNC_CRON_ALLOWLIST].join(",")})`);
  console.log(`GLOBAL_CUTOVER_ENV=${env.CATALOG_V1_GLOBAL_CUTOVER ?? "<ausente>"}  <- NAO usado para PublicSync`);

  // Existe algum caminho legado de refresh para Magalu?
  const { LEGACY_PUBLIC_MARKETPLACES } = await import(
    "../services/architecture/v1/rolloutStatus"
  );
  console.log(`MAGALU_LEGACY_WRITER_DECLARED=${LEGACY_PUBLIC_MARKETPLACES.has(id)}`);

  // Cron agendado de verdade?
  const { readFile } = await import("node:fs/promises");
  const vj = JSON.parse(await readFile("vercel.json", "utf8"));
  // Entradas podem ser string ou {path, schedule}. Normalizar antes de
  // filtrar: assumir string fez a auditoria reportar "sem cron" para uma fonte
  // que TEM cron, que é o tipo de erro que leva a "corrigir" o que está certo.
  type CronEntry = { path: string; schedule: string };
  const crons: CronEntry[] = ((vj.crons ?? []) as unknown[]).map((c) =>
    typeof c === "string"
      ? { path: c, schedule: "?" }
      : (c as CronEntry),
  );
  const mag = crons.filter((c: CronEntry) => /magalu|magazine/i.test(c.path));
  console.log(`MAGALU_CRON_REGISTERED=${mag.length > 0}`);
  for (const c of mag) console.log(`  CRON=${c.schedule}  ${c.path}`);
  console.log(`CRONS_TOTAL=${crons.length}`);
  for (const c of crons) {
    if (/marketplace-sync/.test(c.path)) console.log(`  SYNC_CRON=${c.path}`);
  }
}
main().catch((e) => { console.error("FALHOU:", e instanceof Error ? e.message : e); process.exit(1); });
