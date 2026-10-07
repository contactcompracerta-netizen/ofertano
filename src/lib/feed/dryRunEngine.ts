/**
 * Feed Ingestion Engine V1 - Dry Run Engine.
 *
 * Pure deterministic processing, no network, no DNS, no database writes.
 * Fail-closed: invalid data is reported, never silently hidden.
 * CATALOG REMAINS FROZEN.
 */

import { toSafeExternalUrl } from "./urlSafety";
import {
  normalizePrice,
  normalizeCurrency,
  normalizeString,
  normalizeGTIN,
  normalizeAttributes,
  type NormalizedPriceResult,
  type NormalizedCurrencyResult,
  type NormalizedGTINResult,
  type NormalizedAttributesResult,
  type SafeUrlResult,
} from "./normalization";

/**
 * Modos de execução permitidos.
 * LIVE não é implementado nem habilitado nesta missão, mas pode ser passado
 * para setMode() onde será convertido para DISABLED.
 */
export type ExecutionMode = "DISABLED" | "DRY_RUN" | "LIVE";

/**
 * Valor padrão quando não houver modo explicitamente definido.
 */
export const DEFAULT_EXECUTION_MODE: ExecutionMode = "DISABLED";

/**
 * Relatório determinístico de uma corrida dry-run.
 *
 * Todos os campos são calculados a partir do feed de entrada só.
 * Não houver persistência nem side effects.
 */
export interface FeedDryRunReport {
  /** Nome ou identificação da fonte (ex: "awin", "shopee") */
  source: string;
  /** Total de linhas lidas do feed */
  totalRows: number;
  /** Linhas que passaram pela normalização sem erros de formato */
  parsedRows: number;
  /** Linhas consideradas válidas após todas as validações */
  validRows: number;
  /** Linhas com identidade insuficiente (sem externalId) */
  partialRows: number;
  /** Linhas com erro de validação (preço inválido, URL inválida, etc) */
  invalidRows: number;
  /** Quantidade de duplicates de externalId detectadas */
  duplicateExternalIds: number;
  /** Linhas que possuem GTIN preenchido explicitamente */
  rowsWithGtin: number;
  /** Linhas que possuem brand preenchido explicitamente */
  rowsWithBrand: number;
  /** Linhas que possuem model preenchido explicitamente */
  rowsWithModel: number;
  /** Linhas que possuem MPN preenchido explicitamente */
  rowsWithMpn: number;
  /** Linhas que possuem URL de destino válida (http/https) */
  rowsWithValidUrl: number;
  /** Linhas que possuem preço válido */
  rowsWithPrice: number;
  /** Razões de falha agregadas */
  failureReasons: Record<string, number>;
  /** Estatísticas de sinais/identidade */
  identitySignalStats: Record<string, number>;
  /** Estatísticas de moeda */
  currencyStats: Record<string, number>;
  /** Estatísticas de anunciante */
  advertiserStats: Record<string, number>;
}

/**
 * Engine principal de dry-run.
 *
 * Fluxo:
 * FeedSourceAdapter.parse()
 *   -> RawFeedItem
 *   -> FeedSourceAdapter.normalize()
 *   -> validateNormalizedFeedItem()
 *   -> dedupe
 *   -> monta relatório
 *
 * Não adicionar Prisma.
 * Não permitir writes.
 */
export class DryRunEngine {
  private mode: ExecutionMode;
  private source: string;

  constructor(mode?: ExecutionMode, source = "unknown") {
    this.mode = mode || DEFAULT_EXECUTION_MODE;
    this.source = source;
  }

  /**
   * Get the current execution mode.
   */
  getMode(): ExecutionMode {
    return this.mode;
  }

  /**
   * Define o modo de execução.
   * Live não é permitido.
   */
  setMode(mode: ExecutionMode): void {
    if (mode === "LIVE") {
      console.warn(
        "LIVE mode is not implemented or enabled. Switching to DISABLED.",
      );
      this.mode = "DISABLED";
      return;
    }
    this.mode = mode;
  }

