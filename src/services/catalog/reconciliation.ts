/*
 * RECONCILIADOR DE APRESENTAÇÃO DO CATÁLOGO (FASE F)
 *
 * Corrige a classe de violação de apresentação do catálogo automático:
 * Product com `autoCreated=true` e `active=true`, mas SEM Multi Loja
 * pública (`hasPublicMultiStore=false`).
 *
 * Contratos de segurança:
 * - DRY-RUN por padrão: sem nenhuma escrita.
 * - canary: `maxWrites` default = 1 (execução conservadora).
 * - zero DELETE: a correção é apenas `DRAFT + active:false`.
 * - fail-closed: erro de repositório aborta a operação inteira.
 * - idempotente: produtos já em DRAFT/inactive não são re-escritos.
 *
 * Camada de domínio/serviço: recebe um repositório injetado, o que
 * permite testar a lógica pura sem banco.
 */

import type {
  PublicOfferLike,
} from "@/services/publicVisibility/multiStoreVisibility";
import {
  hasPublicMultiStore,
  countDistinctPublicMarketplaces,
} from "@/services/publicVisibility/multiStoreVisibility";

export type CatalogViolationCandidate = {
  productId: string;
  name: string;
  autoCreated: boolean;
  active: boolean;
  publicationStatus: string;
  distinctPublicMarketplaces: number;
  hasPublicMultiStore: boolean;
};

export type AutoCreatedActiveProductRow = {
  id: string;
  name: string;
  autoCreated: boolean;
  active: boolean;
  publicationStatus: string;
  offers: PublicOfferLike[];
};

export type CatalogReconciliationRepository = {
  /*
   * Somente Product auto-criado e ativo. A checagem de Multi Loja
   * pública acontece em memória com o MESMO predicado da página.
   */
  listAutoCreatedActiveProducts(): Promise<
    AutoCreatedActiveProductRow[]
  >;

  /*
   * Marca um Product como DRAFT + active=false. Nunca apaga nada.
   * Retorna true quando houve mudança real; false se já estava no
   * estado de destino (idempotente) ou o Product não existe.
   */
  deactivateProductToDraft(
    productId: string,
  ): Promise<boolean>;
};

export type ReconcileCatalogInput = {
  dryRun?: boolean;
  maxWrites?: number;
};

export type ReconcileCatalogResult = {
  dryRun: boolean;
  maxWrites: number;
  scanned: number;
  violations: CatalogViolationCandidate[];
  written: number;
  skipped: number;
};

export const DEFAULT_RECONCILE_MAX_WRITES = 1;
export const RECONCILE_MAX_WRITES_LIMIT = 50;

export function clampMaxWrites(
  value: unknown,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value)
  ) {
    return DEFAULT_RECONCILE_MAX_WRITES;
  }

  return Math.min(
    Math.max(value, 0),
    RECONCILE_MAX_WRITES_LIMIT,
  );
}

/*
 * Identificação PURA das violações de apresentação. Sem I/O:
 * testável sem banco.
 */
export function identifyPresentationViolations(
  products: AutoCreatedActiveProductRow[],
): CatalogViolationCandidate[] {
  return products
    .map((product) => {
      const distinct =
        countDistinctPublicMarketplaces(
          product.offers,
        );

      const multi =
        hasPublicMultiStore({
          offers: product.offers,
        });

      return {
        productId: product.id,
        name: product.name,
        autoCreated: product.autoCreated,
        active: product.active,
        publicationStatus:
          product.publicationStatus,
        distinctPublicMarketplaces: distinct,
        hasPublicMultiStore: multi,
      };
    })
    .filter(
      (candidate) =>
        candidate.autoCreated === true &&
        candidate.active === true &&
        candidate.hasPublicMultiStore === false,
    );
}

export async function reconcileCatalog(
  repository: CatalogReconciliationRepository,
  input: ReconcileCatalogInput = {},
): Promise<ReconcileCatalogResult> {
  const dryRun = input.dryRun ?? true;
  const maxWrites =
    clampMaxWrites(input.maxWrites);

  /*
   * Tudo carregado antes de qualquer escrita (fail-closed: se a
   * leitura falha, nada é escrito).
   */
  const products =
    await repository.listAutoCreatedActiveProducts();

  const violations =
    identifyPresentationViolations(
      products,
    );

  let written = 0;
  let skipped = 0;

  if (
    !dryRun &&
    violations.length > 0
  ) {
    const alvo =
      violations.slice(0, maxWrites);

    for (const violacao of alvo) {
      const produtoCorrigido =
        await repository.deactivateProductToDraft(
          violacao.productId,
        );

      if (produtoCorrigido) {
        written += 1;
      } else {
        skipped += 1;
      }
    }

    skipped +=
      Math.max(
        0,
        violations.length - alvo.length,
      );
  }

  if (dryRun && violations.length > 0) {
    skipped = violations.length;
  }

  return {
    dryRun,
    maxWrites,
    scanned: products.length,
    violations,
    written,
    skipped,
  };
}