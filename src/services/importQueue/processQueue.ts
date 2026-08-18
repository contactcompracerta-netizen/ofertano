import prisma from "@/lib/prisma";
import { buscarComparacaoManual } from "@/services/comparison/manualComparison";
import { saveProduct } from "@/services/database/saveProduct";
import { importarProduto } from "@/services/importers";
import type {
  ProductImport,
  MarketplaceName,
} from "@/services/importers/core/types";

export type QueueProcessResult = {
  success: boolean;
  message: string;
  processed: number;
  imported: number;
  errors: number;
  results: Array<{
    queueId: string;
    url: string;
    success: boolean;
    productId?: string;
    productName?: string;
    error?: string;
  }>;
};

function limitarQuantidade(
  valor: unknown,
): number {
  if (
    typeof valor !== "number" ||
    !Number.isInteger(valor)
  ) {
    return 5;
  }

  return Math.min(
    Math.max(valor, 1),
    10,
  );
}

export async function processImportQueue(
  quantidade: unknown,
): Promise<QueueProcessResult> {
  const limit =
    limitarQuantidade(quantidade);

  const pendentes =
    await prisma.importQueue.findMany({
      where: {
        status: "PENDING",
      },

      orderBy: {
        createdAt: "asc",
      },

      take: limit,
    });

  if (
    pendentes.length === 0
  ) {
    return {
      success: true,
      message:
        "NÃ£o hÃ¡ produtos pendentes na fila.",
      processed: 0,
      imported: 0,
      errors: 0,
      results: [],
    };
  }

  const results:
    QueueProcessResult["results"] = [];

  for (
    const item of pendentes
  ) {
    const reservado =
      await prisma.importQueue.updateMany({
        where: {
          id: item.id,
          status: "PENDING",
        },

        data: {
          status: "PROCESSING",

          attempts: {
            increment: 1,
          },

          errorMessage: null,
        },
      });

    if (
      reservado.count === 0
    ) {
      continue;
    }

    /*
     * MODO COMPARACAO DE PRODUTO JA PUBLICADO
     *
     * Uma linha PENDING com productId preenchido e sem opportunityId
     * representa um Product que jÃ¡ foi publicado pela busca do site
     * e agora precisa receber o Multi Loja fora da requisiÃ§Ã£o pÃºblica.
     *
     * Nesse modo:
     * - o Product existente NÃƒO Ã© recriado;
     * - usamos a URL da oferta de referÃªncia apenas para reconstruir
     *   o ProductImport necessÃ¡rio ao matcher;
     * - o comparador salva somente ofertas EXACT no mesmo productId;
     * - o trabalho pesado fica na fila e nÃ£o segura a busca do cliente.
     */
    if (
      item.productId &&
      !item.opportunityId
    ) {
      try {
        const produtoExistente =
          await prisma.product.findUnique({
            where: {
              id: item.productId,
            },

            select: {
              id: true,
              name: true,
              canonicalName: true,
              brand: true,
              description: true,
              category: true,
              image: true,
              images: true,
              price: true,
              oldPrice: true,
              discount: true,
              installments: true,
              rating: true,
              reviews: true,
              sales: true,
              stock: true,
              affiliateLink: true,
              specifications: true,
              modelNumber: true,
              ean: true,
              gtin: true,
              mpn: true,
              color: true,
              voltage: true,
              size: true,
            },
          });

        if (!produtoExistente) {
          throw new Error(
            `Produto ${item.productId} não encontrado para comparação Multi Loja.`,
          );
        }

        /*
         * Para um Product que já existe no Ofertano não
         * precisamos raspar novamente a página da loja de
         * origem apenas para reconstruir a referência.
         *
         * A MarketplaceOffer já contém:
         * - marketplace;
         * - código externo;
         * - URL;
         * - link afiliado;
         * - vendedor;
         * - preço/estoque da oferta de origem.
         */
        const ofertaReferencia =
          await prisma.marketplaceOffer.findFirst({
            where: {
              productId: item.productId,
              marketplace: item.marketplace,
            },

            orderBy: {
              updatedAt: "desc",
            },

            select: {
              marketplace: true,
              externalId: true,
              sourceUrl: true,
              affiliateLink: true,
              seller: true,
              price: true,
              oldPrice: true,
              installments: true,
              stock: true,
            },
          });

        if (!ofertaReferencia) {
          throw new Error(
            `Oferta de referência ${item.marketplace} não encontrada para o produto ${item.productId}.`,
          );
        }

        const externalIdReferencia =
          ofertaReferencia.externalId?.trim();

        if (!externalIdReferencia) {
          throw new Error(
            `Oferta de referência ${item.marketplace} sem externalId para o produto ${item.productId}.`,
          );
        }

        let marketplaceName: MarketplaceName;

        switch (String(ofertaReferencia.marketplace)) {
          case "MERCADO_LIVRE":
            marketplaceName = "Mercado Livre";
            break;

          case "AMAZON":
            marketplaceName = "Amazon";
            break;

          case "SHOPEE":
            marketplaceName = "Shopee";
            break;

          case "MAGAZINE_LUIZA":
            marketplaceName = "Magazine Luiza";
            break;

          case "ALIEXPRESS":
          case "ALI_EXPRESS":
            marketplaceName = "AliExpress";
            break;

          default:
            throw new Error(
              `Marketplace de referência desconhecido: ${ofertaReferencia.marketplace}.`,
            );
        }

        const attributes: Record<string, string> = {};

        if (
          produtoExistente.specifications &&
          typeof produtoExistente.specifications === "object" &&
          !Array.isArray(produtoExistente.specifications)
        ) {
          for (
            const [key, value]
            of Object.entries(
              produtoExistente.specifications,
            )
          ) {
            if (
              typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean"
            ) {
              attributes[key] =
                String(value);
            }
          }
        }

        if (produtoExistente.modelNumber) {
          attributes.MODEL =
            produtoExistente.modelNumber;
        }

        if (produtoExistente.ean) {
          attributes.EAN =
            produtoExistente.ean;
        }

        if (produtoExistente.gtin) {
          attributes.GTIN =
            produtoExistente.gtin;
        }

        if (produtoExistente.mpn) {
          attributes.MPN =
            produtoExistente.mpn;
        }

        if (produtoExistente.color) {
          attributes.COLOR =
            produtoExistente.color;
        }

        if (produtoExistente.voltage) {
          attributes.VOLTAGE =
            produtoExistente.voltage;
        }

        if (produtoExistente.size) {
          attributes.SIZE =
            produtoExistente.size;
        }

        const referencia: ProductImport = {
          marketplace:
            marketplaceName,

          externalId:
            externalIdReferencia,

          url:
            ofertaReferencia.sourceUrl ||
            item.url,

          affiliateLink:
            ofertaReferencia.affiliateLink ||
            produtoExistente.affiliateLink ||
            null,

          title:
            produtoExistente.canonicalName?.trim() ||
            produtoExistente.name,

          description:
            produtoExistente.description,

          brand:
            produtoExistente.brand,

          category:
            produtoExistente.category,

          image:
            produtoExistente.image,

          images:
            produtoExistente.images,

          price:
            ofertaReferencia.price ??
            produtoExistente.price,

          oldPrice:
            ofertaReferencia.oldPrice ??
            produtoExistente.oldPrice,

          discount:
            produtoExistente.discount,

          installments:
            ofertaReferencia.installments ??
            produtoExistente.installments,

          rating:
            produtoExistente.rating,

          reviews:
            produtoExistente.reviews,

          sales:
            produtoExistente.sales,

          stock:
            ofertaReferencia.stock ??
            produtoExistente.stock,

          seller:
            ofertaReferencia.seller,

          attributes,
        };

        const comparison =
          await buscarComparacaoManual(
            referencia,
            item.productId,
          );

        const processedAt =
          new Date();

        await prisma.importQueue.update({
          where: {
            id: item.id,
          },

          data: {
            status: "SUCCESS",
            errorMessage: null,
            processedAt,
          },
        });

        console.log(
          `[ImportQueue] Multi Loja em fila concluÃ­do para ${item.productId}: ` +
            `${comparison.found} oferta(s) EXACT encontrada(s).`,
        );

        if (
          comparison.errors.length > 0
        ) {
          console.warn(
            `[ImportQueue] Multi Loja em fila de ${item.productId} terminou com avisos:`,
            comparison.errors,
          );
        }

        results.push({
          queueId:
            item.id,

          url:
            item.url,

          success:
            true,

          productId:
            item.productId,

          productName:
            produtoExistente.name,
        });
      } catch (error) {
        const mensagem =
          error instanceof Error
            ? error.message
            : "Erro desconhecido ao processar comparaÃ§Ã£o Multi Loja.";

        const processedAt =
          new Date();

        const errorMessage =
          mensagem.slice(
            0,
            2000,
          );

        await prisma.importQueue.update({
          where: {
            id: item.id,
          },

          data: {
            status:
              "ERROR",

            errorMessage,

            processedAt,
          },
        });

        results.push({
          queueId:
            item.id,

          url:
            item.url,

          success:
            false,

          productId:
            item.productId,

          error:
            mensagem,
        });
      }

      continue;
    }

    try {
      const imported =
        await importarProduto(
          item.url,
        );

      /*
       * Prioridade do link:
       *
       * 1. Link individual jÃ¡ salvo na fila;
       * 2. Link individual retornado pelo importador;
       * 3. null -> oferta fica pendente de afiliado.
       */
      const affiliateLink =
        item.affiliateLink?.trim() ||
        imported.affiliateLink?.trim() ||
        null;

      /*
       * Se existe opportunityId, o item foi criado
       * pelo sistema automÃ¡tico de oportunidades.
       *
       * Nesse caso:
       * - Product.autoCreated = true
       * - discoverySource = OPPORTUNITY
       *
       * Itens adicionados manualmente Ã  fila continuam
       * usando o comportamento padrÃ£o do saveProduct.
       */
      const saved =
        await saveProduct(
          imported,
          affiliateLink,
          item.opportunityId
            ? {
                autoCreated: true,
                discoverySource:
                  "OPPORTUNITY",
              }
            : undefined,
        );

      /*
       * A publicaÃ§Ã£o da oferta de origem Ã© concluÃ­da
       * antes da comparaÃ§Ã£o Multi Loja.
       *
       * Assim, uma falha ou lentidÃ£o em outra marketplace
       * nunca desfaz o produto que o robÃ´ jÃ¡ importou.
       */
      const processedAt =
        new Date();

      await prisma.$transaction(
        async (tx) => {
          await tx.importQueue.update({
            where: {
              id: item.id,
            },

            data: {
              status: "SUCCESS",
              productId: saved.id,
              errorMessage: null,
              processedAt,
            },
          });

          if (
            item.opportunityId
          ) {
            await tx.productOpportunity.updateMany({
              where: {
                id:
                  item.opportunityId,

                status: {
                  in: [
                    "QUEUED",
                    "READY_TO_QUEUE",
                    "ERROR",
                  ],
                },
              },

              data: {
                status:
                  "PUBLISHED",

                productId:
                  saved.id,

                errorMessage:
                  null,

                publishedAt:
                  processedAt,
              },
            });
          }
        },
      );

      /*
       * ETAPA MULTI LOJA
       *
       * Depois que a oferta de origem jÃ¡ estÃ¡ salva no
       * Product canÃ´nico, executamos o mesmo comparador
       * usado pela importaÃ§Ã£o manual.
       *
       * O comparador:
       * - consulta as marketplaces integradas;
       * - ignora a marketplace de origem;
       * - valida identidade/variante com matcher estrito;
       * - aceita somente EXACT;
       * - salva a oferta no mesmo targetProductId;
       * - nÃ£o forÃ§a presenÃ§a nas 5 lojas.
       *
       * Qualquer erro aqui Ã© nÃ£o fatal:
       * o produto de origem continua publicado e poderÃ¡
       * ser pesquisado novamente posteriormente.
       */
      try {
        const comparison =
          await buscarComparacaoManual(
            imported,
            saved.id,
          );

        console.log(
          `[ImportQueue] Multi Loja concluÃ­do para ${saved.id}: ` +
            `${comparison.found} oferta(s) EXACT encontrada(s).`,
        );

        if (
          comparison.errors.length > 0
        ) {
          console.warn(
            `[ImportQueue] Multi Loja de ${saved.id} terminou com avisos:`,
            comparison.errors,
          );
        }
      } catch (comparisonError) {
        console.error(
          `[ImportQueue] Falha nÃ£o fatal no Multi Loja do produto ${saved.id}:`,
          comparisonError,
        );
      }

      results.push({
        queueId:
          item.id,

        url:
          item.url,

        success:
          true,

        productId:
          saved.id,

        productName:
          saved.name,
      });
    } catch (error) {
      const mensagem =
        error instanceof Error
          ? error.message
          : "Erro desconhecido ao importar.";

      const processedAt =
        new Date();

      const errorMessage =
        mensagem.slice(
          0,
          2000,
        );

      await prisma.$transaction(
        async (tx) => {
          await tx.importQueue.update({
            where: {
              id: item.id,
            },

            data: {
              status:
                "ERROR",

              errorMessage,

              processedAt,
            },
          });

          if (
            item.opportunityId
          ) {
            await tx.productOpportunity.updateMany({
              where: {
                id:
                  item.opportunityId,

                status: {
                  in: [
                    "QUEUED",
                    "READY_TO_QUEUE",
                    "ERROR",
                  ],
                },
              },

              data: {
                status:
                  "ERROR",

                attempts: {
                  increment: 1,
                },

                errorMessage,
              },
            });
          }
        },
      );

      results.push({
        queueId:
          item.id,

        url:
          item.url,

        success:
          false,

        error:
          mensagem,
      });
    }
  }

  const imported =
    results.filter(
      (resultado) =>
        resultado.success,
    ).length;

  const errors =
    results.length -
    imported;

  return {
    success: true,

    message:
      `${imported} produto(s) importado(s) e ${errors} erro(s).`,

    processed:
      results.length,

    imported,

    errors,

    results,
  };
}


