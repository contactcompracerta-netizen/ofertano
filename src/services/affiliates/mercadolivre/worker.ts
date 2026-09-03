import type { GenerateOutcome } from "./generator";
import { confirmarAffiliateLinkMercadoLivre } from "@/lib/affiliates/publicPurchase";
import type { MercadoLivreApplyStore, MercadoLivrePendingStore } from "./pending";

export type GeneratorFn = (input: {
  sourceUrl: string;
  expectedItemId: string | null;
}) => Promise<GenerateOutcome>;

export type WorkerConfig = {
  limit: number;
  cooldownMs: number;
  dryRun: boolean;
  log?: (msg: string) => void;
};

export type WorkerItemResult =
  | { offerId: string; result: "SKIP_ALREADY_AFFILIATED"; reason: string }
  | { offerId: string; result: "SUCCESS"; affiliateUrl: string }
  | { offerId: string; result: "CHROME_NOT_RUNNING"; reason: string }
  | { offerId: string; result: "AUTH_REQUIRED"; reason: string }
  | { offerId: string; result: "GENERATION_FAILED"; reason: string }
  | { offerId: string; result: "VALIDATION_FAILED"; reason: string }
  | { offerId: string; result: "UPDATED" };

export type WorkerRunResult = {
  startedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  dryRun: boolean;
  results: WorkerItemResult[];
};

/**
 * Processa pendências Mercado Livre uma-a-uma (concorrência = 1), com cooldown
 * entre itens. Grava no banco SOMENTE quando a geração foi validada (SUCCESS).
 * Em dry-run, gera/valida mas não grava.
 */
export async function runMercadoLivreWorker(
  input: {
    pendingStore: MercadoLivrePendingStore;
    applyStore: MercadoLivreApplyStore;
    generate: GeneratorFn;
  },
  config: WorkerConfig,
): Promise<WorkerRunResult> {
  const log = config.log ?? (() => {});

  log("ML_AFFILIATE_WORKER_START");
  const pending = await input.pendingStore.listPendingMercadoLivreOffers(
    config.limit,
  );
  log(`PENDING_COUNT=${pending.length}`);

  const results: WorkerItemResult[] = [];
  let updatedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const item of pending) {
    log(`PROCESSING_OFFER=${item.offerId}`);

    const fresh = await input.pendingStore.findOfferById(item.offerId);
    if (!fresh) {
      log("RESULT=SKIP (oferta não encontrada)");
      results.push({
        offerId: item.offerId,
        result: "SKIP_ALREADY_AFFILIATED",
        reason: "Oferta não encontrada",
      });
      skippedCount += 1;
      continue;
    }

    const existing = confirmarAffiliateLinkMercadoLivre({
      affiliateLink: fresh.affiliateLink,
      sourceUrl: fresh.sourceUrl,
    });
    if (existing) {
      log("RESULT=SKIP (já possui link de afiliado validado)");
      results.push({
        offerId: item.offerId,
        result: "SKIP_ALREADY_AFFILIATED",
        reason: "já possui affiliateLink validado",
      });
      skippedCount += 1;
      continue;
    }

    if (!item.sourceUrl) {
      log("RESULT=SKIP (sourceUrl ausente)");
      results.push({
        offerId: item.offerId,
        result: "GENERATION_FAILED",
        reason: "sourceUrl ausente na pendência",
      });
      failedCount += 1;
      continue;
    }

    log(`SOURCE_URL=${item.sourceUrl}`);
    const outcome = await input.generate({
      sourceUrl: item.sourceUrl,
      expectedItemId: item.externalId ?? null,
    });

    if (outcome.status !== "SUCCESS") {
      log(`RESULT=${outcome.status}`);
      results.push({
        offerId: item.offerId,
        result: outcome.status,
        reason: ("reason" in outcome ? outcome.reason : "") as string,
      });
      failedCount += 1;
      // CHROME_NOT_RUNNING e AUTH_REQUIRED são condições GLOBAIS: interrompe
      // imediatamente o ciclo, não tenta as demais ofertas e preserva pendências.
      if (
        outcome.status === "CHROME_NOT_RUNNING" ||
        outcome.status === "AUTH_REQUIRED"
      ) {
        log(
          `ML_AFFILIATE_FAIL_FAST=${outcome.status} (interrompe ciclo; pendências preservadas)`,
        );
        break;
      }
      continue;
    }

    // Somente grava resultado validado e se não estiver em dry-run.
    if (!config.dryRun) {
      await input.applyStore.applyValidatedAffiliateLink({
        offerId: item.offerId,
        opportunityId: item.opportunityId,
        affiliateUrl: outcome.affiliateUrl,
      });
      log(`UPDATED=${item.offerId}`);
      results.push({ offerId: item.offerId, result: "UPDATED" });
      updatedCount += 1;
    } else {
      log(`UPDATED=<dry-run> ${item.offerId}`);
      results.push({
        offerId: item.offerId,
        result: "SUCCESS",
        affiliateUrl: outcome.affiliateUrl,
      });
    }

    if (config.cooldownMs > 0) {
      await new Promise((r) => setTimeout(r, config.cooldownMs));
    }
  }

  log("ML_AFFILIATE_WORKER_END");
  return {
    startedCount: pending.length,
    updatedCount,
    skippedCount,
    failedCount,
    dryRun: config.dryRun,
    results,
  };
}
