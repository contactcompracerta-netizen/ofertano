import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RequestBody = {
  ids?: unknown;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;

    if (!Array.isArray(body.ids)) {
      return NextResponse.json(
        {
          success: false,
          error: "Lista de favoritos inválida.",
          products: [],
        },
        { status: 400 }
      );
    }

    const ids = Array.from(
      new Set(
        body.ids
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean)
      )
    ).slice(0, 100);

    if (ids.length === 0) {
      return NextResponse.json({
        success: true,
        products: [],
      });
    }

    const products = await prisma.product.findMany({
      where: {
        id: {
          in: ids,
        },
        active: true,
      },
      select: {
        id: true,
        name: true,
        image: true,
        price: true,
        oldPrice: true,
        discount: true,
        store: true,
        brand: true,
        installments: true,
        rating: true,
        reviews: true,
        stock: true,
      },
    });

    const order = new Map(ids.map((id, index) => [id, index]));

    products.sort(
      (a, b) =>
        (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    );

    return NextResponse.json({
      success: true,
      products,
    });
  } catch (error) {
    console.error("Erro ao carregar favoritos:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Não foi possível carregar seus favoritos.",
        products: [],
      },
      { status: 500 }
    );
  }
}