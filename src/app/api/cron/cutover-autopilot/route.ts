/**
 * CATALOG_ARCHITECTURE_V1 — FASE 7.2: OBSERVADOR DO AUTOPILOT (FASE C/U).
 *
 * Job de cron interno, leve e SEMESTADÁVEL. Não existe loop residente em
 * memória: cada invocação é uma leitura do estado PERSISTIDO, uma decisão e o
 * registro da evidência. Compatível com Vercel/serverless por construção.
 *
 * O que este endpoint NUNCA faz:
 *   - não fabrica tráfego nem escreve no catálogo (nenhuma linha de Product,
 *     MarketplaceOffer ou PriceHistory é tocada);
 *   - não promove por tempo: sem evidência real de processamento, o degrau
 *     não sai (decisão em `decideAutopilot`);
 *   - não fecha breaker sozinho;
 *   - não mexe em publicação;
 *   - não promove acima de 100, não remove o fallback legado e não faz
 *     cutover global.
 *
 * Travas de segurança (FASE Q) — todas obrigatórias para qualquer MUTAÇÃO:
 *   1. `CRON_SECRET` no header `Authorization: Bearer` (mesmo padrão dos
 *      outros crons do projeto);
 *   2. `AUTOPILOT_ENABLED` = ON (default OFF: fail-closed);
 *   3. `VERCEL_ENV` = production (preview/dev NUNCA mutam o plano de controle);
 *   4. marketplace EXPLÍCITO em `AUTOPILOT_MARKETPLACES` (default
 *      `mercado_livre`); nada de "todos os marketplaces";
 *   5. `mode` do rollout tem de ser `V1_PRIMARY_WITH_LEGACY_FALLBACK` e o
 *      `legacyFallbackEnabled` tem de estar ligado — a progressão não pode
 *      remover o fallback legado.
 *
 * CADÊNCIA: `17 12 * * *` — uma vez ao dia, às 12:17 UTC. Três motivos:
 *   - o plano da Vercel deste projeto é Hobby, que SÓ aceita cron diário. A
 *     descoberta veio do próprio deploy recusando `17 * * * *`, e está
 *     documentada em vez de escondida;
 *   - o tráfego orgânico do Mercado Livre chega num burst diário em ~06:10 UTC.
 *     Rodar às 12:17 significa observar o dia INTEIRO antes de decidir, e não
 *     uma janela de minutos;
 *   - o cooldown é de 24h, então mais frequência não promoveria nada mais
 *     cedo: o que limita a progressão é EVIDÊNCIA, não o relógio do cron.
 *     Quem quiser acelerar observation é o operador, com `autopilot-run
 *     --dry-run`, que é idempotente e não muta nada.
 *
 * Nada de segredo é impresso: a resposta traz contadores, estados e motivos.
 */

import { NextResponse } from "next/server";

import { reconcileCatalog } from "@/services/catalog/reconciliation";
import { createPrismaCatalogReconciliationRepository } from "@/services/catalog/reconciliationRepository";
import {
  AUTOPILOT_MIN_OBSERVATION_MS,
  runAutopilotCycleLocked,
  runAutopilotProbes,
  type PublicationAudit,
} from "@/services/architecture/v1/cutover/autopilot";
import { globalControlPool } from "@/services/architecture/v1/cutover/globalControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Só este modo. `V1_PRIMARY` puro continua PROIBIDO na progressão. */
const REQUIRED_MODE = "V1_PRIMARY_WITH_LEGACY_FALLBACK";

function isEnabled(): boolean {
  return process.env.AUTOPILOT_ENABLED === "ON";
}