  /**
   * Processa um array de linhas brutas do feed.
   * Retorna o relatório determinístico.
   */
  processRows(
    rawRows: unknown[],
  ): FeedDryRunReport {
    "use strict";

    // Contadores
    let totalRows = 0;
    let parsedRows = 0;
    let validRows = 0;
    let partialRows = 0;
    let invalidRows = 0;
    let duplicateExternalIds = 0;

    // Sets e maps para dedup e estatísticas
    const seenExternalIds = new Set<string>();
    const failureCounts: Record<string, number> = {
      INVALID_PRICE: 0,
      INVALID_URL: 0,
      INVALID_GTIN: 0,
      MISSING_EXTERNAL_ID: 0,
      INVALID_CURRENCY: 0,
      INVALID_ATTRIBUTES: 0,
      DUPLICATE_EXTERNAL_ID: 0,
    };

    // Trackers
    let rowsWithGtin = 0;
    let rowsWithBrand = 0;
    let rowsWithModel = 0;
    let rowsWithMpn = 0;
    let rowsWithValidUrl = 0;
    let rowsWithPrice = 0;

    // Stats
    const identitySignalStats: Record<string, number> = {};
    const currencyStats: Record<string, number> = {};
    const advertiserStats: Record<string, number> = {};

    for (let i = 0; i < rawRows.length; i += 1) {
      totalRows += 1;
      parsedRows += 1;

      const row = rawRows[i] as Record<string, unknown>;

      // 1. Normalização básica - extrai e normaliza todos os campos
      let externalId: string | undefined;
      let price: number | undefined;
      let currency: string | undefined;
      let url: string | undefined;
      const images: string[] = [];

      // Flags para rastrear falhas desta linha
      let hasInvalidPrice = false;
      let hasInvalidUrl = false;
      let hasInvalidCurrency = false;
      let hasInvalidAttributes = false;

      try {
        // External ID (obrigatório)
        const externalIdRaw =
          row?.externalId ?? row?.id ?? row?.productId ?? row?.sku;
        externalId = externalIdRaw
          ? normalizeString(String(externalIdRaw)).value
          : undefined;

        // Preço
        const priceRaw = row?.price ?? row?.oldPrice;
        if (priceRaw !== undefined && priceRaw !== null) {
          const priceResult: NormalizedPriceResult = normalizePrice(
            String(priceRaw),
          );
          if (priceResult.status === "VALID") {
            price = priceResult.value;
            rowsWithPrice += 1;
          } else if (priceResult.status === "INVALID") {
            hasInvalidPrice = true;
          }
        }

        // Moeda
        const currencyRaw = row?.currency;
        if (currencyRaw !== undefined && currencyRaw !== null) {
          const currencyResult: NormalizedCurrencyResult = normalizeCurrency(
            String(currencyRaw),
          );
          if (currencyResult.status === "VALID") {
            currency = currencyResult.value;
            currencyStats[currency] = (currencyStats[currency] || 0) + 1;
          } else if (currencyResult.status === "INVALID_CURRENCY") {
            hasInvalidCurrency = true;
          }
        }

        // URL de destino
        const urlRaw = row?.productUrl ?? row?.affiliateUrl;
        if (urlRaw !== undefined && urlRaw !== null) {
          const urlResult: SafeUrlResult = toSafeExternalUrl(String(urlRaw));
          if (urlResult.status === "VALID") {
            url = urlResult.value;
            rowsWithValidUrl += 1;
          } else {
            hasInvalidUrl = true;
          }
        }

        // GTIN
        const gtinRaw = row?.gtin ?? row?.gtinCode;
        if (gtinRaw !== undefined && gtinRaw !== null) {
          const gtinResult: NormalizedGTINResult = normalizeGTIN(String(gtinRaw));
          if (gtinResult.status === "VALID") {
            rowsWithGtin += 1;
          }
        }

        // Brand
        const brandRaw = row?.brand;
        if (brandRaw !== undefined && brandRaw !== null) {
          const brandResult = normalizeString(String(brandRaw));
          if (brandResult.status === "VALID") {
            rowsWithBrand += 1;
          }
        }

        // Model
        const modelRaw = row?.model;
        if (modelRaw !== undefined && modelRaw !== null) {
          const modelResult = normalizeString(String(modelRaw));
          if (modelResult.status === "VALID") {
            rowsWithModel += 1;
          }
        }

        // MPN
        const mpnRaw = row?.mpn;
        if (mpnRaw !== undefined && mpnRaw !== null) {
          const mpnResult = normalizeString(String(mpnRaw));
          if (mpnResult.status === "VALID") {
            rowsWithMpn += 1;
          }
        }

        // Images (coleção simples de URLs válidas)
        const imagesRaw = row?.imageUrls;
        if (Array.isArray(imagesRaw)) {
          for (const img of imagesRaw) {
            const urlResult: SafeUrlResult = toSafeExternalUrl(String(img));
            if (urlResult.status === "VALID") {
              images.push(urlResult.value);
            }
          }
        } else if (typeof imagesRaw === "string" && imagesRaw.trim()) {
          // Handle semicolon/comma separated image URLs
          const parts = imagesRaw.split(/[;,]\s*/);
          for (const part of parts) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            const urlResult: SafeUrlResult = toSafeExternalUrl(trimmed);
            if (urlResult.status === "VALID") {
              images.push(urlResult.value);
            }
          }
        }

        // Attributes
        const attrsRaw = row?.attributes;
        if (attrsRaw !== undefined && attrsRaw !== null) {
          // Handle string attributes (key=value;key=value format) or object
          let attrsObj: Record<string, unknown> | unknown[] | undefined;
          if (typeof attrsRaw === "string") {
            // Parse key=value;key=value format
            const parsed: Record<string, unknown> = {};
            const parts = attrsRaw.split(/[;,]\s*/);
            for (const part of parts) {
              const eqIndex = part.indexOf("=");
              if (eqIndex > 0) {
                const key = part.slice(0, eqIndex).trim();
                const value = part.slice(eqIndex + 1).trim();
                if (key) parsed[key] = value;
              }
            }
            attrsObj = Object.keys(parsed).length > 0 ? parsed : undefined;
          } else if (typeof attrsRaw === "object") {
            // objeto ou array — repassado ao validador
            attrsObj = attrsRaw as Record<string, unknown> | unknown[];
          } else {
            // Primitivo inesperado (number, boolean, ...) — inválido fail-closed
            hasInvalidAttributes = true;
          }

          if (attrsObj !== undefined) {
            const attrsResult: NormalizedAttributesResult = normalizeAttributes(attrsObj);
            if (attrsResult.status === "INVALID") {
              hasInvalidAttributes = true;
            }
          }
        }

      } catch {
        // Qualquer erro inesperado conta como preço inválido (fallback)
        hasInvalidPrice = true;
      }

      // 2. Validação de externalId (obrigatório)
      if (externalId === undefined || externalId === null || externalId === "") {
        partialRows += 1;
        failureCounts["MISSING_EXTERNAL_ID"] += 1;
        continue; // pula para o próximo, não tem como dedup sem externalId
      }

      // 3. Dedup por externalId (determinístico, FIRST_OCCURRENCE_WINS)
      if (seenExternalIds.has(externalId)) {
        duplicateExternalIds += 1;
        failureCounts["DUPLICATE_EXTERNAL_ID"] += 1;
        invalidRows += 1;
        continue; // descarta a ocorrência duplicada
      }

      seenExternalIds.add(externalId);

      // 4. Determinar se a linha é válida
      // Uma linha é válida se tem: externalId, price, currency, url
      const isValid =
        externalId !== undefined &&
        price !== undefined &&
        currency !== undefined &&
        url !== undefined;

      // 5. Contabilizar falhas (uma vez por linha, apenas para linhas com externalId)
      if (!isValid) {
        invalidRows += 1;
        if (hasInvalidPrice) failureCounts["INVALID_PRICE"] += 1;
        if (hasInvalidUrl) failureCounts["INVALID_URL"] += 1;
        if (hasInvalidCurrency) failureCounts["INVALID_CURRENCY"] += 1;
        if (hasInvalidAttributes) failureCounts["INVALID_ATTRIBUTES"] += 1;
        // Se não tem price/currency/url mas não foi marcado como falha específica,
        // é uma falha genérica de campos obrigatórios ausentes
        if (!hasInvalidPrice && !hasInvalidUrl && !hasInvalidCurrency && !hasInvalidAttributes) {
          failureCounts["INVALID_PRICE"] += 1; // fallback
        }
      } else {
        validRows += 1;
        // Contabilizar sinais de identidade
        identitySignalStats[externalId] = (identitySignalStats[externalId] || 0) + 1;
      }
    }

