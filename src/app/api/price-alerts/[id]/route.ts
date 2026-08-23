import { NextResponse } from "next/server";

import { obterUserIdAutenticado } from "@/lib/supabaseServerAuth";
import {
  PRICE_ALERT_ERROR_CODES,
  PriceAlertError,
} from "@/services/priceAlerts/errors";
import { priceAlerts } from "@/services/priceAlerts/server";
import type { PriceAlertWithDetails } from "@/services/priceAlerts/types";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

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

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const autenticacao = await exigirUsuario(request);

    if (!autenticacao.userId) {
      return autenticacao.response;
    }

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      targetPrice?: unknown;
      active?: unknown;
      armed?: unknown;
    };

    const alerta = await priceAlerts.atualizarAlerta(
      autenticacao.userId,
      id,
      body
    );

    return NextResponse.json({
      success: true,
      alert: serializarAlerta(alerta),
    });
  } catch (error) {
    return responderErro(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const autenticacao = await exigirUsuario(request);

    if (!autenticacao.userId) {
      return autenticacao.response;
    }

    const { id } = await context.params;
    const resultado = await priceAlerts.removerAlerta(
      autenticacao.userId,
      id
    );

    if (!resultado.removed) {
      return NextResponse.json(
        {
          success: false,
          error: "Alerta não encontrado.",
          code: PRICE_ALERT_ERROR_CODES.ALERT_NOT_FOUND,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      removed: true,
      id: resultado.id,
    });
  } catch (error) {
    return responderErro(error);
  }
}
