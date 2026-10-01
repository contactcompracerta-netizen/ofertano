/**
 * RECONCILIADOR DE VISIBILIDADE DE PUBLICAÇÃO.
 *
 * ============================================================================
 * INVARIANTE
 * ============================================================================
 * "publicado no banco" NÃO pode divergir de "visível publicamente".
 *
 * O gate de LEITURA de todo produto é `hasPublicMultiStore(...)` — a página do
 * produto, a Home, a busca, o sitemap e as categorias usam esse mesmo
 * predicado. Logo, um Product `active=true` + LIVE_* que NÃO tem Multi Loja
 * pública é um estado FANTASMA: o banco diz "publicado" e o site diz "404".
 *
 * ============================================================================
 * AÇÃO CANÔNICA (não é escolha deste script)
 * ============================================================================
 * `publicationStatus = "DRAFT"` + `active = false` é a MESMA combinação usada
 * pelo caminho de escrita real (`sincronizarMelhorOfertaDoProduto`, em
 * `src/services/database/saveProduct.ts`) e pelos reconciliadores centrais
 * (`src/services/catalog/reconciliation.ts`, `phase-p-publication-reconcile`).
 *
 * Aquele caminho, porém, só demove `autoCreated=true` (o fluxo automático);
 * Product `autoCreated=false` fica `active=true` por contrato legado mesmo sem
 * Multi Loja. Enquanto isso, a LEITURA esconde o produto de qualquer forma.
 * O resultado é um registro `active` que nunca aparece — medido pelo gate
 * `STALE_LIVE_WITHOUT_MULTISTORE`.
 *
 * Este script converge o estado persistido para a visibilidade REAL, usando o
 * MESMO predicado de leitura (`hasPublicMultiStore`) e a MESMA ação canônica.
 * Não muda nada visível ao usuário (o produto já estava oculto): apenas impede
 * que o banco afirme "publicado" sobre uma página que não existe.
 *
 * ============================================================================
 * SEGURANÇA
 * ============================================================================
 * - DRY-RUN por padrão: sem `--apply`, ZERO escritas.
 * - `--apply` exige `--product-id` (nada de lote cego).
 * - CAS: re-lê o produto dentro da transação e só escreve se ainda estiver no
 *   estado observado no dry-run.
 * - NUNCA apaga Product, MarketplaceOffer, PriceHistory ou RawMarketplaceListing.
 * - Sempre lê as ofertas com o mesmo `where` público dos demais gates.
 *
 * USO
 *   npx tsx --env-file=.env.local src/scripts/reconcile-publication-visibility.ts
 *   npx tsx --env-file=.env.local src/scripts/reconcile-publication-visibility.ts \
 *     --apply --product-id=<uuid>
 */

import prisma from "../lib/prisma";
import {
  hasPublicMultiStore,
  type PublicOfferLike,
} from "../services/publicVisibility/multiStoreVisibility";

export type VisibilityArgs = {
  aplicar: boolean;
  productId?: string;
  limite: number;
};

export function parseVisibilityArgs(argv: string[]): VisibilityArgs {
  const valor = (nome: string) => {
    const prefixo = `--${nome}=`;
    const bruto = argv.find((arg) => arg.startsWith(prefixo));
    return bruto ? bruto.slice(prefixo.length) : undefined;
  };

  const limiteBruto = valor("limit");
  const limite = limiteBruto === undefined ? 50 : Number(limiteBruto);

  if (!Number.isInteger(limite) || limite < 1) {
    throw new Error(`--limit invalido: ${limiteBruto}`);
  }

  const aplicar = argv.includes("--apply");
  const productId = valor("product-id")?.trim() || undefined;

  if (aplicar && !productId) {
    throw new Error("--apply exige --product-id (nada de escrita em lote)");
  }

  return { aplicar, productId, limite };
}

export const OFERTAS_PUBLICAS_WHERE = {
  active: true,
  matchStatus: "EXACT" as const,
} as const;

export async function listarFantasmasPublicacao(
  productId: string | undefined,
  limite: number,
) {
  const produtos = await prisma.product.findMany({
    where: {
      active: true,
      publicationStatus: { in: ["LIVE_PARTIAL", "LIVE_COMPLETE"] },
      ...(productId ? { id: productId } : {}),
    },
    select: {
      id: true,
      name: true,
      autoCreated: true,
      active: true,
      publicationStatus: true,
      offers: {
        where: OFERTAS_PUBLICAS_WHERE,
        select: {
          marketplace: true,
          available: true,
          status: true,
          price: true,
          externalId: true,
          sourceUrl: true,
        },
      },
    },
    take: limite,
  });

  return produtos
    .filter((produto) => !hasPublicMultiStore(produto.offers as PublicOfferLike[]))
    .map((produto) => ({
      productId: produto.id,
      name: produto.name,
      autoCreated: produto.autoCreated,
      active: produto.active,
      publicationStatus: produto.publicationStatus,
      publicOffers: produto.offers.length,
    }));
}

async function main() {
  const args = parseVisibilityArgs(process.argv.slice(2));

  console.log(
    `PUBLICATION_VISIBILITY_RECONCILE_MODE=${args.aplicar ? "APPLY" : "DRY_RUN"}`,
  );

  const fantasmas = await listarFantasmasPublicacao(
    args.productId,
    args.limite,
  );

  console.log(`PHANTOM_PUBLISHED=${fantasmas.length}`);

  for (const fantasma of fantasmas) {
    console.log(
      [
        "PHANTOM",
        fantasma.productId,
        `autoCreated=${fantasma.autoCreated}`,
        `active=${fantasma.active}`,
        `publicationStatus=${fantasma.publicationStatus}`,
        `publicOffers=${fantasma.publicOffers}`,
        `name=${JSON.stringify(fantasma.name)}`,
      ].join(" "),
    );
  }

  if (!args.aplicar) {
    console.log("WRITES=0 (dry-run)");
    return;
  }

  let escritas = 0;

  for (const fantasma of fantasmas) {
    const aplicado = await prisma.$transaction(async (tx) => {
      const atual = await tx.product.findUnique({
        where: { id: fantasma.productId },
        select: { active: true, publicationStatus: true },
      });

      if (!atual) {
        return false;
      }

      /* CAS: o estado observado no dry-run ainda é o estado atual? */
      if (
        atual.active !== fantasma.active ||
        atual.publicationStatus !== fantasma.publicationStatus
      ) {
        return false;
      }

      await tx.product.update({
        where: { id: fantasma.productId },
        data: { active: false, publicationStatus: "DRAFT" },
      });

      return true;
    });

    if (aplicado) {
      escritas += 1;
    }

    console.log(
      `CONVERGED ${fantasma.productId} applied=${aplicado}`,
    );
  }

  console.log(`WRITES_EMITTED=${escritas}`);
}

const ehEntrypoint =
  process.argv[1]?.includes("reconcile-publication-visibility") ?? false;

if (ehEntrypoint) {
  void main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
