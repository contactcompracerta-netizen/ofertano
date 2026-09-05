/**
 * Motor de alertas automaticos de preco.
 *
 * processProductAlerts avalia todos os alertas ativos de um produto,
 * aplica a regra do usuario, o dedupe/cooldown por canal e dispara os
 * canais escolhidos. Falha em um canal nunca quebra os demais nem o
 * monitor: cada canal registra um resultado distinto.
 *
 * O ponto ideal de invocacao e o processPriceMonitor, APOS o novo preco
 * ter sido persistido (e o historico atualizado). Nunca antes.
 */

import { avaliarQuedaPreco } from "@/services/priceHistory/priceAlertReadiness";

import type {
  ResultadoCanal,
  ResultadoProdutoAlertas,
} from "./types";
import { avaliarRegraAlerta } from "./rule";
import { avaliarDedupeCanal } from "./dedupe";
import type { PriceAlertRepository, PriceAlertRecord } from "./repository";
import { produtoLinkPublico } from "./content";
import {
  emailTransporterPadrao,
  type EmailTransporter,
} from "./channels/emailChannel";
import type { ResolverEmailDoUsuario } from "./userEmail";
import { emailUsuarioValido } from "./userEmail";
import {
  whatsAppSenderPadrao,
  type WhatsAppSender,
} from "./channels/whatsappChannel";

export type ContextoAlertas = {
  productId: string;
  currentPrice: number;
  previousPrice: number | null;
  lowest30Days: number | null;
  lowest90Days: number | null;
  productName?: string | null;
  marketplace?: string | null;
  store?: string | null;
};

export type DependenciasMotorAlertas = {
  repository: PriceAlertRepository;
  emailTransporter?: EmailTransporter;
  whatsAppSender?: WhatsAppSender;
  whatsAppConfigurado?: boolean;
  resolverEmailDoUsuario?: ResolverEmailDoUsuario;
  cooldownMs?: number;
  now?: Date;
};

export async function processProductAlerts(
  contexto: ContextoAlertas,
  deps: DependenciasMotorAlertas,
): Promise<ResultadoProdutoAlertas> {
  const agora = deps.now ?? new Date();
  const repositorio = deps.repository;
  const canaisResultado: ResultadoCanal[] = [];

  const alertas = await repositorio.listByProductId(contexto.productId);

  const avaliacao = avaliarQuedaPreco({
    currentPrice: contexto.currentPrice,
    previousPrice: contexto.previousPrice,
    lowest30Days: contexto.lowest30Days,
    lowest90Days: contexto.lowest90Days,
  });

  for (const alerta of alertas) {
    const regra = avaliarRegraAlerta({
      alertType: alerta.alertType,
      targetPrice: alerta.targetPrice,
      percentageDrop: alerta.percentageDrop,
      previousPrice: contexto.previousPrice,
      currentPrice: contexto.currentPrice,
      lowest30Days: contexto.lowest30Days,
      lowest90Days: contexto.lowest90Days,
    });

    if (!regra.satisfied) {
      const status: ResultadoCanal["status"] =
        regra.motivo === "THRESHOLD_NOT_MET"
          ? "SKIPPED_THRESHOLD"
          : regra.motivo === "INVALID_PRICE"
            ? "SKIPPED_INVALID_PRICE"
            : "SKIPPED_NO_DROP";

      if (alerta.notifyEmail) {
        canaisResultado.push({ canal: "EMAIL", status });
      }

      if (alerta.notifyWhatsApp) {
        canaisResultado.push({ canal: "WHATSAPP", status });
      }

      continue;
    }

    if (alerta.notifyEmail) {
      canaisResultado.push(
        await processarCanalEmail(alerta, contexto, agora, deps),
      );
    }

    if (alerta.notifyWhatsApp) {
      canaisResultado.push(
        await processarCanalWhatsApp(alerta, contexto, agora, deps),
      );
    }
  }

  return {
    productId: contexto.productId,
    avaliacao: {
      priceDropped: avaliacao.priceDropped,
      previousPrice: avaliacao.previousPrice,
      currentPrice: avaliacao.currentPrice,
      dropAmount: avaliacao.dropAmount,
      dropPercentage: avaliacao.dropPercentage,
      isNew30DayLow: avaliacao.isNew30DayLow,
      isNew90DayLow: avaliacao.isNew90DayLow,
    },
    alertasProcessados: alertas.length,
    canais: canaisResultado,
  };
}

