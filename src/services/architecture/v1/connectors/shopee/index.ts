/**
 * CATALOG_ARCHITECTURE_V1 — REGISTRO DINAMICO DO CONECTOR (FASE 8 / FASE D).
 *
 * FASE D: o segundo marketplace entra pela arquitetura DINAMICA. Nao existe
 * `if marketplace === "SHOPEE"` no core. O marketplace ja e conhecido pelo
 * registry (marketplaceId canonico "shopee"); este modulo apenasFabrica o
 * conector a partir da CONFIGURACAO (palavras-chave), e o registry decide
 * identidade/capacidades.
 *
 * Para adicionar o marketplace no 3 basta: um connector + configuracao +
 * fixtures + testes. Nenhuma alteracao no nucleo.
 */

import {
  ShopeeMarketplaceConnector,
  SHOPEE_MARKETPLACE_ID,
} from "./shopeeConnector";
import type { ConnectorCapabilities, MarketplaceConnector } from "../../types/connector";
import { getMarketplaceConfig } from "../../marketplaceRegistry";

export { ShopeeMarketplaceConnector, SHOPEE_MARKETPLACE_ID, ShopeeConnectorError } from "./shopeeConnector";
export type { ShopeeOfferNodeV1, ShopeeConnectorOptions } from "./shopeeConnector";

/**
 * Palavras-chave de coleta vindas do ambiente, para que a configuracao
 * NAO exija recompilar: a lista e dado operacional, nao codigo.
 */
export function readShopeeKeywordsFromEnv(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return (env.SHOPEE_SHADOW_KEYWORDS ?? "")
    .split(",")
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0);
}

/**
 * Constroi o conector. As capacidades NAO sao definidas aqui: vem do
 * registry, para que a fonte e o catalogo nunca discordem sobre o que a
 * Shopee suporta.
 */
export function createShopeeConnector(options: {
  keywords?: string[];
  pageSize?: number;
  now?: () => string;
  fetchImpl?: typeof fetch;
}): MarketplaceConnector {
  const keywords =
    options.keywords && options.keywords.length > 0
      ? options.keywords
      : readShopeeKeywordsFromEnv();

  const connector = new ShopeeMarketplaceConnector({
    keywords,
    pageSize: options.pageSize,
    now: options.now,
    fetchImpl: options.fetchImpl,
  });

  const registryEntry = getMarketplaceConfig(connector.marketplaceId);
  if (!registryEntry) {
    throw new Error(
      `Marketplace "${connector.marketplaceId}" nao esta no registry V1. ` +
        "Registre antes de criar o conector (FASE D).",
    );
  }

  // Guarda de consistencia: o que a fonte REALMENTE expoe e o que o
  // catalogo acredita. Divergencia e erro de integracao, nao partida silenciosa.
  assertCapabilitiesMatchSource(connector.capabilities, registryEntry.capabilities);

  return connector;
}

/**
 * O conector pode ser MAIS restritivo que o registry (a API pode nao expor
 * algo que a plataforma suporta), mas nunca MAIS permissivo: afirmar uma
 * capacidade que a fonte nao devolve faria o nucleo tomar decisao com dado
 * inexistente.
 */
function assertCapabilitiesMatchSource(
  source: ConnectorCapabilities,
  declared: ConnectorCapabilities,
): void {
  const keys = Object.keys(source) as Array<keyof ConnectorCapabilities>;
  for (const key of keys) {
    if (source[key] && !declared[key]) {
      throw new Error(
        `Capacidade "${key}" declarada pelo conector e nao suportada pelo ` +
          `registry para "${SHOPEE_MARKETPLACE_ID}".`,
      );
    }
  }
}