    // 6. Montar relatório final
    const report: FeedDryRunReport = {
      source: this.source,
      totalRows,
      parsedRows,
      validRows,
      partialRows,
      invalidRows,
      duplicateExternalIds,
      rowsWithGtin,
      rowsWithBrand,
      rowsWithModel,
      rowsWithMpn,
      rowsWithValidUrl,
      rowsWithPrice,
      failureReasons: failureCounts,
      identitySignalStats,
      currencyStats,
      advertiserStats,
    };

    return report;
  }

  /**
   * Executa dry-run sobre uma fixture de linhas.
   * Apenas para conveniência - não persiste nada.
   */
  runFixture(
    rows: unknown[],
  ): {
    report: FeedDryRunReport;
    mode: ExecutionMode;
    databaseWrites: number; // sempre 0
  } {
    const report = this.processRows(rows);
    return {
      report,
      mode: this.mode,
      databaseWrites: 0, // garantido: zero writes
    };
  }
}

/**
 * Modo default: DISABLED.
 * Para rodar: use modo DRY_RUN explicitamente.
 */
export const defaultDryRunEngine = new DryRunEngine(DEFAULT_EXECUTION_MODE);

/**
 * Verifica se o modo corrente permite operações.
 * Retorna true apenas para DRY_RUN.
 */
export function isDryRunMode(mode: ExecutionMode): boolean {
  return mode === "DRY_RUN";
}

export function isDisableMode(mode: ExecutionMode): boolean {
  return mode === "DISABLED";
}