/*
 * CLASSIFICAÇÃO ESTRUTURADA DE RETRY DA FILA DE IMPORTAÇÃO
 *
 * A política de retry é decidida por TIPO/CÓDIGO estruturado — nunca por
 * `message.includes(...)`. Cada erro que representa um bloqueio de política
 * (ex.: catálogo ainda sem Multi Loja pública) é não-retentável por definição
 * e carrega um envelope persistível no `errorMessage` da fila:
 *
 *   NON_RETRYABLE|POLICY_NOT_READY|MULTISTORE_NOT_READY| <detalhe>
 *
 * O prefixo do envelope permite:
 * - `errosRetentaveis` excluir terminais de política da re-seleção;
 * - métricas distinguirem bloqueio de política de falha transitória.
 */
export type RetryCategory =
  | "TRANSIENT_INFRA"
  | "RATE_LIMIT"
  | "TEMPORARY_SOURCE_FAILURE"
  | "POLICY_NOT_READY"
  | "INVALID_DATA"
  | "PERMANENT_DATA_FAILURE"
  | "IDEMPOTENT_NOOP";

export type RetryDecision = {
  retryable: boolean;
  category: RetryCategory;
  code: string | null;
  /*
   * IDEMPOTENT_NOOP: a operação já estava no estado de destino
   * (terminal sem erro — não gera retry nem conta como erro).
   */
  terminalNoError?: boolean;
};

export const NON_RETRYABLE_ENVELOPE_PREFIX = "NON_RETRYABLE|";

/*
 * Erro estruturado de bloqueio de política de publicação.
 *
 * Usado no gate pública Multi Loja (publishWithMultiloja) e no gate de
 * retomada de Product autoCreated (MODO COMPARACAO do processImportQueue).
 *
 * A classificação é feita via `instanceof` + `code` — nunca via texto.
 */
export class PublicationPolicyError extends Error {
  readonly code: string;
  readonly category: RetryCategory = "POLICY_NOT_READY";

  constructor(
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "PublicationPolicyError";
    this.code = code;
  }
}

/*
 * Decisão de retry para um erro da fila.
 *
 * Por padrão (erros desconhecidos) mantemos o comportamento histórico:
 * retentável. Apenas erros estruturados de política são não-retentáveis.
 */
export function classificarErroRetry(error: unknown): RetryDecision {
  if (error instanceof PublicationPolicyError) {
    return {
      retryable: false,
      category: error.category,
      code: error.code,
    };
  }

  return {
    retryable: true,
    category: "TRANSIENT_INFRA",
    code: null,
  };
}

/*
 * Monta o `errorMessage` persistido na fila para um erro terminal.
 * Formato: NON_RETRYABLE|<categoria>|<código>| <detalhe>
 */
export function formatErrorMessageStructured(
  decision: RetryDecision,
  detail: string,
): string {
  const categoria = decision.category;
  const codigo = decision.code ?? "-";

  return (
    `${NON_RETRYABLE_ENVELOPE_PREFIX}${categoria}|` +
    `${codigo}| ${detail}`
  );
}

export function isNonRetryableErrorMessage(
  message: string | null | undefined,
): boolean {
  return (
    typeof message === "string" &&
    message.startsWith(NON_RETRYABLE_ENVELOPE_PREFIX)
  );
}