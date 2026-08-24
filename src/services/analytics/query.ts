export function normalizeAnalyticsQuery(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160)
    .toLocaleLowerCase("pt-BR");
}
