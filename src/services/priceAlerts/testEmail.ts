/**
 * Smoke test segregado de envio real de email para alertas de preco.
 *
 * ESTRUTUTA TEMPORARIA (missao TEMP_EMAIL_SMOKE): endpooint dedicado que
 * exerce o transporte REAL de email (Brevo Production) sem tocar no fluxo
 * automatico do produto.
 *
 * Garantias:
 * - APENAS leitura no banco: nunca chama priceAlert.update/upsert,
 *   priceAlertEvent.create, priceHistory.create, saveProduct,
 *   processPriceMonitor ou processProductAlerts;
 * - nunca atualiza lastEmailNotified*, lowestSeenPrice ou updatedAt;
 * - o userId SEMPRE vem da sessao autenticada (nunca do body);
 * - resolve o email exclusivamente via userEmail.ts;
 * - envia UM email marcado claramente como teste tecnico, sem afirmar
 *   queda de preco e sem usar preco anterior falso;
 * - retorna apenas `{ ok: true }` ou `{ ok: false, code }` com codigo
 *   sanitizado (sem email, token, chave, secret ou resposta completa da
 *   Brevo);
 * - registra logging sanitizado por estagio para diagnostico no runtime
 *   sem vazar segredos.
 */

import { escapeHtml, formatarPrecoBRL, produtoLinkPublico } from "./content";
import {
  codigoBrevoDeStatus,
  emailTransacionalConfigurado,
} from "./channels/emailChannel";
import type { ResolverEmailSmoke } from "./userEmail";
import { emailUsuarioValido } from "./userEmail";

const BREVO_SMTP_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export const ASSUNTO_TESTE_EMAIL = "Ofertano — teste de alerta de preço";

/**
 * Codigos sanitizados do smoke test. NUNCA contem email, userId completo,
 * token, Authorization, chaves, sender email, body bruto ou resposta do
 * provider.
 */
export type TestEmailDiagnosticCode =
  | "AUTH_FAILED"
  | "INVALID_PRODUCT_ID"
  | "ALERT_NOT_FOUND"
  | "PRODUCT_NOT_FOUND"
  | "EMAIL_RESOLVED"
  | "SUPABASE_ADMIN_NOT_CONFIGURED"
  | "EMAIL_RESOLUTION_FAILED"
  | "EMAIL_NOT_FOUND"
  | "BREVO_NOT_CONFIGURED"
  | "BREVO_BAD_REQUEST"
  | "BREVO_AUTH_FAILED"
  | "BREVO_FORBIDDEN"
  | "BREVO_RATE_LIMITED"
  | "BREVO_PROVIDER_ERROR"
  | "BREVO_NETWORK_ERROR"
  | "BREVO_UNKNOWN_ERROR";

/**
 * Log sanitizado por estagio. Exige que todos os campos sejam seguros;
 * `providerStatus` e apenas o status HTTP numerico (nunca o body).
 */
export function logDiagnosticoTesteEmail(
  stage: string,
  code: string,
  extra?: { providerStatus?: number },
) {
  console.error("[PRICE_ALERT_TEST_EMAIL]", {
    stage,
    code,
    providerStatus: extra?.providerStatus ?? undefined,
  });
}

export type TestEmailSenderInput = {
  toEmail: string;
  productId: string;
  productName: string;
  currentPrice: number;
  publicLink: string;
};

export type ResultadoEnvioTeste =
  | { status: "EMAIL_SENT"; code?: "EMAIL_SENT" }
  | { status: "EMAIL_FAILED"; code?: TestEmailDiagnosticCode; error?: string }
  | {
      status: "EMAIL_NOT_CONFIGURED";
      code?: "BREVO_NOT_CONFIGURED";
    };

export type TestEmailSender = (
  input: TestEmailSenderInput,
) => Promise<ResultadoEnvioTeste>;

/**
 * Transporte REAL via Brevo (REST v3), mesmo contrato do canal de email
 * de producao (emailChannel.ts), mas com conteudo de teste tecnico. Loga
 * estagios BREVO_CONFIGURATION / BREVO_REQUEST / BREVO_RESPONSE com codigo
 * sanitizado e apenas o status HTTP numerico.
 */
