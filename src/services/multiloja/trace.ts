const PREFIX = "[MULTILOJA-TRACE]";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return `[${value.join(",")}]`;
  }

  if (typeof value === "string") {
    if (value.includes(" ") || value.includes("=") || value.includes('"')) {
      return `"${value.replace(/"/g, '\\"')}"`;
    }

    return value;
  }

  return String(value);
}

export function traceMultiloja(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const serialized = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(" ");

  console.info(
    serialized
      ? `${PREFIX} ${event} ${serialized}`
      : `${PREFIX} ${event}`,
  );
}
