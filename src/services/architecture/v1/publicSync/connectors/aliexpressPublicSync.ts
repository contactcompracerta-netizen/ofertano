/**
 * CATALOG V1 — ALIEXPRESS PUBLIC SYNC CONFIG (FASE 12).
 *
 * Factory que devolve a configuração completa para o runner genérico
 * `runMarketplacePublicSync`. Não contém lógica de negócio — só fio.
 *
 * O core NUNCA vê "aliexpress" hardcoded: `marketplaceId` entra aqui como
 * configuracao e a autorizacao e resolvida por `authorizePublicSync`.
 */
import {
  createAliExpressConnector,
  type AliExpressConnectorOptions,
} from "@/services/architecture/v1/connectors/aliexpressConnector";
import { ALIEXPRESS_PURCHASE_LINKS } from "./aliexpressPurchaseLinks";
import type { PublicSyncConfig } from "@/services/architecture/v1/publicSync/types";

/**
 * Palavras-chave de descoberta.
 *
 * O discovery legado (`buscarAliExpress`) já é muito restritivo: descarta
 * acessório não pedido, condição não-nova, bundle não pedido, marca
 * incompatível e variante incompatível antes de devolver candidato. As
 * keywords aqui são genéricas de propósito — o filtro é o legacy, não a
 * keyword.
 */
export const ALIEXPRESS_DEFAULT_KEYWORDS = [
  "fone de ouvido bluetooth",
  "carregador usb c",
  "capa celular",
] as const;

/** Teto de descoberta por execução (canário conservador). */
export const ALIEXPRESS_DISCOVERY_LIMIT = 20;

/**
 * Monta a configuração do runner para o AliExpress.
 * `maxListings` é o teto de canário desta execução.
 */
export function aliExpressPublicSyncConfig(options: {
  keywords?: readonly string[];
  maxListings: number;
  brandLexicon: ReadonlySet<string>;
  limit?: number;
}): PublicSyncConfig {
  const connectorOptions: AliExpressConnectorOptions = {
    keywords: [...(options.keywords ?? ALIEXPRESS_DEFAULT_KEYWORDS)],
    limit: options.limit ?? ALIEXPRESS_DISCOVERY_LIMIT,
  };
  const connector = createAliExpressConnector(connectorOptions);

  return {
    marketplaceId: "aliexpress",
    connector,
    purchaseLinks: ALIEXPRESS_PURCHASE_LINKS,
    maxListings: options.maxListings,
    brandLexicon: options.brandLexicon,
  } satisfies PublicSyncConfig;
}
