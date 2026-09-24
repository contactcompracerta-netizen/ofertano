/**
 * CATALOG_ARCHITECTURE_V1 — MARKETPLACE CONNECTOR CONTRACT (FASE C).
 *
 * Contrato universal de conector. Define capacidades SEM exigir que todas as
 * fontes suportem tudo. O núcleo do catálogo conhece apenas as capacidades e o
 * contrato normalizado — nunca peculiaridades de fonte.
 *
 * Toda fonte nova = CRIAR CONECTOR + MAPEAR PARA CONTRATO INTERNO +
 * CONFIGURAR CREDENCIAIS/POLÍTICAS + TESTAR. Sem tocar no núcleo.
 */

import type { NormalizedMarketplaceListingV1 } from "./normalizedListingV1";

/** Capacidades declaradas por um conector. */
export interface ConnectorCapabilities {
  /** Coleta de catálogo (estrutural: título/identidade/variantes). */
  catalog: boolean;
  /** Coleta de inventário/oferta (preço/estoque/disponibilidade). */
  inventory: boolean;
  /** Fonte expõe estoque em tempo útil. */
  stock: boolean;
  /** Fonte expõe dados de frete. */
  shipping: boolean;
  /** Fonte expõe dados de vendedor. */
  seller: boolean;
  /** Fonte expõe variantes (cor/tamanho/armazenamento...). */
  variants: boolean;
  /** Fonte expõe GTIN/EAN/UPC confiável. */
  gtin: boolean;
  /** Delta incremental por item. */
  incrementalUpdates: boolean;
  /** Snapshot completo do marketplace (usado para reconciliação). */
  fullSnapshot: boolean;
  /** Callbacks/webhooks push (em oposição a polling). */
  webhook: boolean;
  /** Dados de preço PIX. */
  pixPrice: boolean;
}

export type ConnectorCollectMode = "SNAPSHOT" | "INCREMENTAL";

/** Saída da coleta: itens + cursor de paginação (quando o conector suporta). */
export interface CollectedListingBatch {
  items: NormalizedMarketplaceListingV1[];
  /** Cursor opaco para a próxima página. null quando não há mais páginas. */
  nextCursor: string | null;
  /** Indicador de fim de snapshot completo (para reconciliação por snapshot). */
  snapshotComplete: boolean;
}

/**
 * Conector universal.
 *
 * Métodos marcados como "não exigidos" podem lançar UnsupportedCapabilityError
 * quando a capacidade correspondente for false — o núcleo nunca os invoca nesse
 * caso (ele consulta `capabilities` antes).
 */
export interface MarketplaceConnector {
  /** Identificador canônico do conector (ex.: "fake-connector-a", "mercadolivre"). */
  readonly id: string;

  /** marketplaceId canônico interno que este conector produz. */
  readonly marketplaceId: string;

  readonly capabilities: ConnectorCapabilities;

  /**
   * Coleta itens (catálogo e/ou inventário conforme a capacidade).
   * `fromCursor` permite iterar snapshots/incrementais página a página.
   */
  collect(fromCursor?: string | null): Promise<CollectedListingBatch>;

  /** Coleta incremental (somente se capabilities.incrementalUpdates). */
  collectIncremental?(fromCursor?: string | null): Promise<CollectedListingBatch>;

  /** Normaliza o payload bruto da fonte para o contrato interno V1. */
  normalize(raw: unknown): NormalizedMarketplaceListingV1;

  /** Valida um payload já normalizado (rejeições entram em itemsRejected). */
  validate(listing: NormalizedMarketplaceListingV1): string[];

  /** Cursor opaco persistido entre execuções. */
  getCursor(): string | null;

  /** Health check do conector. */
  healthCheck(): Promise<{ ok: boolean; detail?: string }>;
}

/** Erro lançado quando o conector é chamado numa capacidade que não declara. */
export class UnsupportedCapabilityError extends Error {
  constructor(
    readonly connectorId: string,
    readonly capability: keyof ConnectorCapabilities,
  ) {
    super(
      `Connector "${connectorId}" does not support capability "${capability}".`,
    );
    this.name = "UnsupportedCapabilityError";
  }
}

/** Garante que o conector suporta a capacidade antes de invocar. */
export function requireCapability(
  connector: MarketplaceConnector,
  capability: keyof ConnectorCapabilities,
): void {
  if (!connector.capabilities[capability]) {
    throw new UnsupportedCapabilityError(connector.id, capability);
  }
}

/** Verifica se um conector expõe um método coleto verdadeiro. */
export function supportsMethod(
  connector: MarketplaceConnector,
  method: "collectIncremental",
): boolean {
  return typeof connector[method] === "function";
}