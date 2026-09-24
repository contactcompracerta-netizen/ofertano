/**
 * CATALOG_ARCHITECTURE_V1 — AUDITORIA PÓS-DEPLOY (read-only, dry-run).
 *
 * Executa o mesmíssimo reconciliador da rota GET /api/admin/reconcile-catalog
 * em dry-run: NUNCA escreve (escritas gateadas por !dryRun), apenas conta
 * produtos auto-criados e ativos com menos de 2 marketplaces públicos
 * distintos. Invariante: AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=0.
 *
 * Uso: npx tsx scripts/audit-reconcile-prod.ts
 */
import "dotenv/config";

import { reconcileCatalog } from "@/services/catalog/reconciliation";
import { createPrismaCatalogReconciliationRepository } from "@/services/catalog/reconciliationRepository";

async function main(): Promise<void> {
  const result = await reconcileCatalog(
    createPrismaCatalogReconciliationRepository(),
    { dryRun: true },
  );

  console.log(
    JSON.stringify(
      {
        metric:
          result.violations.length === 0
            ? "AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=0"
            : `AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=${result.violations.length}`,
        scanned: result.scanned,
        violations: result.violations.length,
        written: result.written,
        skipped: result.skipped,
        dryRun: result.dryRun,
        DATABASE_WRITES_PERFORMED: false,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});