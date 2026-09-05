/**
 * Canal de email transacional para alertas de preco.
 *
 * Abstrai o envio sem segredo em codigo. A configuracao (SMTP/Brevo/etc)
 * vem de variaveis de ambiente; quando ausente, devolve
 * EMAIL_NOT_CONFIGURED e o restante do fluxo segue normalmente.
 *
 * Nunca logamos email completo, token ou payload sensivel: apenas o
 * estado de envio.
 */

export type ConteudoEmailAlerta = {
  toEmail: string;
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
  | { status: "EMAIL_FAILED"; error?: string }
  | { status: "EMAIL_NOT_CONFIGURED" };

export type EmailTransporter = (
  conteudo: ConteudoEmailAlerta,
) => Promise<ResultadoEnvioEmail>;

/**
 * Verifica se ha configuracao transacional de email. Retorna true apenas
 * quando os segredos necessarios estao presentes. Nunca expoe o valor.
 */
export function emailTransacionalConfigurado(): boolean {
  const host = process.env.SMTP_HOST?.trim();
  const chaveBrevo = process.env.BREVO_API_KEY?.trim();

  if (host && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return true;
  }

  if (chaveBrevo) {
    return true;
  }

  return false;
}

/**
 * Transporter real do projeto. No estado atual do Ofertano nao ha servico
 * transacional declarado, entao sem configuracao devolve
 * EMAIL_NOT_CONFIGURED sem tentar rede nem logar credenciais.
 *
 * Quando SMTP_BREVO_OUT e configurado, este adaptador e o ponto unico de
 * integracao; a implementacao de rede fica isolada aqui.
 */
export const emailTransporterPadrao: EmailTransporter =
  async function enviarEmailAlerta() {
    if (!emailTransacionalConfigurado()) {
      return { status: "EMAIL_NOT_CONFIGURED" };
    }

    // TODO(missao-alertas): integrar provedor transacional real (SMTP/Brevo)
    // usando apenas variaveis de ambiente. Nenhum segredo no codigo.
    return { status: "EMAIL_NOT_CONFIGURED" };
  };
