/**
 * Tipos e codigos de resultado compartilhados pelo motor de alertas
 * automaticos de preco do Ofertano.
 *
 * Nenhum email/WhatsApp real dispara aqui: as operacoes retornam um
 * estado claro por canal, e o fluxo registro por canal SEM marcar um
 * canal como enviado quando nenhum envio aconteceu.
 */

export type CanalNotificacao = "EMAIL" | "WHATSAPP";

export type ResultadoEnvioCanal =
  | "EMAIL_SENT"
  | "EMAIL_FAILED"
  | "EMAIL_NOT_CONFIGURED"
  | "WHATSAPP_SENT"
  | "WHATSAPP_FAILED"
  | "WHATSAPP_PROVIDER_NOT_CONFIGURED"
  | "SKIPPED_NO_DROP"
  | "SKIPPED_THRESHOLD"
  | "SKIPPED_DUPLICATE"
  | "SKIPPED_COOLDOWN"
  | "SKIPPED_INVALID_PRICE"
  | "SKIPPED_INACTIVE";

export type ResultadoCanal = {
  canal: CanalNotificacao;
  status: ResultadoEnvioCanal;
  notifiedPrice?: number;
  notifiedAt?: Date;
};

export type ResultadoProdutoAlertas = {
  productId: string;
  avaliacao: {
    priceDropped: boolean;
    previousPrice: number | null;
    currentPrice: number;
    dropAmount: number;
    dropPercentage: number;
    isNew30DayLow: boolean;
    isNew90DayLow: boolean;
  } | null;
  alertasProcessados: number;
  canais: ResultadoCanal[];
};
