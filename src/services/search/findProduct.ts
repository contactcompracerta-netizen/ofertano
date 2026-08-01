import prisma from "@/lib/prisma";

export async function findProduct(externalId: string) {

  return prisma.product.findUnique({

    where: {

      mlId: externalId,

    },

  });

}