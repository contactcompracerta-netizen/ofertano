/**
 * CATALOG_WAVE 1 - CATALOG IMPORTER V1 (FASE E).
 *
 * Pipeline:
 *   AWIN FEED -> NORMALIZER -> VALIDATOR -> IDENTITY -> MATCHER
 *              -> STAGING -> (plan) -> CATALOG WRITER
 *
 * Modos: DISABLED | DRY_RUN | SHADOW | CANARY | LIVE
 *   - DISABLED : nada executa (lança).
 *   - DRY_RUN  : produz plano + staging em memória; gateway NUNCA tocado.
 *   - SHADOW   : pode persistir APENAS staging; Product/Offer nunca são aplicados.
 *   - CANARY   : aplica o plano respeitando limites (25/anunciante, 100 total).
 *   - LIVE     : bloqueado por flag adicional (AWIN_WAVE1_LIVE_ENABLED).
 *
 * REAL_WRITE_DISABLED nesta missão: a escrita real depende das flags
 * (fail-closed, default OFF) e dos feeds reais.
 */
import {
  normalizeAwinFeedItem,
  type RawAwinFeedItem,
} from "../feed/awinAdapter";
import { isSafeExternalUrl } from "../feed/urlSafety";
import type { AwinAdvertiserConfig } from "./advertisers";
import {
  assertWriteAllowed,
  isAnalysisEnabled,
  isLiveEnabled,
  CatalogDisabledError,
  LiveModeBlockedError,
} from "./featureFlags";
import type { CatalogImportFlags } from "./featureFlags";
import { computeIdentityLevel, isValidGtin } from "./identity";
import {
  AUTO_MATCH_THRESHOLD,
  REVIEW_THRESHOLD,
  matchToCatalog,
} from "./matching";
import { buildPlan } from "./plan";
import type { CatalogImportPlan, CatalogImportPlanItem } from "./plan";
import { approveAwinSource } from "./sourceGuard";
import { buildStagingRecord } from "./staging";
import type { StagingStore } from "./staging";
import type { CatalogWriteGateway, ProductDraft } from "./transaction";
import type {
  CatalogFeedItem,
  CatalogImportMode,
  ExistingOfferRef,
  ExistingProductRef,
  ImportDecision,
  MerchantSlug,
  OfferAction,
  ReasonCode,
  ValidationStatus,
} from "./types";

export const CANARY_MAX_PER_ADVERTISER = 25;
export const CANARY_MAX_TOTAL = 100;

export interface CatalogImporterDeps {
  flags: CatalogImportFlags;
  stagingStore: StagingStore;
  gateway: CatalogWriteGateway;
  existingProducts: readonly ExistingProductRef[];
  existingOffers: readonly ExistingOfferRef[];
  /** Identificador da execução, gravado no staging para auditoria. */
  runId?: string;
}

export interface ApplyResult {
  applied: number;
  productsCreated: number;
  productsMatched: number;
  offersCreated: number;
  offersUpdated: number;
  offersUnchanged: number;
  skippedCanaryLimit: number;
  failed: number;
}

export interface ImportRunResult {
  merchant: string;
  advertiser: AwinAdvertiserConfig | null;
  mode: CatalogImportMode;
  plan: CatalogImportPlan;
  apply: ApplyResult | null;
}

function emptyApply(): ApplyResult {
  return {
    applied: 0,
    productsCreated: 0,
    productsMatched: 0,
    offersCreated: 0,
    offersUpdated: 0,
    offersUnchanged: 0,
    skippedCanaryLimit: 0,
    failed: 0,
  };
}

export class CatalogImporterV1 {
  private readonly flags: CatalogImportFlags;
  private readonly stagingStore: StagingStore;
  private readonly gateway: CatalogWriteGateway;
  private readonly existingProducts: readonly ExistingProductRef[];
  private readonly existingOffers: readonly ExistingOfferRef[];
  private readonly runId?: string;

  /** Sessão canary: contador total entre execuções desta instância. */
  private canaryAppliedTotal = 0;
  private readonly canaryAppliedPerMerchant = new Map<string, number>();

