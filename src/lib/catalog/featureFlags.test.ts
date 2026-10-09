/**
 * CATALOG_WAVE 1 - FASE N/C: feature flags fail-closed.
 *
 * Sem configuração explícita: nada liga. LIVE bloqueado por flag extra.
 */
import {
  DEFAULT_CATALOG_IMPORT_FLAGS,
  readCatalogImportFlags,
  isAnalysisEnabled,
  isWriteEnabled,
  isLiveEnabled,
  assertWriteAllowed,
  CatalogDisabledError,
  CatalogWriteBlockedError,
  LiveModeBlockedError,
} from "./featureFlags";
import type { CatalogImportFlags } from "./featureFlags";

let passed = 0;
function ok(cond: boolean, label: string): void {
  if (!cond) {
    throw new Error(`FAIL: ${label}`);
  }
  passed += 1;
}
function expectThrows(fn: () => unknown, matches: (err: unknown) => boolean, label: string): void {
  try {
    fn();
  } catch (err) {
    ok(matches(err), `${label} => erro esperado (${err instanceof Error ? err.name : String(err)})`);
    return;
  }
  throw new Error(`FAIL: ${label} deveria lançar`);
}
function expectNoThrow(fn: () => unknown, label: string): void {
  try {
    fn();
  } catch (err) {
    throw new Error(`FAIL: ${label} não deveria lançar: ${String(err)}`);
  }
  passed += 1;
}

/* --- Defaults fail-closed --------------------------------------------- */
const empty = readCatalogImportFlags({});
ok(empty.catalogImportEnabled === false, "CATALOG_IMPORT_ENABLED default false");
ok(empty.awinWave1Enabled === false, "AWIN_WAVE1_ENABLED default false");
ok(empty.awinWave1WriteEnabled === false, "AWIN_WAVE1_WRITE_ENABLED default false");
ok(empty.awinWave1LiveEnabled === false, "AWIN_WAVE1_LIVE_ENABLED default false");
ok(empty.mode === "DISABLED", "CATALOG_IMPORT_MODE default DISABLED");
ok(!isAnalysisEnabled(empty), "análise OFF por padrão");
ok(!isWriteEnabled(empty), "escrita OFF por padrão");
ok(!isLiveEnabled(empty), "LIVE OFF por padrão");

/* --- Defaults globais congelados e OFF -------------------------------- */
ok(Object.isFrozen(DEFAULT_CATALOG_IMPORT_FLAGS), "defaults congelados");
ok(
  DEFAULT_CATALOG_IMPORT_FLAGS.mode === "DISABLED" &&
    !DEFAULT_CATALOG_IMPORT_FLAGS.catalogImportEnabled &&
    !DEFAULT_CATALOG_IMPORT_FLAGS.awinWave1Enabled &&
    !DEFAULT_CATALOG_IMPORT_FLAGS.awinWave1WriteEnabled &&
    !DEFAULT_CATALOG_IMPORT_FLAGS.awinWave1LiveEnabled,
  "DEFAULT_CATALOG_IMPORT_FLAGS tudo OFF",
);

/* --- Leitura estrita --------------------------------------------------- */
ok(
  readCatalogImportFlags({ CATALOG_IMPORT_ENABLED: "true" }).catalogImportEnabled ===
    true,
  '"true" liga',
);
ok(
  readCatalogImportFlags({ CATALOG_IMPORT_ENABLED: "TRUE" }).catalogImportEnabled ===
    true,
  '"TRUE" liga (case-insensitive)',
);
ok(
  readCatalogImportFlags({ CATALOG_IMPORT_ENABLED: "1" }).catalogImportEnabled ===
    false,
  '"1" NÃO liga (apenas true)',
);
ok(
  readCatalogImportFlags({ CATALOG_IMPORT_ENABLED: "yes" }).catalogImportEnabled ===
    false,
  '"yes" NÃO liga',
);
ok(
  readCatalogImportFlags({ CATALOG_IMPORT_MODE: "dry_run" }).mode === "DRY_RUN",
  "dry_run aceito (normalizado)",
);
ok(
  readCatalogImportFlags({ CATALOG_IMPORT_MODE: "BOGUS" }).mode === "DISABLED",
  "modo inválido => DISABLED",
);
ok(
  readCatalogImportFlags({ CATALOG_IMPORT_MODE: "live" }).mode === "LIVE",
  "live aceito",
);

/* --- Matriz de escrita -------------------------------------------------- */
const analysisOnly: CatalogImportFlags = {
  catalogImportEnabled: true,
  awinWave1Enabled: true,
  awinWave1StagingWriteEnabled: false,
  awinWave1WriteEnabled: false,
  awinWave1LiveEnabled: false,
  mode: "DRY_RUN",
};
ok(isAnalysisEnabled(analysisOnly), "DRY_RUN com flags base ON => análise ON");
ok(!isWriteEnabled(analysisOnly), "DRY_RUN nunca escreve");

const canaryWrite: CatalogImportFlags = {
  ...analysisOnly,
  awinWave1WriteEnabled: true,
  mode: "CANARY",
};
ok(isWriteEnabled(canaryWrite), "CANARY + write ON => escrita ON");
ok(!isLiveEnabled(canaryWrite), "CANARY não é LIVE");
expectNoThrow(() => assertWriteAllowed(canaryWrite), "assertWriteAllowed CANARY completo");

const liveNoFlag: CatalogImportFlags = { ...canaryWrite, mode: "LIVE" };
ok(isWriteEnabled(liveNoFlag), "LIVE é modo de escrita...");
ok(!isLiveEnabled(liveNoFlag), "...mas LIVE sem flag extra segue bloqueado");
expectThrows(
  () => assertWriteAllowed(liveNoFlag),
  (e) => e instanceof LiveModeBlockedError,
  "LIVE sem AWIN_WAVE1_LIVE_ENABLED",
);

const liveFull: CatalogImportFlags = {
  ...liveNoFlag,
  awinWave1LiveEnabled: true,
};
ok(isLiveEnabled(liveFull), "LIVE com flag extra ON");

const flagsOff: CatalogImportFlags = {
  catalogImportEnabled: false,
  awinWave1Enabled: false,
  awinWave1StagingWriteEnabled: false,
  awinWave1WriteEnabled: true,
  awinWave1LiveEnabled: true,
  mode: "CANARY",
};
expectThrows(
  () => assertWriteAllowed(flagsOff),
  (e) => e instanceof CatalogDisabledError,
  "flags base OFF",
);

const writeOff: CatalogImportFlags = {
  catalogImportEnabled: true,
  awinWave1Enabled: true,
  awinWave1StagingWriteEnabled: false,
  awinWave1WriteEnabled: false,
  awinWave1LiveEnabled: false,
  mode: "CANARY",
};
ok(!isWriteEnabled(writeOff), "writeEnabled false => sem escrita");
expectThrows(
  () => assertWriteAllowed(writeOff),
  (e) => e instanceof CatalogWriteBlockedError,
  "CANARY sem AWIN_WAVE1_WRITE_ENABLED",
);

console.log(`featureFlags.test.ts PASS (${passed} asserções)`);
