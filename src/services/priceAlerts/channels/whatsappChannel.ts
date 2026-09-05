/**
 * Canal WhatsApp para alertas de preco.
 *
 * O Ofertano NAO possui provider oficial de WhatsApp configurado. Nao
 * contratamos servico pago e nem usamos automacao/bypass de WhatsApp Web.
 * Este adaptador devolve sempre WHATSAPP_PROVIDER_NOT_CONFIGURED, e o
 * restante do alerta continua funcionando por email. O sistema nunca
 * marca WhatsApp como enviado quando nenhum envio aconteceu.
 */

export type ConteudoWhatsAppAlerta = {
  toPhone?: string;
  productName: string;
  currentPrice: number;
  previousPrice?: number | null;
  publicLink: string;
};

export type ResultadoEnvioWhatsApp =
  | { status: "WHATSAPP_SENT" }
  | { status: "WHATSAPP_FAILED"; error?: string }
  | { status: "WHATSAPP_PROVIDER_NOT_CONFIGURED" };

export type WhatsAppSender = (
  conteudo: ConteudoWhatsAppAlerta,
) => Promise<ResultadoEnvioWhatsApp>;

/**
 * Indica se existe provider oficial configurado. Hoje nao ha, entao
 * retorna false. Quando um provider oficial for adicionado por variavel
 * de ambiente, este e o ponto unico de ligacao.
 */
export function whatsAppProviderConfigurado(): boolean {
  return false;
}

export const whatsAppSenderPadrao: WhatsAppSender =
  async function enviarWhatsAppAlerta() {
    if (!whatsAppProviderConfigurado()) {
      return { status: "WHATSAPP_PROVIDER_NOT_CONFIGURED" };
    }

    return { status: "WHATSAPP_PROVIDER_NOT_CONFIGURED" };
  };