  constructor(deps: CatalogImporterDeps) {
    this.flags = deps.flags;
    this.stagingStore = deps.stagingStore;
    this.gateway = deps.gateway;
    this.existingProducts = deps.existingProducts;
    this.existingOffers = deps.existingOffers;
    this.runId = deps.runId;
  }

  async run(
    rows: readonly RawAwinFeedItem[],
    merchant: string,
  ): Promise<ImportRunResult> {
    if (this.flags.mode === "DISABLED") {
      throw new CatalogDisabledError("CATALOG_IMPORT_MODE=DISABLED");
    }
    if (!isAnalysisEnabled(this.flags)) {
      throw new CatalogDisabledError(
        "flags base OFF (CATALOG_IMPORT_ENABLED/AWIN_WAVE1_ENABLED)",
      );
    }
    if (this.flags.mode === "LIVE" && !isLiveEnabled(this.flags)) {
      throw new LiveModeBlockedError("LIVE bloqueado (flag adicional OFF)");
    }

    const guard = approveAwinSource(merchant);
    const planItems: CatalogImportPlanItem[] = [];
    let effectiveMerchant: MerchantSlug | string = merchant;

    if (!guard.approved) {
      // Fonte não aprovada: NADA passa. Planner registra REJECTs.
      for (const raw of rows) {
        const item = normalizeAwinFeedItem(raw);
        const planItem = this.buildRejectedItem(
          merchant,
          item,
          ["REJECT_UNAPPROVED_SOURCE"],
        );
        planItems.push(planItem);
        await this.stagingStore.upsert(planItem.staging);
      }
      return {
        merchant,
        advertiser: null,
        mode: this.flags.mode,
        plan: buildPlan(this.flags.mode, merchant as MerchantSlug, planItems, 0),
        apply: null,
      };
    }

    const advertiser = guard.advertiser;
    const merchantSlug = advertiser.slug;
    effectiveMerchant = merchantSlug;
    const seenExternalIds = new Set<string>();
    let duplicates = 0;

    for (const raw of rows) {
      const item = normalizeAwinFeedItem(raw);

      const externalId = item.externalId?.trim() || "";
      if (externalId !== "" && seenExternalIds.has(externalId)) {
        duplicates += 1;
        const planItem = this.buildRejectedItem(
          merchantSlug,
          item,
          ["DUPLICATE_EXTERNAL_ID"],
        );
        planItems.push(planItem);
        await this.stagingStore.upsert(planItem.staging);
        continue;
      }
      if (externalId !== "") seenExternalIds.add(externalId);

      const planItem = this.evaluateItem(merchantSlug, item);
      planItems.push(planItem);
      await this.stagingStore.upsert(planItem.staging);
    }

    const plan = buildPlan(this.flags.mode, merchantSlug, planItems, duplicates);

    let apply: ApplyResult | null = null;
    if (this.flags.mode === "CANARY" || this.flags.mode === "LIVE") {
      assertWriteAllowed(this.flags);
      apply = await this.applyPlan(plan);
    }

    return {
      merchant: effectiveMerchant,
      advertiser,
      mode: this.flags.mode,
      plan,
      apply,
    };
  }

  private buildRejectedItem(
    merchant: MerchantSlug | string,
    item: CatalogFeedItem,
    reasons: ReasonCode[],
  ): CatalogImportPlanItem {
    const externalId = item.externalId?.trim() || "unknown";
    const staging = buildStagingRecord({
      merchant: merchant as MerchantSlug,
      externalId,
      title: item.title || "",
      price: typeof item.price === "number" ? item.price : null,
      currency: item.currency ?? "",
      validationStatus: "INVALID",
      identityLevel: "D",
      matchCandidateProductId: null,
      matchConfidence: null,
      decision: "REJECT",
      reasonCodes: reasons,
      ...(this.runId !== undefined ? { runId: this.runId } : {}),
      ...(item.brand !== undefined ? { brand: item.brand } : {}),
      ...(item.gtin !== undefined ? { gtin: item.gtin } : {}),
      ...(item.mpn !== undefined ? { mpn: item.mpn } : {}),
      ...(item.model !== undefined ? { model: item.model } : {}),
      ...(item.productUrl !== undefined ? { destinationUrl: item.productUrl } : {}),
      ...(item.affiliateUrl !== undefined ? { affiliateUrl: item.affiliateUrl } : {}),
      ...(item.imageUrls[0] !== undefined ? { imageUrl: item.imageUrls[0] } : {}),
    });
    return {
      merchant: merchant as MerchantSlug,
      externalId,
      decision: "REJECT",
      offerAction: "NONE",
      validationStatus: "INVALID",
      identityLevel: "D",
      matchCandidateProductId: null,
      matchConfidence: null,
      reasonCodes: reasons,
      staging,
    };
  }

