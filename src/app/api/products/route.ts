import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const data = await request.json();

    const product = await prisma.product.create({
      data: {
        name: data.name,
        image: data.image,
        price: Number(data.price),
        oldPrice: data.oldPrice
          ? Number(data.oldPrice)
          : null,
        discount: data.discount
          ? Number(data.discount)
          : null,
        category: data.category,
        store: data.store,
        affiliateLink: data.affiliateLink,
        mlId: data.mlId,
        rating: data.rating
          ? Number(data.rating)
          : null,
        sales: data.sales
          ? Number(data.sales)
          : null,
      },
    });

    return NextResponse.json(product);

  } catch (error) {
    console.log(error);

    return NextResponse.json(
      { error: "Erro ao cadastrar produto" },
      { status: 500 }
    );
  }
}