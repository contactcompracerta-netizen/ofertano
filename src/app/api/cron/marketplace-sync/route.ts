/**
 * FASE 9.22 — SYNC AUTOMATICO DE MARKETPLACE PUBLICO (endpoint protegido).
 *
 * Dispara um ciclo do `MarketplacePublicSyncV1` para um marketplace de
 * CONNECTOR AUTORIZADO. Nao ha nada de especifico de Shopee aqui: o
 * marketplace vem da query string e e validado contra uma allowlist.
 *
 * AUTENTICACAO: `CRON_SECRET` no header `Authorization: Bearer`, o mesmo
 * padrao ja usado por `/api/cron/cutover-autopilot`. Sem credencial
 * configurada ou sem header correto => 401, e nada e executado.
 *
 * ALLOWLIST: `isCronSyncAllowed`. Um marketplace arbitrario vindo da internet
 * seria um amplificador de custo e um vetor de coleta nao autorizada, entao
 * `?marketplace=` desconhecido devolve 400 sem tocar em nada.
 *
 * SEGURANCA OPERACIONAL:
 *   - o parametro `dry` e o DEFAULT (`dry=true`): sem `?dry=false` explicito
 *     o endpoint nao escreve. Um endpoint de cron nunca deve gravar por
 *     acidente.
 *   - o writer so grava ofertas EXACT unicas; `Product.active` e decidido
 *     pelo gate central, nunca aqui.
 *   - falha de uma execucao nao derruba o job: o relatorio sai com
 *     `success: false` e 200, para que o agendamento siga com o proximo
 *     ciclo e o operador leia o erro.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { runMarketplacePublicSync } from "@/services/architecture/v1/publicSync/runner";
import { createPrismaPublicOfferCommitter } from "@/services/architecture/v1/publicSync/offerWriter";
import {
  createBlockingKeyLookup,
  createKnownBindingLookup,
  createProductListingLoader,
  evaluateIdentityConfidence,
} from "@/services/architecture/v1/publicSync/prismaDeps";
import { authorizePublicSync, isCronSyncAllowed } from "@/services/architecture/v1/publicSync/flags";
import { shopeePublicSyncConfig } from "@/services/architecture/v1/publicSync/connectors/shopeePublicSync";
import { magaluPublicSyncConfig } from "@/services/architecture/v1/publicSync/connectors/magaluPublicSync";
import { amazonPublicSyncConfig } from "@/services/architecture/v1/publicSync/connectors/amazonPublicSync";
import { toCanonicalMarketplaceId } from "@/services/architecture/v1/publication/shadowWeight";
import type { PublicSyncConfig } from "@/services/architecture/v1/publicSync/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Fabrica de configuracao por marketplace. Adicionar uma fonte e uma linha
 * aqui: o endpoint, a autenticacao e o runner nao mudam.
 */
type PublicSyncConfigFactory = (options: {
  maxListings: number;
  pageSize: number;
  maxPages: number;
}) => PublicSyncConfig;

const SYNC_CONFIG: Record<string, PublicSyncConfigFactory> = {
  shopee: (options) =>
    shopeePublicSyncConfig({ ...options, brandLexicon: new Set<string>() }),
  magazine_luiza: (options) =>
    magaluPublicSyncConfig({ ...options, brandLexicon: new Set<string>() }),
  amazon: (options) =>
    amazonPublicSyncConfig({ ...options, brandLexicon: new Set<string>() }),
};

function unauthorized() {
  return NextResponse.json(
    { success: false, error: "Acesso não autorizado." },
    { status: 401 },
  );
}

function badRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return unauthorized();
  }

  const url = new URL(request.url);
  const rawMarketplace = url.searchParams.get("marketplace") ?? "shopee";
  const marketplaceId = toCanonicalMarketplaceId(rawMarketplace);

  // Allowlist de sync: desconhecido nao executa nada.
  if (!isCronSyncAllowed(marketplaceId)) {
    return badRequest(`MARKETPLACE_NOT_IN_SYNC_ALLOWLIST: ${marketplaceId}`);
  }
  const factory = SYNC_CONFIG[marketplaceId];
  if (!factory) {
    return badRequest(`MARKETPLACE_SEM_CONFIG: ${marketplaceId}`);
  }

  // Allowlist de ESCRITA e independente da de sync: se a fonte nao pode
  // escrever oferta publica, um disparo de cron que "escreve nada" seria
  // enganoso. Devolve 403 e o operador ve o motivo.
  const authorization = authorizePublicSync(marketplaceId);
  if (!authorization.authorized) {
    return NextResponse.json(
      {
        success: false,
        error: `WRITER_NOT_AUTHORIZED: ${authorization.reason}`,
        marketplace: marketplaceId,
      },
      { status: 403 },
    );
  }

  // DRY-RUN e o DEFAULT. Gravar exige `?dry=false` explicito.
  const dry = url.searchParams.get("dry") !== "false";
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
  const maxListings = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 25;

  try {
    const report = await runMarketplacePublicSync(
      factory({ maxListings, pageSize: 20, maxPages: 1 }),
      {
        keys: createBlockingKeyLookup(prisma),
        products: createProductListingLoader(prisma),
        evaluate: evaluateIdentityConfidence,
        knownBindings: createKnownBindingLookup(prisma),
        writer: createPrismaPublicOfferCommitter(prisma),
      },
      { dryRun: dry, maxListings },
    );

    return NextResponse.json({
      success: report.ERROR === null,
      marketplace: marketplaceId,
      writerMode: authorization.mode,
      dryRun: dry,
      maxListings,
      report: {
        LISTINGS_COLLECTED: report.LISTINGS_COLLECTED,
        LISTINGS_VALID: report.LISTINGS_VALID,
        LISTINGS_WITH_KEYS: report.LISTINGS_WITH_KEYS,
        CANDIDATES: report.CANDIDATES,
        EXACT_UNIQUE: report.EXACT_UNIQUE,
        REVIEW: report.REVIEW,
        REJECT: report.REJECT,
        HARD_CONFLICT: report.HARD_CONFLICT,
        AMBIGUOUS_EXACT: report.AMBIGUOUS_EXACT,
        NO_CANDIDATES: report.NO_CANDIDATES,
        NO_EXACT: report.NO_EXACT,
        CERTIFIED_BINDINGS: report.CERTIFIED_BINDINGS,
        BINDING_REFRESH_MATCHED: report.BINDING_REFRESH_MATCHED,
        BINDING_REFRESH_WRITES: report.BINDING_REFRESH_WRITES,
        BINDING_REFRESH_NOOP: report.BINDING_REFRESH_NOOP,
        BINDING_NOT_SEEN: report.BINDING_NOT_SEEN,
        BINDING_REFRESH_SKIPPED_BUDGET: report.BINDING_REFRESH_SKIPPED_BUDGET,
        NEW_DISCOVERY_LISTINGS: report.NEW_DISCOVERY_LISTINGS,
        MISSING_AFFILIATE_LINK: report.MISSING_AFFILIATE_LINK,
        INVALID_LINK: report.INVALID_LINK,
        WOULD_WRITE: report.WOULD_WRITE,
        WRITES: report.WRITES,
        WRITES_CREATED: report.WRITES_CREATED,
        WRITES_UPDATED: report.WRITES_UPDATED,
        WRITES_NOOP: report.WRITES_NOOP,
        PRODUCTS_CREATED: report.PRODUCTS_CREATED,
        BINDING_STATUS: report.BINDING_STATUS,
        COLLECT_CALLS: report.COLLECT_CALLS,
        COLLECT_PARTIAL: report.COLLECT_PARTIAL,
        ERROR: report.ERROR,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        marketplace: marketplaceId,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
