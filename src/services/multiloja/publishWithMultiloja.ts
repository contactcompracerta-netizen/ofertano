import prisma from "@/lib/prisma";

import {
  saveProduct,
  sincronizarMelhorOfertaDoProduto,
} from "@/services/database/saveProduct";

import type {
  SaveProductOptions,
} from "@/services/database/saveProduct";

import {
  buscarComparacaoManual,
} from "@/services/comparison/manualComparison";

import {
  agendarComparacaoMultilojaDoProduto,
} from "@/services/multiloja/orchestrator";

import {
  reconstruirReferenciaMultiloja,
} from "@/services/multiloja/reference";

import type {
  ProductImport,
} from "@/services/importers/core/types";

export type PublicarProdutoComMultilojaOptions =
  Omit<
    SaveProductOptions,
    | "deferPublication"
    | "suppressPublicationSync"
  > & {
    /*
     * Mantemos a fila apenas como contingencia.
     * Ela nunca e o caminho normal da publicacao inicial.
     */
    queueOnFailure?: boolean;

    /*
     * Quando informado, o Product so pode sair de DRAFT se possuir pelo
     * menos esta quantidade de marketplaces EXACT ativas. A pesquisa
     * publica usa 2 para garantir que todo produto novo ja nasca Multi Loja.
     */
    minimumExactStores?: number;
  };

export async function publicarProdutoComMultiloja(
  product: ProductImport,
  affiliateLinkOverride?: string | null,
  options: PublicarProdutoComMultilojaOptions = {},
) {
  const {
    queueOnFailure = true,
    minimumExactStores = 1,
    ...saveOptions
  } = options;

  /*
   * ETAPA 1
   *
   * Cria/atualiza Product e oferta de origem,
   * mas ainda invisivel no site.
   */
  const saved =
    await saveProduct(
      product,
      affiliateLinkOverride,
      {
        ...saveOptions,

        deferPublication:
          true,
      },
    );

  try {
    /*
     * O Product salvo contém a identidade já normalizada pelo pipeline
     * central. Usamos essa referência canônica para impedir que diferenças
     * de formato entre Amazon, Mercado Livre, Shopee, Magalu e AliExpress
     * alterem o resultado do mesmo matcher.
     */
    const reference =
      await reconstruirReferenciaMultiloja(
        saved.id,
        product.marketplace,
      );

    /*
     * ETAPA 2
     *
     * Executa Multi Loja imediatamente.
     *
     * Todas as ofertas EXACT sao gravadas,
     * mas nenhuma sincronizacao intermediaria
     * pode publicar o Product.
     */
    const comparison =
      await buscarComparacaoManual(
        reference,
        saved.id,
        {
          suppressProductSync:
            true,
        },
      );

    console.log(
      "[MULTILOJA-IMEDIATO]",
      JSON.stringify(
        {
          productId: saved.id,
          title: reference.title,
          sourceMarketplace:
            reference.marketplace,
          comparison,
        },
        null,
        2,
      ),
    );

    const exactStores =
      await prisma.marketplaceOffer.count({
        where: {
          productId: saved.id,
          active: true,
          available: true,
          matchStatus: "EXACT",
        },
      });

    if (exactStores < Math.max(1, minimumExactStores)) {
      throw new Error(
        `Multi Loja incompleto: ${exactStores} loja(s) EXACT encontrada(s); ` +
          `minimo exigido: ${Math.max(1, minimumExactStores)}.`,
      );
    }

    /*
     * ETAPA 3
     *
     * A comparacao terminou.
     *
     * Agora fazemos UMA unica sincronizacao:
     * - escolhe menor oferta EXACT;
     * - atualiza store/preco/link;
     * - calcula publicationStatus;
     * - ativa o Product.
     */
    const published =
      await prisma.$transaction(
        async (tx) =>
          sincronizarMelhorOfertaDoProduto(
            tx,
            saved.id,
          ),
      );

    return {
      product:
        published,

      comparison,

      queuedForRetry:
        false,
    };
  } catch (error) {
    /*
     * O Product continua:
     *
     * publicationStatus = DRAFT
     * active = false
     *
     * Portanto nunca aparece incompleto no site.
     */

    let queuedForRetry =
      false;

    if (queueOnFailure) {
      try {
        queuedForRetry =
          await agendarComparacaoMultilojaDoProduto(
            saved.id,
            product.marketplace,
          );
      } catch (
        queueError
      ) {
        console.error(
          "Falha ao agendar retry do Multi Loja:",
          queueError,
        );
      }
    }

    const detalhe =
      error instanceof Error
        ? error.message
        : String(error);

    throw new Error(
      queuedForRetry
        ? "O produto foi importado, mas o Multi Loja nao terminou. " +
          "Ele permaneceu oculto e foi enviado para retry. " +
          `Detalhe: ${detalhe}`
        : "O produto foi importado, mas o Multi Loja nao terminou. " +
          "Ele permaneceu oculto e nao foi publicado. " +
          `Detalhe: ${detalhe}`,
    );
  }
}
