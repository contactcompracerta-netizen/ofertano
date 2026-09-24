/**
 * CATALOG_ARCHITECTURE_V1 — MARKETPLACE REGISTRY (FASE E).
 *
 * Identidade de marketplace no núcleo: `marketplaceId` é a identidade INTERNA
 * estável. Nenhuma regra central usa nome exibido, domínio, URL ou vendedor.
 *
 * Este registry é o único lugar onde um marketplaceId canônico é declarado.
 * Adicionar um marketplace novo = registrar aqui + criar conector + fixtures +
 * testes de contrato. O núcleo (matching, publicação, busca, price history)
 * NÃO muda.
 *
 * Nota de compatibilidade: o schema atual persiste marketplace como enum
 * Prisma (9 valores legados). O `legacyEnumValue` mapeia o marketplaceId
 * canônico para o enum existente, permitindo o caminho legado coexistir até a
 * transição documentada em docs/architecture/MARKETPLACE_ENUM_TRANSITION.md.
 * Novos marketplaces futuros usam marketplaceId string (dinâmico) e não
 * dependem do enum. Nenhuma mudança destrutiva é feita nesta missão.
 */

import type { ConnectorCapabilities } from "./types/connector";

export interface MarketplaceConfigV1 {
  /** Identidade canônica interna (estável; nunca muda entre versões). */
  readonly marketplaceId: string;
  /** Nome exibido (nunca é identidade). */
  readonly displayName: string;
  /** Marcas de capacidade do marketplace (declaram o que a fonte suporta). */
  readonly capabilities: ConnectorCapabilities;
  /**
   * Valor do enum Prisma legado, QUANDO o marketplace já existe no enum.
   * null para marketplaces futuros ainda não persistidos no schema.
   */
  readonly legacyEnumValue: string | null;
  /** Permite que a oferta seja considerada no caminho multiloja público. */
  readonly publicEligible: boolean;
}

const DEFAULT_CAPABILITIES: ConnectorCapabilities = {
  catalog: true,
  inventory: true,
  stock: true,
  shipping: false,
  seller: true,
  variants: true,
  gtin: false,
  incrementalUpdates: false,
  fullSnapshot: true,
  webhook: false,
  pixPrice: false,
};

function capability(partial: Partial<ConnectorCapabilities>): ConnectorCapabilities {
  return { ...DEFAULT_CAPABILITIES, ...partial };
}

/**
 * Registro canônico. marketplaceId estável em lowercase_snake.
 * Este é o ÚNICO lugar da base com nomes de marketplace; o núcleo nunca os lê.
 */
export const MARKETPLACE_REGISTRY_V1: ReadonlyArray<MarketplaceConfigV1> = [
  {
    marketplaceId: "mercado_livre",
    displayName: "Mercado Livre",
    legacyEnumValue: "MERCADO_LIVRE",
    publicEligible: true,
    capabilities: capability({ gtin: false, incrementalUpdates: true, pixPrice: true }),
  },
  {
    marketplaceId: "amazon",
    displayName: "Amazon",
    legacyEnumValue: "AMAZON",
    publicEligible: true,
    capabilities: capability({ gtin: true, pixPrice: false }),
  },
  {
    marketplaceId: "shopee",
    displayName: "Shopee",
    legacyEnumValue: "SHOPEE",
    publicEligible: true,
    capabilities: capability({ gtin: false, pixPrice: false, seller: true }),
  },
  {
    marketplaceId: "magazine_luiza",
    displayName: "Magazine Luiza",
    legacyEnumValue: "MAGAZINE_LUIZA",
    publicEligible: true,
    capabilities: capability({ gtin: true, pixPrice: true }),
  },
  {
    marketplaceId: "casas_bahia",
    displayName: "Casas Bahia",
    legacyEnumValue: "CASAS_BAHIA",
    publicEligible: true,
    capabilities: capability({ gtin: true, pixPrice: true }),
  },
  {
    marketplaceId: "kabum",
    displayName: "Kabum",
    legacyEnumValue: "KABUM",
    publicEligible: true,
    capabilities: capability({ gtin: true, pixPrice: true }),
  },
  {
    marketplaceId: "terabyte",
    displayName: "Terabyte",
    legacyEnumValue: "TERABYTE",
    publicEligible: true,
    capabilities: capability({ gtin: false, pixPrice: true }),
  },
  {
    marketplaceId: "aliexpress",
    displayName: "AliExpress",
    legacyEnumValue: "ALIEXPRESS",
    publicEligible: true,
    capabilities: capability({ gtin: false, pixPrice: false, stock: false }),
  },
  {
    marketplaceId: "carrefour",
    displayName: "Carrefour",
    legacyEnumValue: "CARREFOUR",
    publicEligible: true,
    capabilities: capability({ gtin: true, pixPrice: true }),
  },
];

const REGISTRY_BY_ID = new Map(MARKETPLACE_REGISTRY_V1.map((m) => [m.marketplaceId, m]));
const REGISTRY_BY_LEGACY = new Map(
  MARKETPLACE_REGISTRY_V1.filter((m) => m.legacyEnumValue)
    .map((m) => [m.legacyEnumValue as string, m]),
);

export function getMarketplaceConfig(marketplaceId: string): MarketplaceConfigV1 | null {
  return REGISTRY_BY_ID.get(marketplaceId) ?? null;
}

/** Resolve o nome exibido sem nunca usá-lo como identidade. */
export function resolveDisplayName(marketplaceId: string): string {
  return getMarketplaceConfig(marketplaceId)?.displayName ?? marketplaceId;
}

/** Resolve o enum Prisma legado quando existente (null para marketplace dinâmico). */
export function resolveLegacyEnumValue(marketplaceId: string): string | null {
  return getMarketplaceConfig(marketplaceId)?.legacyEnumValue ?? null;
}

export function resolveMarketplaceIdFromLegacyEnum(
  legacyEnumValue: string,
): string | null {
  return REGISTRY_BY_LEGACY.get(legacyEnumValue)?.marketplaceId ?? null;
}

/**
 * Registra um marketplace dinâmico em runtime (configuração, não DB).
 * O núcleo do catálogo não precisa ser alterado para usar o novo marketplaceId.
 */
export function isMarketplaceKnown(marketplaceId: string): boolean {
  return REGISTRY_BY_ID.has(marketplaceId);
}

/** Número de marketplaces públicos/configurados — métrica, nunca regra. */
export function countRegisteredMarketplaces(): number {
  return REGISTRY_BY_ID.size;
}

/** marketplaceIds registrados — apenas para diagnóstico/observabilidade. */
export function listMarketplaceIds(): string[] {
  return [...REGISTRY_BY_ID.keys()];
}