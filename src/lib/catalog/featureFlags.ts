/**
 * CATALOG_WAVE 1 - feature flags FAIL-CLOSED (FASE C).
 *
 * Sem configuração explícita, nada acontece. Mesmo em produção:
 * todos os defaults são OFF / DISABLED.
 *
 * Flags:
 *   CATALOG_IMPORT_ENABLED     = false
 *   AWIN_WAVE1_ENABLED         = false
 *   AWIN_WAVE1_STAGING_WRITE_ENABLED = false
 *   AWIN_WAVE1_WRITE_ENABLED   = false
 *   CATALOG_IMPORT_MODE        = DISABLED
 *   AWIN_WAVE1_LIVE_ENABLED    = false   (flag adicional que bloqueia LIVE)
 */
import type { CatalogImportMode } from "./types";

export interface CatalogImportFlags {
  catalogImportEnabled: boolean;
  awinWave1Enabled: boolean;
  /** Permite escrita APENAS na tabela de staging durante SHADOW. */
  awinWave1StagingWriteEnabled: boolean;
  awinWave1WriteEnabled: boolean;
  /** Flag extra: LIVE exige ativação explícita adicional. */
  awinWave1LiveEnabled: boolean;
  mode: CatalogImportMode;
}

const MODES: readonly CatalogImportMode[] = [
  "DISABLED",
  "DRY_RUN",
  "SHADOW",
  "CANARY",
  "LIVE",
];

function readBool(value: string | undefined): boolean {
  // Só "true" (case-insensitive) liga. Qualquer outra coisa = OFF.
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

function readMode(value: string | undefined): CatalogImportMode {
  const v = (value ?? "").trim().toUpperCase();
  return (MODES as readonly string[]).includes(v)
    ? (v as CatalogImportMode)
    : "DISABLED";
}

/** Flags vindas do ambiente. Ausência total => tudo OFF (fail-closed). */
export function readCatalogImportFlags(
  env: Record<string, string | undefined> = process.env,
): CatalogImportFlags {
  return {
    catalogImportEnabled: readBool(env.CATALOG_IMPORT_ENABLED),
    awinWave1Enabled: readBool(env.AWIN_WAVE1_ENABLED),
    awinWave1StagingWriteEnabled: readBool(env.AWIN_WAVE1_STAGING_WRITE_ENABLED),
    awinWave1WriteEnabled: readBool(env.AWIN_WAVE1_WRITE_ENABLED),
    awinWave1LiveEnabled: readBool(env.AWIN_WAVE1_LIVE_ENABLED),
    mode: readMode(env.CATALOG_IMPORT_MODE),
  };
}

/** Defaults globais: OFF. Importar este valor nunca liga nada. */
export const DEFAULT_CATALOG_IMPORT_FLAGS: CatalogImportFlags = Object.freeze({
  catalogImportEnabled: false,
  awinWave1Enabled: false,
  awinWave1StagingWriteEnabled: false,
  awinWave1WriteEnabled: false,
  awinWave1LiveEnabled: false,
  mode: "DISABLED" as const,
});

export class CatalogDisabledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogDisabledError";
  }
}

export class CatalogWriteBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogWriteBlockedError";
  }
}

export class LiveModeBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveModeBlockedError";
  }
}

/** Pode executar análise (dry-run/plan)? Exige os dois flags base ON. */
export function isAnalysisEnabled(flags: CatalogImportFlags): boolean {
  return flags.catalogImportEnabled && flags.awinWave1Enabled;
}

/**
 * Pode ESCREVER no catálogo?
 * Exige: análise ON + write ON + modo CANARY ou LIVE.
 */
export function isWriteEnabled(flags: CatalogImportFlags): boolean {
  return (
    isAnalysisEnabled(flags) &&
    flags.awinWave1WriteEnabled &&
    (flags.mode === "CANARY" || flags.mode === "LIVE")
  );
}

/**
 * Pode executar em LIVE?
 * LIVE exige a flag adicional AWIN_WAVE1_LIVE_ENABLED (bloqueado por padrão).
 */
export function isLiveEnabled(flags: CatalogImportFlags): boolean {
  return isWriteEnabled(flags) && flags.mode === "LIVE" && flags.awinWave1LiveEnabled;
}

/** Lança se qualquer tentativa de escrita violar as flags. */
export function assertWriteAllowed(flags: CatalogImportFlags): void {
  if (!isAnalysisEnabled(flags)) {
    throw new CatalogDisabledError(
      "CATALOG_IMPORT: análise bloqueada (CATALOG_IMPORT_ENABLED/AWIN_WAVE1_ENABLED OFF)",
    );
  }
  if (flags.mode === "LIVE" && !flags.awinWave1LiveEnabled) {
    throw new LiveModeBlockedError(
      "CATALOG_IMPORT: modo LIVE bloqueado (AWIN_WAVE1_LIVE_ENABLED OFF)",
    );
  }
  if (!isWriteEnabled(flags)) {
    throw new CatalogWriteBlockedError(
      "CATALOG_IMPORT: escrita bloqueada (flags fail-closed)",
    );
  }
}
