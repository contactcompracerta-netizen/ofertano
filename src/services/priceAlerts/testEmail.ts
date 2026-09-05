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
 * - retorna apenas `{ ok: true }` ou erro sanitizado (sem email, token,
 *   chave, secret ou resposta completa da Brevo).
 */

import { escapeHtml, formatarPrecoBRL, produtoLinkPublico } from "./content";
import { emailTransacionalConfigurado } from "./channels/emailChannel";
import type { ResolverEmailDoUsuario } from "./userEmail";
import { emailUsuarioValido } from "./userEmail";

const BREVO_SMTP_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

export const ASSUNTO_TESTE_EMAIL = "Ofertano — teste de alerta de preço";

export type TestEmailSenderInput = {
  toEmail: string;
  productId: string;
  productName: string;
  currentPrice: number;
  publicLink: string;
};

export type ResultadoEnvioTeste =
  | { status: "EMAIL_SENT" }
  | { status: "EMAIL_FAILED"; error?: string }
  | { status: "EMAIL_NOT_CONFIGURED" };

export type TestEmailSender = (
  input: TestEmailSenderInput,
) => Promise<ResultadoEnvioTeste>;

/**
 * Transporte REAL via Brevo (REST v3), mesmo contrato do canal de email
 * de producao (emailChannel.ts), mas com conteudo de teste tecnico.
 */
export const testEmailSenderPadrao: TestEmailSender =
  async function enviarEmailTeste(input) {
    if (!emailTransacionalConfigurado()) {
      return { status: "EMAIL_NOT_CONFIGURED" };
    }

    const chaveBrevo = process.env.BREVO_API_KEY?.trim();
    const remetenteEmail = process.env.BREVO_SENDER_EMAIL?.trim();
    const remetenteNome =
      process.env.BREVO_SENDER_NAME?.trim() || "Ofertano";

    if (!chaveBrevo || !remetenteEmail) {
      return { status: "EMAIL_NOT_CONFIGURED" };
    }

    const { subject, html, text } = montarConteudoTeste(input);

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
        return { status: "EMAIL_SENT" };
      }

      return {
        status: "EMAIL_FAILED",
        error: `http_${resposta.status}`,
      };
    } catch {
      return { status: "EMAIL_FAILED", error: "network_exception" };
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
  | { ok: false; status: 400; error: string }
  | { ok: false; status: 404; error: string }
  | { ok: false; status: 500; error: string };

export async function sendTestEmailForUser(
  userId: string,
  productId: unknown,
  store: TestEmailStore,
  resolverEmailDoUsuario: ResolverEmailDoUsuario,
  sender: TestEmailSender = testEmailSenderPadrao,
): Promise<TestEmailOutcome> {
  if (typeof productId !== "string" || !productId.trim()) {
    return { ok: false, status: 400, error: "productId é obrigatório." };
  }

  try {
    const alerta = await store.findActiveAlert(userId, productId);

    if (!alerta || !alerta.active || !alerta.notifyEmail) {
      return {
        ok: false,
        status: 404,
        error: "Alerta de preço não encontrado para este produto.",
      };
    }

    const resolucao = await resolverEmailDoUsuario(userId);

    if (
      resolucao.status !== "RESOLVIDO" ||
      !emailUsuarioValido(resolucao.email)
    ) {
      return {
        ok: false,
        status: 500,
        error: "Não foi possível resolver o e-mail de destino.",
      };
    }

    const produto = await store.getProduct(productId);

    if (!produto) {
      return {
        ok: false,
        status: 404,
        error: "Produto não encontrado.",
      };
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

    return {
      ok: false,
      status: 500,
      error: "Não foi possível enviar o e-mail de teste.",
    };
  } catch {
    return {
      ok: false,
      status: 500,
      error: "Não foi possível enviar o e-mail de teste.",
    };
  }
}
