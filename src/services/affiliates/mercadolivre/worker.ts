import type { GenerateOutcome } from "./generator";
import { confirmarAffiliateLinkMercadoLivre } from "@/lib/affiliates/publicPurchase";
import type { MercadoLivreApplyStore, MercadoLivrePendingStore } from "./pending";

export type GeneratorFn = (input: {
  sourceUrl: string;
  expectedItemId: string | null;
  /**
   * Permalink do ANÚNCIO, quando a hidratação conseguiu prová-lo.
   *
   * O worker não hidrata sozinho: recebe a hydrated URL por injeção. Isso
   * mantém o worker testável sem rede e deixa a política (quando hidratar)
   * explícita no chamador, em vez de escondida no meio do processamento.
   */
  exactItemUrl?: string | null;
  inputMode?: string;
}) => Promise<GenerateOutcome>;

/**
 * Hidratação do anúncio: `externalId -> permalink oficial`.
 *
 * Injetada, não importada: `hydrateExactItemPermalink` chama a API do ML, e o
 * worker precisa poder rodar em teste sem rede. A política é "hidratar sempre
 * que houver externalId" — declarada aqui, executada pelo chamador.
 */
export type HydrateItemFn = (itemId: string) => Promise<{
  ok: boolean;
  permalink?: string;
  reason?: string;
  disposition?: "RETRY" | "NO_RETRY";
}>;

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
  /** Hidratação do anúncio falhou; nada foi gerado nem gravado. */
  | { offerId: string; result: "ITEM_HYDRATION_FAILED"; reason: string }
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
    /**
     * Hidratação do anúncio exato. Ausente = fluxo legado, que alimenta o
     * Link Builder com a `sourceUrl` de catálogo.
     *
     * Existe como opção, e não como padrão, por um motivo concreto: sem ela
     * o worker ainda funciona, mas o gerador passa a receber página de
     * catálogo — que a validação estrita recusa. Ou seja, a ausência de
     * hidratação não é neutra: é degradação silenciosa. Por isso, quando
     * existe externalId e não há hidratação, isso é registrado no log.
     */
    hydrate?: HydrateItemFn;
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

    /*
     * Hidratação do ANÚNCIO antes do Link Builder.
     *
     * `item.sourceUrl` é a URL que a oferta carrega, e em produção ela é
     * `/p/MLB...` — catálogo. Alimentar o Link Builder com ela produz link que
     * identifica o produto, não o anúncio. Então, quando há `externalId`,
     * pedimos o permalink do anúncio ao ML.
     *
     * Falha de hidratação NÃO é degradada para "gerar com o catálogo": seria
     * voltar ao link de anúncio errado, e a validação estrita existe
     * exatamente para impedir isso. A oferta fica na fila, com o motivo.
     */
    let exactItemUrl: string | null = null;
    const expected = item.externalId?.trim() || null;

    if (expected) {
      if (input.hydrate) {
        const h = await input.hydrate(expected);
        if (h?.ok && h.permalink) {
          exactItemUrl = h.permalink;
          log("AFFILIATE_INPUT_MODE=EXACT_ITEM_PERMALINK");
        } else {
          log(
            `ITEM_HYDRATION_FAILED=${h?.disposition ?? "RETRY"} ` +
              "link de catálogo não será usado",
          );
          results.push({
            offerId: item.offerId,
            result: "ITEM_HYDRATION_FAILED",
            reason: h?.reason ?? "Hidratação do anúncio não confirmou permalink.",
          });
          failedCount += 1;
          continue;
        }
      } else {
        // Degradação explícita, não silenciosa.
        log(
          "AFFILIATE_INPUT_MODE=CATALOG_URL_FALLBACK " +
            "(sem hidratação configurada; destino de catálogo será recusado)",
        );
      }
    } else {
      log("AFFILIATE_INPUT_MODE=NO_ITEM_ID (oferta sem externalId)");
    }

    const outcome = await input.generate({
      sourceUrl: item.sourceUrl,
      expectedItemId: expected,
      exactItemUrl,
      inputMode: exactItemUrl ? "EXACT_ITEM_PERMALINK" : "CATALOG_URL_FALLBACK",
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
