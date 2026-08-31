const PREFIX = "[ML-ACQUISITION-TRACE]";

const SENSITIVE_KEY =
  /token|cookie|authorization|auth|secret|password|bearer|apikey|api[_-]?key/i;

export type MlTraceTerminal =
  | "SUCCESS"
  | "EMPTY_VALID"
  | "BLOCKED"
  | "ERROR"
  | "TIMEOUT"
  | "ABORTED";

export type MlTracePhase =
  | "ENTRY"
  | "QUERY_PLAN"
  | "SOURCE_START"
  | "SOURCE_END"
  | "HYDRATION_BATCH_START"
  | "HYDRATION_ITEM"
  | "HYDRATION_BATCH_END"
  | "CANDIDATES"
  | "CATALOG_RANK_START"
  | "CATALOG_RANK_END"
  | "EXIT";

export function isMlDiagnosticTraceEnabled(): boolean {
  const value = process.env.ML_DIAGNOSTIC_TRACE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY.test(key)) {
    return "[redacted]";
  }

  if (typeof value === "string" && SENSITIVE_KEY.test(value)) {
    return "[redacted]";
  }

  return value;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => formatValue(item)).join(",")}]`;
  }

  if (typeof value === "string") {
    if (value.includes(" ") || value.includes("=") || value.includes('"')) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return value;
  }

  return String(value);
}

export function traceMlAcquisition(
  phase: MlTracePhase,
  fields: Record<string, unknown> = {},
): void {
  if (!isMlDiagnosticTraceEnabled()) {
    return;
  }

  const serialized = Object.entries(fields)
    .map(([key, value]) => [key, sanitizeValue(key, value)] as const)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ");

  console.info(
    serialized ? `${PREFIX} ${phase} ${serialized}` : `${PREFIX} ${phase}`,
  );
}

export function traceMlSourceStart(
  source: string,
  fields: Record<string, unknown> = {},
): void {
  traceMlAcquisition("SOURCE_START", { source, ...fields });
}

export function traceMlSourceEnd(
  source: string,
  terminal: MlTraceTerminal,
  fields: Record<string, unknown> = {},
): void {
  traceMlAcquisition("SOURCE_END", { source, terminal, ...fields });
}
