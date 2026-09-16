export function isExplicitlyEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function isCatalogPopulateEnabled(
  value = process.env.CATALOG_POPULATE_ENABLED,
): boolean {
  return isExplicitlyEnabled(value);
}

export function isImportQueueProcessEnabled(
  value = process.env.IMPORT_QUEUE_PROCESS_ENABLED,
): boolean {
  return isExplicitlyEnabled(value);
}

export function isPublicSearchPersistenceEnabled(
  value = process.env.PUBLIC_SEARCH_PERSISTENCE_ENABLED,
): boolean {
  return isExplicitlyEnabled(value);
}