async function processarCanalEmail(
  alerta: PriceAlertRecord,
  contexto: ContextoAlertas,
  agora: Date,
  deps: DependenciasMotorAlertas,
): Promise<ResultadoCanal> {
  const dedupe = avaliarDedupeCanal({
    currentPrice: contexto.currentPrice,
    lastNotifiedPrice: alerta.lastEmailNotifiedPrice,
    lastNotifiedAt: alerta.lastEmailNotifiedAt,
    now: agora,
    cooldownMs: deps.cooldownMs,
  });

  if (!dedupe.allowed) {
    return {
      canal: "EMAIL",
      status:
        dedupe.motivo === "COOLDOWN"
          ? "SKIPPED_COOLDOWN"
          : "SKIPPED_DUPLICATE",
    };
  }

  const resolucao = deps.resolverEmailDoUsuario
    ? await deps.resolverEmailDoUsuario(alerta.userId)
    : null;

  if (!resolucao) {
    return { canal: "EMAIL", status: "EMAIL_NOT_CONFIGURED" };
  }

  if (resolucao.status === "RESOLVER_NAO_CONFIGURADO") {
    return {
      canal: "EMAIL",
      status: "EMAIL_USER_RESOLVER_NOT_CONFIGURED",
    };
  }

  if (resolucao.status === "USUARIO_NAO_ENCONTRADO") {
    return { canal: "EMAIL", status: "EMAIL_NOT_CONFIGURED" };
  }

  const emailUsuario = resolucao.email;

  if (!emailUsuarioValido(emailUsuario)) {
    return { canal: "EMAIL", status: "EMAIL_NOT_CONFIGURED" };
  }

  const transporter = deps.emailTransporter ?? emailTransporterPadrao;

  let envio: Awaited<ReturnType<EmailTransporter>>;

  try {
    envio = await transporter({
      toEmail: emailUsuario,
      productId: contexto.productId,
      productName: contexto.productName ?? "Produto",
      previousPrice: contexto.previousPrice ?? contexto.currentPrice,
      currentPrice: contexto.currentPrice,
      savings:
        (contexto.previousPrice ?? contexto.currentPrice) -
        contexto.currentPrice,
      dropPercentage: dropPercentual(
        contexto.previousPrice ?? contexto.currentPrice,
        contexto.currentPrice,
      ),
      marketplace: contexto.marketplace ?? null,
      publicLink: produtoLinkPublico(contexto.productId),
    });
  } catch {
    return { canal: "EMAIL", status: "EMAIL_FAILED" };
  }

  if (envio.status === "EMAIL_SENT") {
    await deps.repository.updateNotified(
      alerta.id,
      "EMAIL",
      contexto.currentPrice,
      agora,
    );

    return {
      canal: "EMAIL",
      status: "EMAIL_SENT",
      notifiedPrice: contexto.currentPrice,
      notifiedAt: agora,
    };
  }

  if (envio.status === "EMAIL_NOT_CONFIGURED") {
    return { canal: "EMAIL", status: "EMAIL_NOT_CONFIGURED" };
  }

  return { canal: "EMAIL", status: "EMAIL_FAILED" };
}

async function processarCanalWhatsApp(
  alerta: PriceAlertRecord,
  contexto: ContextoAlertas,
  agora: Date,
  deps: DependenciasMotorAlertas,
): Promise<ResultadoCanal> {
  if (deps.whatsAppConfigurado === false) {
    return {
      canal: "WHATSAPP",
      status: "WHATSAPP_PROVIDER_NOT_CONFIGURED",
    };
  }

  const sender = deps.whatsAppSender ?? whatsAppSenderPadrao;

  const dedupe = avaliarDedupeCanal({
    currentPrice: contexto.currentPrice,
    lastNotifiedPrice: alerta.lastWhatsAppNotifiedPrice,
    lastNotifiedAt: alerta.lastWhatsAppNotifiedAt,
    now: agora,
    cooldownMs: deps.cooldownMs,
  });

  if (!dedupe.allowed) {
    return {
      canal: "WHATSAPP",
      status:
        dedupe.motivo === "COOLDOWN"
          ? "SKIPPED_COOLDOWN"
          : "SKIPPED_DUPLICATE",
    };
  }

  let envio: Awaited<ReturnType<WhatsAppSender>>;

  try {
    envio = await sender({
      productName: contexto.productName ?? "Produto",
      currentPrice: contexto.currentPrice,
      previousPrice: contexto.previousPrice,
      publicLink: produtoLinkPublico(contexto.productId),
    });
  } catch {
    return { canal: "WHATSAPP", status: "WHATSAPP_FAILED" };
  }

  if (envio.status === "WHATSAPP_SENT") {
    await deps.repository.updateNotified(
      alerta.id,
      "WHATSAPP",
      contexto.currentPrice,
      agora,
    );

    return {
      canal: "WHATSAPP",
      status: "WHATSAPP_SENT",
      notifiedPrice: contexto.currentPrice,
      notifiedAt: agora,
    };
  }

  if (envio.status === "WHATSAPP_PROVIDER_NOT_CONFIGURED") {
    return {
      canal: "WHATSAPP",
      status: "WHATSAPP_PROVIDER_NOT_CONFIGURED",
    };
  }

  return { canal: "WHATSAPP", status: "WHATSAPP_FAILED" };
}

function dropPercentual(anterior: number, atual: number): number {
  if (!anterior || anterior <= 0) {
    return 0;
  }

  return ((anterior - atual) / anterior) * 100;
}
