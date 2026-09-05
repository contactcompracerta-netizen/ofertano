/**
 * Canal de email transacional para alertas de preco.
 *
 * Provider real: Brevo (v3, REST/HTTPS via fetch nativo — sem dependencia
 * nova). A configuracao vem de variaveis de ambiente; quando ausente,
 * devolve EMAIL_NOT_CONFIGURED e o restante do fluxo segue normalmente.
 *
 * Nenhum segredo em codigo nem em log: a chave vem de BREVO_API_KEY,
 * nunca logamos email completo, token ou payload sensivel — apenas o
 * estado de envio (e o codigo HTTP em caso de falha).
 */

import { montarCorpoEmail } from "../content";

export type ConteudoEmailAlerta = {
  toEmail: string;
  productId: string;
  productName: string;
  previousPrice: number;
  currentPrice: number;
  savings: number;
  dropPercentage: number;
  marketplace?: string | null;
  publicLink: string;
};

export type ResultadoEnvioEmail =
  | { status: "EMAIL_SENT" }
  | { status: "EMAIL_FAILED"; error?: string; code?: string }
  | { status: "EMAIL_NOT_CONFIGURED" };

export type EmailTransporter = (
  conteudo: ConteudoEmailAlerta,
) => Promise<ResultadoEnvioEmail>;

const BREVO_SMTP_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

/**
 * Verifica se ha configuracao transacional de email suficiente para um
 * envio real. Requer chave de API e remetente. Retorna true apenas quando
 * os segredos necessarios estao presentes; nunca expoe o valor.
 */
export function emailTransacionalConfigurado(): boolean {
  const chaveBrevo = process.env.BREVO_API_KEY?.trim();
  const remetenteEmail = process.env.BREVO_SENDER_EMAIL?.trim();

  return Boolean(chaveBrevo && remetenteEmail);
}

/**
 * Codigo sanitizado a partir de um status HTTP da Brevo (v3). Nunca
 * inclui body bruto nem detalhes do provider: mapeia agrupamentos uteis
 * para o diagnostico sem expor resposta completa.
 */
export function codigoBrevoDeStatus(statusHttp: number): string {
  if (statusHttp === 400) {
    return "BREVO_BAD_REQUEST";
  }
  if (statusHttp === 401) {
    return "BREVO_AUTH_FAILED";
  }
  if (statusHttp === 403) {
    return "BREVO_FORBIDDEN";
  }
  if (statusHttp === 429) {
    return "BREVO_RATE_LIMITED";
  }
  if (statusHttp >= 500 && statusHttp < 600) {
    return "BREVO_PROVIDER_ERROR";
  }
  return "BREVO_UNKNOWN_ERROR";
}

/**
 * Envio transacional via Brevo. A chave e o remetente sao lidos de
 * variaveis de ambiente a cada envio (nunca de constantes). Falha de
 * rede/HTTP vira EMAIL_FAILED sem lancar excecao.
 */
export const emailTransporterPadrao: EmailTransporter =
  async function enviarEmailAlerta(conteudo) {
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

    const corpo = montarCorpoEmail({
      productId: conteudo.productId,
      productName: conteudo.productName,
      previousPrice: conteudo.previousPrice,
      currentPrice: conteudo.currentPrice,
      dropPercentage: conteudo.dropPercentage,
      marketplace: conteudo.marketplace,
    });

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
          to: [{ email: conteudo.toEmail }],
          subject: corpo.subject,
          htmlContent: corpo.html,
          textContent: corpo.text,
        }),
      });

      if (resposta.ok) {
        return { status: "EMAIL_SENT" };
      }

      return {
        status: "EMAIL_FAILED",
        error: `http_${resposta.status}`,
        code: codigoBrevoDeStatus(resposta.status),
      };
    } catch {
      return {
        status: "EMAIL_FAILED",
        error: "network_exception",
        code: "BREVO_NETWORK_ERROR",
      };
    }
  };