function targetMarketplaces(): string[] {
  return (process.env.AUTOPILOT_MARKETPLACES ?? "mercado_livre")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/*
 * A lista de probes e o executor moram em `cutover/autopilot.ts`, e não aqui,
 * para que o cron e o operador manual sondem exatamente as mesmas rotas com o
 * mesmo status esperado. Ver a justificativa de `AUTOPILOT_PROBES`.
 *
 * Probes são OBSERVACIONAIS: um 500 externo isolado é registrado e nada mais —
 * não abre breaker e não bloqueia promoção, porque as evidências que promovem
 * (double-write, paridade, orçamento, publicação) são medidas dentro do
 * sistema, não por HTTP público.
 */
function probeOrigin(): string | null {
  return process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : null;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, error: "Acesso não autorizado." },
      { status: 401 },
    );
  }

  const executor = globalControlPool(process.env.DATABASE_URL);
  if (executor === null) {
    return NextResponse.json(
      { success: false, error: "Plano de controle indisponível." },
      { status: 503 },
    );
  }

  const enabled = isEnabled();
  const production = isProduction();
  const allowMutations = enabled && production;
  const probes = await runAutopilotProbes(probeOrigin());

  /*
   * Auditoria de publicação: o MESMO reconciliador do projeto, em dry-run.
   * `dryRun: true` é o default e é o que garante `written = 0` — este
   * endpoint não tem, em hipótese alguma, capacidade de ativar, desativar ou
   * republicar produto. Ele apenas CONTA
   * AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES, que é gate de promoção.
   */
  const publicationAudit = async (): Promise<PublicationAudit> => {
    const result = await reconcileCatalog(
      createPrismaCatalogReconciliationRepository(),
      { dryRun: true },
    );
    return { scanned: result.scanned, violations: result.violations.length };
  };

  try {
    const results = [];
    for (const marketplaceId of targetMarketplaces()) {
      const outcome = await runAutopilotCycleLocked({
        executor,
        marketplaceId,
        enabled: allowMutations,
        allowMutations,
        minObservationMs: AUTOPILOT_MIN_OBSERVATION_MS,
        publicationAudit,
        probes: async () => probes,
      });

      if ("skipped" in outcome) {
        results.push({ marketplaceId, skipped: outcome.reason });
        continue;
      }

      if (
        outcome.promoted &&
        outcome.rollout !== null &&
        (outcome.rollout.mode !== REQUIRED_MODE ||
          outcome.rollout.legacyFallbackEnabled !== true)
      ) {
        // Barreira pós-fato: se alguma promoção saiu com modo errado,
        // o plano volta a LEGACY_ONLY imediatamente, sem novo deploy.
        results.push({
          marketplaceId,
          error: "MODO_OU_FALLBACK_INESPERADO_APOS_PROMOCAO",
        });
        continue;
      }

      results.push({
        marketplaceId,
        state: outcome.state,
        stage: outcome.stage,
        decision: outcome.decision.kind,
        reason: outcome.decision.reason,
        blockers: outcome.decision.blockers,
        promoted: outcome.promoted,
        tripped: outcome.tripped,
        lostRace: outcome.lostRace,
        budgetReconciled: outcome.budgetReconciled,
        maxWrites: outcome.rollout?.maxWrites ?? null,
        usedWrites: outcome.rollout?.usedWrites ?? null,
        breakerState: outcome.rollout?.breakerState ?? null,
        legacyFallbackEnabled: outcome.rollout?.legacyFallbackEnabled ?? null,
        mode: outcome.rollout?.mode ?? null,
        autoActiveWithLt2PublicMarketplaces: outcome.autoActiveLt2,
        uniqueExternalListings: outcome.metrics.uniqueExternalListings,
        v1Committed: outcome.metrics.v1Committed,
        budgetSkipped: outcome.metrics.budgetSkipped,
        skippedReason: outcome.skippedReason,
      });
    }

    return NextResponse.json({
      success: true,
      autopilotEnabled: enabled,
      environment: process.env.VERCEL_ENV ?? null,
      allowMutations,
      globalCutover: "NO",
      legacyFallbackEnabled: true,
      probes,
      results,
      executedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[AUTOPILOT] ciclo falhou", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro interno.",
      },
      { status: 500 },
    );
  }
}