  /** Validação: status + reason codes (core => INVALID; senão PARcial). */
  private validateItem(
    item: CatalogFeedItem,
  ): { status: ValidationStatus; reasons: ReasonCode[] } {
    const reasons: ReasonCode[] = [];

    if (!item.externalId || item.externalId.trim() === "") {
      reasons.push("MISSING_EXTERNAL_ID");
    }
    if (!item.title || item.title.trim().length < 3) {
      reasons.push("MISSING_TITLE");
    }
    if (item.price === undefined || !Number.isFinite(item.price) || item.price <= 0) {
      reasons.push("INVALID_PRICE");
    }
    if (item.currency !== "BRL") {
      reasons.push("INVALID_CURRENCY");
    }
    if (!item.productUrl || !isSafeExternalUrl(item.productUrl)) {
      reasons.push("INVALID_DESTINATION_URL");
    }
    if (!item.affiliateUrl) {
      reasons.push("MISSING_AFFILIATE_URL");
    } else if (!isSafeExternalUrl(item.affiliateUrl)) {
      reasons.push("INVALID_AFFILIATE_URL");
    }

    if (
      item.availability !== undefined &&
      /^(0|false|no|n|out[ -]?of[ -]?stock|unavailable|not[ -]?for[ -]?sale)$/i.test(
        item.availability.trim(),
      )
    ) {
      reasons.push("UNAVAILABLE_ITEM");
    }

    const core: ReasonCode[] = [
      "MISSING_EXTERNAL_ID",
      "MISSING_TITLE",
      "INVALID_PRICE",
      "INVALID_CURRENCY",
      "INVALID_DESTINATION_URL",
      "INVALID_AFFILIATE_URL",
      "UNAVAILABLE_ITEM",
    ];
    if (reasons.some((r) => core.includes(r))) {
      return { status: "INVALID", reasons };
    }

    if (item.imageUrls.length === 0) {
      reasons.push("MISSING_IMAGE");
    }
    if (item.gtin !== undefined && item.gtin !== "" && !isValidGtin(item.gtin)) {
      reasons.push("INVALID_GTIN_IGNORED");
    }

    if (reasons.length > 0) return { status: "PARTIAL", reasons };
    return { status: "VALID", reasons };
  }

