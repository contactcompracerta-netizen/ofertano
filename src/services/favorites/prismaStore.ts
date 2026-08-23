import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

import { criarErroDuplicado } from "./errors";
import type { FavoriteStore } from "./types";

export const prismaFavoriteStore: FavoriteStore = {
  async productExists(productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });

    return Boolean(product);
  },

  async findByUserAndProduct(userId, productId) {
    return prisma.favorite.findUnique({
      where: {
        userId_productId: {
          userId,
          productId,
        },
      },
    });
  },

  async listByUser(userId) {
    return prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  },

  async create(userId, productId) {
    try {
      return await prisma.favorite.create({
        data: {
          userId,
          productId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw criarErroDuplicado();
      }

      throw error;
    }
  },

  async deleteByUserAndProduct(userId, productId) {
    try {
      await prisma.favorite.delete({
        where: {
          userId_productId: {
            userId,
            productId,
          },
        },
      });

      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        return false;
      }

      throw error;
    }
  },
};