export const testEmailSenderPadrao: TestEmailSender =
  async function enviarEmailTeste(input) {
    if (!emailTransacionalConfigurado()) {
      logDiagnosticoTesteEmail("BREVO_CONFIGURATION", "BREVO_NOT_CONFIGURED");
      return { status: "EMAIL_NOT_CONFIGURED", code: "BREVO_NOT_CONFIGURED" };
    }

    const chaveBrevo = process.env.BREVO_API_KEY?.trim();
    const remetenteEmail = process.env.BREVO_SENDER_EMAIL?.trim();
    const remetenteNome =
      process.env.BREVO_SENDER_NAME?.trim() || "Ofertano";

    if (!chaveBrevo || !remetenteEmail) {
      logDiagnosticoTesteEmail("BREVO_CONFIGURATION", "BREVO_NOT_CONFIGURED");
      return { status: "EMAIL_NOT_CONFIGURED", code: "BREVO_NOT_CONFIGURED" };
    }

    const { subject, html, text } = montarConteudoTeste(input);

    logDiagnosticoTesteEmail("BREVO_REQUEST", "BREVO_REQUEST_SENT");

    try {
      const resposta = await fetch(BREVO_SMTP_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "api-key": chaveBrevo,
        },
        body: JSON.stringify({
          sender: {
            email: remetenteEmail,
            name: remetenteNome,
          },
          to: [{ email: input.toEmail }],
          subject,
          htmlContent: html,
          textContent: text,
        }),
      });

      if (resposta.ok) {
        logDiagnosticoTesteEmail("BREVO_RESPONSE", "EMAIL_SENT", {
          providerStatus: resposta.status,
        });
        return { status: "EMAIL_SENT", code: "EMAIL_SENT" };
      }

      const code = codigoBrevoDeStatus(resposta.status) as TestEmailDiagnosticCode;

      logDiagnosticoTesteEmail("BREVO_RESPONSE", code, {
        providerStatus: resposta.status,
      });

      return {
        status: "EMAIL_FAILED",
        code,
        error: `http_${resposta.status}`,
      };
    } catch {
      logDiagnosticoTesteEmail(
        "BREVO_RESPONSE",
        "BREVO_NETWORK_ERROR",
      );
      return {
        status: "EMAIL_FAILED",
        code: "BREVO_NETWORK_ERROR",
        error: "network_exception",
      };
    }
  };

