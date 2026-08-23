import { NextResponse } from "next/server";

import { obterUserIdAutenticado } from "@/lib/supabaseServerAuth";
import {
  PRICE_ALERT_ERROR_CODES,
  PriceAlertError,
} from "@/services/priceAlerts/errors";
import { priceAlerts } from "@/services/priceAlerts/server";
import type { PriceAlertWithDetails } from "@/services/priceAlerts/types";

export const dynamic = "force-dynamic";

function serializarAlerta(alerta: PriceAlertWithDetails) {
  return {
    id: alerta.id,
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
    lastTrigger: alerta.lastTrigger,
    triggerCount: alerta.triggerCount,
    createdAt: alerta.createdAt,
    updatedAt: alerta.updatedAt,
    product: alerta.product,
  };
}

function statusDoErro(code: string): number {
  if (code === PRICE_ALERT_ERROR_CODES.ALERT_NOT_FOUND) {
    return 404;
  }

  if (code === PRICE_ALERT_ERROR_CODES.PRODUCT_NOT_FOUND) {
    return 404;
  }

  return 400;
}

function responderErro(error: unknown) {
  if (error instanceof PriceAlertError) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        code: error.code,
      },
      { status: statusDoErro(error.code) }
    );
  }

  console.error("Erro na API de alertas de preço:", error);

  return NextResponse.json(
    {
      success: false,
      error: "Não foi possível processar seus alertas de preço.",
    },
    { status: 500 }
  );
}

async function exigirUsuario(request: Request): Promise<
  | { userId: string; response?: undefined }
  | { userId: null; response: NextResponse }
> {
  const userId = await obterUserIdAutenticado(request);

  if (!userId) {
    return {
      userId: null,
      response: NextResponse.json(
        {
          success: false,
          error: "Entre na sua conta para gerenciar alertas de preço.",
        },
        { status: 401 }
      ),
    };
  }

  return { userId };
}

export async function GET(request: Request) {
  try {
    const autenticacao = await exigirUsuario(request);

    if (!autenticacao.userId) {
      return autenticacao.response;
    }

    const productId = new URL(request.url).searchParams.get(
      "productId"
    );

    const lista = await priceAlerts.listarAlertas(
      autenticacao.userId,
      productId ?? undefined
    );

    return NextResponse.json({
      success: true,
      alerts: lista.map(serializarAlerta),
    });
  } catch (error) {
    return responderErro(error);
  }
}

export async function POST(request: Request) {
  try {
    const autenticacao = await exigirUsuario(request);

    if (!autenticacao.userId) {
      return autenticacao.response;
    }

    const body = (await request.json()) as {
      productId?: unknown;
      type?: unknown;
      targetPrice?: unknown;
    };

    const resultado = await priceAlerts.criarAlerta(
      autenticacao.userId,
      {
        productId: body.productId,
        type: body.type,
        targetPrice: body.targetPrice,
      }
    );

    return NextResponse.json(
      {
        success: true,
        created: resultado.created,
        alert: serializarAlerta(resultado.alert),
      },
      { status: resultado.created ? 201 : 200 }
    );
  } catch (error) {
    return responderErro(error);
  }
}
