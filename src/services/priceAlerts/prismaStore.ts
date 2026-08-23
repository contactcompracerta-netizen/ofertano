import { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";

import { criarErroDuplicado } from "./errors";
import type {
  ExactOfferSnapshot,
  PriceAlertEvaluationCommit,
  PriceAlertEventInput,
  PriceAlertProductSummary,
  PriceAlertRecord,
  PriceAlertStore,
  PriceAlertType,
} from "./types";

const productSelect = {
  id: true,
  name: true,
  image: true,
  price: true,
  slug: true,
} satisfies Prisma.ProductSelect;

type PrismaAlert = {
  id: string;
  userId: string;
  productId: string;
  type: PriceAlertType;
  targetPrice: number | null;
  referencePrice: number | null;
  active: boolean;
  armed: boolean;
  lastEvaluatedAt: Date | null;
  lastEvaluatedPrice: number | null;
  lastEvaluatedHadExact: boolean | null;
  lastTriggeredAt: Date | null;
  lastTriggeredPrice: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapearAlerta(alerta: PrismaAlert): PriceAlertRecord {
  return {
    id: alerta.id,
    userId: alerta.userId,
    productId: alerta.productId,
    type: alerta.type,
    targetPrice: alerta.targetPrice,
    referencePrice: alerta.referencePrice,
    active: alerta.active,
    armed: alerta.armed,
    lastEvaluatedAt: alerta.lastEvaluatedAt,
    lastEvaluatedPrice: alerta.lastEvaluatedPrice,
    lastEvaluatedHadExact: alerta.lastEvaluatedHadExact,
    lastTriggeredAt: alerta.lastTriggeredAt,
    lastTriggeredPrice: alerta.lastTriggeredPrice,
    createdAt: alerta.createdAt,
    updatedAt: alerta.updatedAt,
  };
}

function mapearProduto(
  product: {
    id: string;
    name: string;
    image: string;
    price: number;
    slug: string | null;
  } | null
): PriceAlertProductSummary | null {
  if (!product) {
    return null;
  }

  return {
    id: product.id,
    name: product.name,
    image: product.image,
    price: product.price,
    slug: product.slug,
  };
}

export const prismaPriceAlertStore: PriceAlertStore = {
  async productExists(productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });

    return Boolean(product);
  },

  async findProduct(productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: productSelect,
    });

    return mapearProduto(product);
  },

  async findAlertById(id) {
    const alerta = await prisma.priceAlert.findUnique({
      where: { id },
    });

    return alerta ? mapearAlerta(alerta) : null;
  },

  async findAlertByUserProductType(userId, productId, type) {
    const alerta = await prisma.priceAlert.findUnique({
      where: {
        userId_productId_type: {
          userId,
          productId,
          type,
        },
      },
    });

    return alerta ? mapearAlerta(alerta) : null;
  },

  async listAlertsByUser(userId) {
    const lista = await prisma.priceAlert.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return lista.map(mapearAlerta);
  },

  async listActiveAlerts() {
    const lista = await prisma.priceAlert.findMany({
      where: { active: true },
    });

    return lista.map(mapearAlerta);
  },

  async countEventsByAlert(alertId) {
    return prisma.priceAlertEvent.count({
      where: { alertId },
    });
  },

  async createAlert(input) {
    try {
      const alerta = await prisma.priceAlert.create({
        data: {
          userId: input.userId,
          productId: input.productId,
          type: input.type,
          targetPrice: input.targetPrice,
          referencePrice: input.referencePrice,
        },
      });

      return mapearAlerta(alerta);
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

  async updateAlert(id, data) {
    const alerta = await prisma.priceAlert.update({
      where: { id },
      data,
    });

    return mapearAlerta(alerta);
  },

  async deleteAlertByUserAndId(userId, id) {
    const resultado = await prisma.priceAlert.deleteMany({
      where: {
        id,
        userId,
      },
    });

    return resultado.count > 0;
  },

  async listOffersByProductIds(productIds) {
    if (productIds.length === 0) {
      return [];
    }

    const ofertas = await prisma.marketplaceOffer.findMany({
      where: {
        productId: {
          in: productIds,
        },
      },
      select: {
        productId: true,
        marketplace: true,
        matchStatus: true,
        active: true,
        available: true,
        status: true,
        price: true,
      },
    });

    return ofertas.map(
      (oferta): ExactOfferSnapshot => ({
        productId: oferta.productId,
        marketplace: oferta.marketplace,
        matchStatus: oferta.matchStatus,
        active: oferta.active,
        available: oferta.available,
        status: oferta.status,
        price: oferta.price,
      })
    );
  },

  async commitEvaluation(
    alertId,
    data: PriceAlertEvaluationCommit,
    event?: PriceAlertEventInput
  ) {
    const alerta = await prisma.$transaction(async (tx) => {
      const atualizado = await tx.priceAlert.update({
        where: { id: alertId },
        data,
      });

      if (event) {
        await tx.priceAlertEvent.create({
          data: {
            alertId,
            type: event.type,
            price: event.price,
            previousReferencePrice: event.previousReferencePrice,
            targetPrice: event.targetPrice,
            createdAt: data.lastTriggeredAt ?? undefined,
          },
        });
      }

      return atualizado;
    });

    return mapearAlerta(alerta);
  },
};