export function montarConteudoTeste(input: {
  productName: string;
  currentPrice: number;
  publicLink: string;
}): { subject: string; html: string; text: string } {
  const nome = escapeHtml(input.productName);
  const preco = formatarPrecoBRL(input.currentPrice);

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#0f172a;">
  <h2 style="color:#047857;margin:0 0 8px;">Teste de alerta de preço</h2>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Este é um teste técnico do sistema de alertas do Ofertano. Nenhuma queda de preço foi registrada por este teste.</p>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.5;"><strong>${nome}</strong></p>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Preço atual: <strong>${preco}</strong></p>
  <a href="${input.publicLink}" style="display:inline-block;background:#059669;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700;">Ver produto no Ofertano</a>
</div>
`;

  const text = `Teste de alerta de preço

Este é um teste técnico do sistema de alertas do Ofertano. Nenhuma queda de preço foi registrada por este teste.

Produto: ${input.productName}
Preço atual: ${preco}

Ver produto no Ofertano: ${input.publicLink}
`;

  return { subject: ASSUNTO_TESTE_EMAIL, html, text };
}

export type TestEmailAlertRecord = {
  id: string;
  userId: string;
  active: boolean;
  notifyEmail: boolean;
};

export type TestEmailStore = {
  findActiveAlert(
    userId: string,
    productId: string,
  ): Promise<TestEmailAlertRecord | null>;
  getProduct(
    productId: string,
  ): Promise<{ id: string; name: string; price: number } | null>;
};

export type TestEmailPrismaRow = {
  id: string;
  userId: string;
  active: boolean;
  notifyEmail: boolean;
};

export function createPrismaTestEmailStore(prisma: {
  priceAlert: {
    findUnique(args: unknown): Promise<TestEmailPrismaRow | null>;
  };
  product: {
    findUnique(args: unknown): Promise<{
      id: string;
      name: string;
      price: number;
    } | null>;
  };
}): TestEmailStore {
  return {
    async findActiveAlert(userId, productId) {
      const row = await prisma.priceAlert.findUnique({
        where: {
          userId_productId: { userId, productId },
        },
        select: {
          id: true,
          userId: true,
          active: true,
          notifyEmail: true,
        },
      });
      return row ? { ...row } : null;
    },

    async getProduct(productId) {
      return prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, name: true, price: true },
      });
    },
  };
}

export type TestEmailOutcome =
  | { ok: true; status: 200 }
  | { ok: false; status: 400; code: TestEmailDiagnosticCode }
  | { ok: false; status: 404; code: TestEmailDiagnosticCode }
  | { ok: false; status: 500; code: TestEmailDiagnosticCode };

function codigoDeResolucao(
  resolucao: Awaited<ReturnType<ResolverEmailSmoke>>,
): TestEmailDiagnosticCode {
  switch (resolucao.status) {
    case "RESOLVER_NAO_CONFIGURADO":
      return "SUPABASE_ADMIN_NOT_CONFIGURED";
    case "RESOLUTION_FAILED":
      return "EMAIL_RESOLUTION_FAILED";
    case "USUARIO_NAO_ENCONTRADO":
      return "EMAIL_NOT_FOUND";
    default:
      return emailUsuarioValido(resolucao.email)
        ? "EMAIL_RESOLVED"
        : "EMAIL_NOT_FOUND";
  }
}

export async function sendTestEmailForUser(
  userId: string,
  productId: unknown,
  store: TestEmailStore,
  resolverEmailDoUsuario: ResolverEmailSmoke,
  sender: TestEmailSender = testEmailSenderPadrao,
): Promise<TestEmailOutcome> {
  if (typeof productId !== "string" || !productId.trim()) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_PRODUCT_ID",
    };
  }

  try {
    const alerta = await store.findActiveAlert(userId, productId);

    if (!alerta || !alerta.active || !alerta.notifyEmail) {
      logDiagnosticoTesteEmail("ALERT_LOOKUP", "ALERT_NOT_FOUND");
      return { ok: false, status: 404, code: "ALERT_NOT_FOUND" };
    }

    logDiagnosticoTesteEmail("ALERT_LOOKUP", "ALERT_FOUND");

    const resolucao = await resolverEmailDoUsuario(userId);
    const codigoResolucao = codigoDeResolucao(resolucao);

    logDiagnosticoTesteEmail("EMAIL_RESOLUTION", codigoResolucao);

    if (
      resolucao.status !== "RESOLVIDO" ||
      !emailUsuarioValido(resolucao.email)
    ) {
      return { ok: false, status: 500, code: codigoResolucao };
    }

    const produto = await store.getProduct(productId);

    if (!produto) {
      logDiagnosticoTesteEmail("ALERT_LOOKUP", "PRODUCT_NOT_FOUND");
      return { ok: false, status: 404, code: "PRODUCT_NOT_FOUND" };
    }

    const envio = await sender({
      toEmail: resolucao.email,
      productId,
      productName: produto.name,
      currentPrice: produto.price,
      publicLink: produtoLinkPublico(productId),
    });

    if (envio.status === "EMAIL_SENT") {
      return { ok: true, status: 200 };
    }

    if (envio.status === "EMAIL_NOT_CONFIGURED") {
      return {
        ok: false,
        status: 500,
        code: "BREVO_NOT_CONFIGURED",
      };
    }

    return {
      ok: false,
      status: 500,
      code: envio.code ?? "BREVO_UNKNOWN_ERROR",
    };
  } catch {
    logDiagnosticoTesteEmail("UNKNOWN", "BREVO_UNKNOWN_ERROR");
    return { ok: false, status: 500, code: "BREVO_UNKNOWN_ERROR" };
  }
}