import {
    NextRequest,
    NextResponse,
  } from "next/server";
  
  import {
    getAccessToken,
  } from "@/lib/mercadolivre";
  
  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";
  
  const MERCADO_LIVRE_API =
    "https://api.mercadolibre.com";
  
  const PUBLIC_ATTRIBUTES = [
    "id",
    "title",
    "price",
    "original_price",
    "category_id",
    "seller_id",
    "available_quantity",
    "condition",
    "warranty",
    "permalink",
    "thumbnail",
    "secure_thumbnail",
    "pictures",
    "attributes",
    "catalog_product_id",
    "status",
  ];
  
  export async function GET(
    request: NextRequest,
  ) {
    try {
      const itemId = (
        request.nextUrl
          .searchParams
          .get("itemId") ?? ""
      )
        .trim()
        .toUpperCase();
  
      if (!/^MLB\d+$/.test(itemId)) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Informe um itemId válido. Exemplo: MLB4224584697.",
          },
          {
            status: 400,
          },
        );
      }
  
      const token =
        await getAccessToken();
  
      const params =
        new URLSearchParams({
          ids: itemId,
          attributes:
            PUBLIC_ATTRIBUTES.join(","),
        });
  
      const endpoint =
        `${MERCADO_LIVRE_API}/items?${params.toString()}`;
  
      const response =
        await fetch(endpoint, {
          method: "GET",
  
          headers: {
            Authorization:
              `Bearer ${token}`,
  
            Accept:
              "application/json",
          },
  
          cache: "no-store",
        });
  
      const text =
        await response.text();
  
      let data: unknown = text;
  
      try {
        data = JSON.parse(
          text,
        ) as unknown;
      } catch {
        // Mantém como texto quando
        // a resposta não for JSON.
      }
  
      return NextResponse.json({
        success: true,
        itemId,
  
        mercadoLivreStatus:
          response.status,
  
        mercadoLivreOk:
          response.ok,
  
        requestedAttributes:
          PUBLIC_ATTRIBUTES,
  
        response:
          data,
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Erro desconhecido.";
  
      return NextResponse.json(
        {
          success: false,
          error: message,
        },
        {
          status: 500,
        },
      );
    }
  }