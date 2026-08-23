import prisma from "@/lib/prisma";
import { buscarComparacaoManual } from "@/services/comparison/manualComparison";
import { publicarProdutoComMultiloja } from "@/services/multiloja/publishWithMultiloja";
import {
  corrigirLinksAmazonPendentes,
} from "@/services/database/saveProduct";
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

  try {
    const linksAmazonCorrigidos =
      await corrigirLinksAmazonPendentes(25);

    if (linksAmazonCorrigidos > 0) {
      console.log(
        `[ImportQueue] ${linksAmazonCorrigidos} link(s) Amazon corrigido(s) automaticamente.`,
      );
    }
  } catch (error) {
    console.error(
      "[ImportQueue] Falha não fatal ao corrigir links Amazon:",
      error,
    );
  }

  const pendentesNovos =
    await prisma.importQueue.findMany({
      where: {
        status: "PENDING",
      },
      orderBy: {
        createdAt: "asc",
      },
      take: limit,
    });

  const vagasRestantes =
    Math.max(
      0,
      limit - pendentesNovos.length,
    );

  const errosRetentaveis =
    vagasRestantes > 0
      ? await prisma.importQueue.findMany({
          where: {
            status: "ERROR",
            attempts: {
              lt: 3,
            },
            productId: {
              not: null,
            },
            opportunityId: null,
          },
          orderBy: {
            createdAt: "asc",
          },
          take: vagasRestantes,
        })
      : [];

  const pendentes = [
    ...pendentesNovos,
    ...errosRetentaveis,
  ];

  if (
    pendentes.length === 0
  ) {
    return {
      success: true,
      message:
        "Não há produtos pendentes na fila.",
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
          status: item.status,
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
     * representa um Product que já foi publicado pela busca do site
     * e agora precisa receber o Multi Loja fora da requisição pública.
     *
     * Nesse modo:
     * - o Product existente NÃO é recriado;
     * - usamos a URL da oferta de referência apenas para reconstruir
     *   o ProductImport necessário ao matcher;
     * - o comparador salva somente ofertas EXACT no mesmo productId;
     * - o trabalho pesado fica na fila e não segura a busca do cliente.
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
          `[ImportQueue] Multi Loja em fila concluído para ${item.productId}: ` +
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
            : "Erro desconhecido ao processar comparação Multi Loja.";

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
       * 1. Link individual já salvo na fila;
       * 2. Link individual retornado pelo importador;
       * 3. null -> oferta fica pendente de afiliado.
       */
      const affiliateLink =
        item.affiliateLink?.trim() ||
        imported.affiliateLink?.trim() ||
        null;

      /*
       * Se existe opportunityId, o item foi criado
       * pelo sistema automático de oportunidades.
       *
       * Nesse caso:
       * - Product.autoCreated = true
       * - discoverySource = OPPORTUNITY
       *
       * Itens adicionados manualmente à fila continuam
       * usando o comportamento padrão do saveProduct.
       */
      const {
        product: saved,
        comparison,
      } = await publicarProdutoComMultiloja(
        imported,
        affiliateLink,
        {
          autoCreated:
            Boolean(item.opportunityId),

          discoverySource:
            item.opportunityId
              ? "OPPORTUNITY"
              : "MANUAL",

          queueOnFailure: true,
        },
      );

      console.log(
        `[ImportQueue] Produto ${saved.id} publicado com Multi Loja: ` +
          `${comparison.found} oferta(s) EXACT adicional(is).`,
      );

      /*
       * A publicação da oferta de origem é concluída
       * antes da comparação Multi Loja.
       *
       * Assim, uma falha ou lentidão em outra marketplace
       * nunca desfaz o produto que o robô já importou.
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


