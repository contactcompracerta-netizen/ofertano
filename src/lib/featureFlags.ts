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

/*
 * CATALOG_ARCHITECTURE_V1 — flags de shadow (todas default OFF).
 *
 * A Architecture V1 pode chegar a produção em modo shadow/desligado: nenhuma
 * destas flags altera o comportamento do caminho legado até serem ligadas
 * explicitamente. A ativação é sempre por env var com valor exato "true".
 */

/** Ingestão V1 (pipeline universal com hash duplo) ativa. Default OFF. */
export function isArchitectureV1IngestionEnabled(
  value = process.env.ARCHITECTURE_V1_INGESTION_ENABLED,
): boolean {
  return isExplicitlyEnabled(value);
}

/** Persistência aditiva de catalogHash/offerHash/payloadVersion no caminho legado. Default OFF. */
export function isArchitectureV1HashPersistenceEnabled(
  value = process.env.ARCHITECTURE_V1_HASH_PERSISTENCE_ENABLED,
): boolean {
  return isExplicitlyEnabled(value);
}

/**
 * Flag composta de ativação da Architecture V1 no runtime (alta para ligar
 * ingestão OU persistência de hashes). Mantida para gates de canário e
 * observabilidade sem duplicar a regra de "true".
 */
export function isArchitectureV1RuntimeEnabled(
  valueIngestion = process.env.ARCHITECTURE_V1_INGESTION_ENABLED,
  valuePersistence = process.env.ARCHITECTURE_V1_HASH_PERSISTENCE_ENABLED,
): boolean {
  return isExplicitlyEnabled(valueIngestion) || isExplicitlyEnabled(valuePersistence);
}
