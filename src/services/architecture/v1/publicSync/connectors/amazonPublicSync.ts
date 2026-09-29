/**
 * CATALOG V1 — AMAZON PUBLIC SYNC CONFIG (FASE 11).
 *
 * Factory que devolve a configuração completa para o runner genérico
 * runMarketplacePublicSync. Não contém lógica de negócio — só fio.
 *
 * O core NUNCA vê "amazon" hardcoded.
 */
import { createAmazonConnector, type AmazonConnectorOptions } from "@/services/architecture/v1/connectors/amazonConnector";
import { AMAZON_PURCHASE_LINKS } from "./amazonPurchaseLinks";
import type { PublicSyncConfig } from "@/services/architecture/v1/publicSync/types";

/** Palavras-chave de descoberta — termos que alcançam bindings certificadas conhecidas. */
export const AMAZON_DEFAULT_KEYWORDS = [
  "carregador 20w iphone tipo c",
  "fone xiaomi redmi buds",
  "mouse sem fio logitech",
] as const;

/** Teto de descoberta por execução (canário conservador). */
export const AMAZON_DISCOVERY_LIMIT = 20;

/**
 * Monta a configuração do runner para a Amazon.
 * `maxListings` é o teto de canário desta execução.
 */
export function amazonPublicSyncConfig(options: {
  keywords?: readonly string[];
  maxListings: number;
  brandLexicon: ReadonlySet<string>;
  limit?: number;
}): PublicSyncConfig {
  const connectorOptions: AmazonConnectorOptions = {
    keywords: [...(options.keywords ?? AMAZON_DEFAULT_KEYWORDS)],
    limit: options.limit ?? AMAZON_DISCOVERY_LIMIT,
  };
  const connector = createAmazonConnector(connectorOptions);

  return {
    marketplaceId: "amazon",
    connector,
    purchaseLinks: AMAZON_PURCHASE_LINKS,
    maxListings: options.maxListings,
    brandLexicon: options.brandLexicon,
  } satisfies PublicSyncConfig;
}