  private evaluateItem(
    merchant: MerchantSlug,
    item: CatalogFeedItem,
  ): CatalogImportPlanItem {
    const externalId = item.externalId?.trim() || "unknown";
    const { status, reasons } = this.validateItem(item);

    let decision: ImportDecision;
    let offerAction: OfferAction = "NONE";
    const match = matchToCatalog(item, this.existingProducts);
    const identity = computeIdentityLevel(item);
    const allReasons: ReasonCode[] = [...reasons, ...match.reasonCodes];

    if (status === "INVALID") {
      decision = "REJECT";
    } else if (status === "PARTIAL") {
      // Conservador: nada de escrita com item incompleto.
      decision = "REVIEW";
    } else if (identity.level === "D") {
      decision = "REVIEW";
      allReasons.push("WEAK_IDENTITY");
    } else if (identity.level === "C") {
      decision = "REVIEW";
      allReasons.push("PARTIAL_IDENTITY");
    } else if (match.conflict) {
      decision = "REVIEW";
    } else if (match.productId && match.confidence >= AUTO_MATCH_THRESHOLD) {
      decision = "MATCH_PRODUCT";
      allReasons.push("AUTO_MATCH");
    } else if (match.productId && match.confidence >= REVIEW_THRESHOLD) {
      decision = "REVIEW";
      allReasons.push("REVIEW_THRESHOLD");
    } else {
      decision = "CREATE_PRODUCT";
      allReasons.push("NEW_PRODUCT_CANDIDATE");
    }

    if (decision === "CREATE_PRODUCT" || decision === "MATCH_PRODUCT") {
      const existingOffer = this.existingOffers.find(
        (o) => o.merchant === merchant && o.externalId === externalId,
      );
      if (existingOffer) {
        if (Math.abs(existingOffer.price - (item.price ?? -1)) > 0.009) {
          offerAction = "UPDATE_OFFER";
          allReasons.push("OFFER_PRICE_CHANGED");
        } else {
          offerAction = "UNCHANGED";
          allReasons.push("OFFER_UNCHANGED");
        }
      } else {
        offerAction = "CREATE_OFFER";
      }
    }

    const staging = buildStagingRecord({
      merchant,
      externalId,
      title: item.title || "",
      price: typeof item.price === "number" ? item.price : null,
      currency: item.currency ?? "",
      validationStatus: status,
      identityLevel: identity.level,
      matchCandidateProductId: match.productId,
      matchConfidence: match.productId ? match.confidence : null,
      decision,
      reasonCodes: dedupe(allReasons),
      ...(this.runId !== undefined ? { runId: this.runId } : {}),
      ...(item.description !== undefined ? { description: item.description } : {}),
      ...(item.brand !== undefined ? { brand: item.brand } : {}),
      ...(item.gtin !== undefined && isValidGtin(item.gtin) ? { gtin: item.gtin } : {}),
      ...(item.mpn !== undefined ? { mpn: item.mpn } : {}),
      ...(item.model !== undefined ? { model: item.model } : {}),
      ...(item.category !== undefined ? { category: item.category } : {}),
      ...(item.productUrl !== undefined ? { destinationUrl: item.productUrl } : {}),
      ...(item.affiliateUrl !== undefined && isSafeExternalUrl(item.affiliateUrl)
        ? { affiliateUrl: item.affiliateUrl }
        : {}),
      ...(item.imageUrls[0] !== undefined ? { imageUrl: item.imageUrls[0] } : {}),
      ...(item.attributes !== undefined ? { attributes: item.attributes } : {}),
    });

    return {
      merchant,
      externalId,
      decision,
      offerAction,
      validationStatus: status,
      identityLevel: identity.level,
      matchCandidateProductId: match.productId,
      matchConfidence: match.productId ? match.confidence : null,
      reasonCodes: dedupe(allReasons),
      staging,
    };
  }

