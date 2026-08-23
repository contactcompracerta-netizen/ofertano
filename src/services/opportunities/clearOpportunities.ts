import prisma from "@/lib/prisma";

export type ClearOpportunitiesResult = {
  deletedCount: number;
  preservedCount: number;
};

type OpportunityClearClient = {
  importQueue: {
    findMany: (args: {
      where: {
        status: "PROCESSING";
        opportunityId: { not: null };
      };
      select: { opportunityId: true };
    }) => Promise<Array<{ opportunityId: string | null }>>;
  };
  productOpportunity: {
    deleteMany: (args?: {
      where?: { id?: { notIn: string[] } };
    }) => Promise<{ count: number }>;
    count: (args: {
      where: { id: { in: string[] } };
    }) => Promise<number>;
  };
  $transaction: <T>(
    fn: (tx: OpportunityClearClient) => Promise<T>,
  ) => Promise<T>;
};

export function montarFiltroExclusao(
  idsPreservados: string[],
) {
  if (idsPreservados.length === 0) {
    return undefined;
  }

  return {
    id: {
      notIn: idsPreservados,
    },
  };
}

export function montarMensagemLimpeza(params: {
  deletedCount: number;
  preservedCount: number;
}) {
  const { deletedCount, preservedCount } = params;

  if (deletedCount === 0 && preservedCount === 0) {
    return "Nenhuma oportunidade para limpar.";
  }

  if (deletedCount === 0 && preservedCount > 0) {
    return `${preservedCount} oportunidade(s) em processamento foram preservadas.`;
  }

  if (preservedCount > 0) {
    return `${deletedCount} oportunidade(s) removida(s). ${preservedCount} em processamento foram preservadas. Produtos publicados, ofertas e a fila não foram apagados.`;
  }

  return `${deletedCount} oportunidade(s) removida(s). Produtos publicados, ofertas e a fila não foram apagados.`;
}

export async function limparOportunidadesDoPainel(
  client?: OpportunityClearClient,
): Promise<ClearOpportunitiesResult> {
  const db =
    client ??
    (prisma as unknown as OpportunityClearClient);

  return db.$transaction(async (tx) => {
    const emProcessamento =
      await tx.importQueue.findMany({
        where: {
          status: "PROCESSING",
          opportunityId: {
            not: null,
          },
        },
        select: {
          opportunityId: true,
        },
      });

    const idsPreservados = [
      ...new Set(
        emProcessamento
          .map((item) => item.opportunityId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    const filtro = montarFiltroExclusao(idsPreservados);

    const removidas = await tx.productOpportunity.deleteMany(
      filtro
        ? {
            where: filtro,
          }
        : undefined,
    );

    const preservedCount =
      idsPreservados.length === 0
        ? 0
        : await tx.productOpportunity.count({
            where: {
              id: {
                in: idsPreservados,
              },
            },
          });

    return {
      deletedCount: removidas.count,
      preservedCount,
    };
  });
}