  /** Aplica o plano: limites canary + transação por item (FASE K/J). */
  private async applyPlan(plan: CatalogImportPlan): Promise<ApplyResult> {
    assertWriteAllowed(this.flags);
    const result = emptyApply();

    // Prioridade: identidade A antes de B; depois ordem do feed.
    const writers = plan.items
      .filter((i) => i.decision === "CREATE_PRODUCT" || i.decision === "MATCH_PRODUCT")
      .sort((a, b) => rankIdentity(a.identityLevel) - rankIdentity(b.identityLevel));

    for (const item of writers) {
      const perMerchant = this.canaryAppliedPerMerchant.get(item.merchant) ?? 0;
      if (
        this.flags.mode === "CANARY" &&
        (
          perMerchant >= CANARY_MAX_PER_ADVERTISER ||
          this.canaryAppliedTotal >= CANARY_MAX_TOTAL
        )
      ) {
        result.skippedCanaryLimit += 1;
        continue;
      }

      if (item.offerAction === "UNCHANGED") {
        // Oferta já está no estado esperado: unidade transacional sem
        // operações de escrita (produto já existe no snapshot).
        try {
          await this.gateway.transaction(async (ops) => {
            if (item.decision === "MATCH_PRODUCT") {
              if (!item.matchCandidateProductId) {
                throw new Error("MATCH_TARGET_MISSING");
              }
              return;
            }
            // CREATE_PRODUCT com oferta preexistente: cria só o product.
            await ops.createProduct(this.productDraft(item));
          });
          result.applied += 1;
          if (item.decision === "CREATE_PRODUCT") result.productsCreated += 1;
          else result.productsMatched += 1;
          result.offersUnchanged += 1;
          this.countApplied(item.merchant);
        } catch {
          result.failed += 1;
        }
        continue;
      }

      try {
        await this.gateway.transaction(async (ops) => {
          let productId: string;
          if (item.decision === "CREATE_PRODUCT") {
            const created = await ops.createProduct(this.productDraft(item));
            productId = created.id;
          } else {
            productId = item.matchCandidateProductId ?? "";
            if (productId === "") throw new Error("MATCH_TARGET_MISSING");
          }

          if (item.offerAction === "CREATE_OFFER") {
            await ops.createOffer({
              productId,
              merchant: item.merchant,
              externalId: item.externalId,
              price: item.staging.price ?? 0,
              title: item.staging.title,
              ...(item.staging.imageUrl !== undefined
                ? { imageUrl: item.staging.imageUrl }
                : {}),
              ...(item.staging.destinationUrl !== undefined
                ? { sourceUrl: item.staging.destinationUrl }
                : {}),
              ...(item.staging.affiliateUrl !== undefined
                ? { affiliateUrl: item.staging.affiliateUrl }
                : {}),
            });
          } else if (item.offerAction === "UPDATE_OFFER") {
            const existing = this.existingOffers.find(
              (o) => o.merchant === item.merchant && o.externalId === item.externalId,
            );
            if (!existing) throw new Error("UPDATE_TARGET_MISSING");
            await ops.updateOffer(existing.id, {
              price: item.staging.price ?? 0,
              ...(item.staging.affiliateUrl !== undefined
                ? { affiliateUrl: item.staging.affiliateUrl }
                : {}),
            });
          }
        });
        // Contadores apenas APÓS sucesso (rollback não conta como criação).
        result.applied += 1;
        if (item.decision === "CREATE_PRODUCT") result.productsCreated += 1;
        else result.productsMatched += 1;
        if (item.offerAction === "CREATE_OFFER") result.offersCreated += 1;
        else if (item.offerAction === "UPDATE_OFFER") result.offersUpdated += 1;
        this.countApplied(item.merchant);
      } catch {
        // Rollback ocorreu dentro do gateway: unidade isolada falhou.
        result.failed += 1;
      }
    }

    return result;
  }

  private productDraft(item: CatalogImportPlanItem): ProductDraft {
    return {
      name: item.staging.title,
      ...(item.staging.brand !== undefined ? { brand: item.staging.brand } : {}),
      ...(item.staging.gtin !== undefined ? { gtin: item.staging.gtin } : {}),
      ...(item.staging.mpn !== undefined ? { mpn: item.staging.mpn } : {}),
      ...(item.staging.model !== undefined
        ? { modelNumber: item.staging.model }
        : {}),
      store: item.merchant,
      price: item.staging.price ?? 0,
      currency: item.staging.currency,
      ...(item.staging.imageUrl !== undefined
        ? { imageUrl: item.staging.imageUrl }
        : {}),
      ...(item.staging.description !== undefined ? { description: item.staging.description } : {}),
      ...(item.staging.category !== undefined ? { category: item.staging.category } : {}),
      ...(item.staging.affiliateUrl !== undefined ? { affiliateUrl: item.staging.affiliateUrl } : {}),
      source: item.staging.source,
      merchant: item.merchant,
      externalId: item.externalId,
    };
  }

  private countApplied(merchant: string): void {
    this.canaryAppliedTotal += 1;
    this.canaryAppliedPerMerchant.set(
      merchant,
      (this.canaryAppliedPerMerchant.get(merchant) ?? 0) + 1,
    );
  }
}

function rankIdentity(level: string): number {
  return level === "A" ? 0 : 1;
}

function dedupe(codes: ReasonCode[]): ReasonCode[] {
  return [...new Set(codes)];
}
