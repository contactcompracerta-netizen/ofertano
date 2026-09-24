import assert from "node:assert/strict";

import {
  classificarErroRetry,
  formatErrorMessageStructured,
  isNonRetryableErrorMessage,
  NON_RETRYABLE_ENVELOPE_PREFIX,
  PublicationPolicyError,
} from "./retryClassification";

/*
 * FASE B/C — CLASSIFICAÇÃO ESTRUTURADA DE RETRY
 *
 * A decisão de retry é por TIPO/CÓDIGO estruturado (instanceof +
 * .code), NUNCA por message.includes(texto).
 */

// 1. PublicationPolicyError => non-retryable POLICY_NOT_READY
{
  const erro = new PublicationPolicyError(
    "MULTISTORE_NOT_READY",
    "Multi Loja incompleto: 1 marketplace(s) publico(s) distinto(s).",
  );

  const decisao = classificarErroRetry(erro);

  assert.equal(decisao.retryable, false);
  assert.equal(decisao.category, "POLICY_NOT_READY");
  assert.equal(decisao.code, "MULTISTORE_NOT_READY");

  // A decisão independe do texto da mensagem.
  assert.equal(
    classificarErroRetry(new PublicationPolicyError("A", "qualquer texto")).retryable,
    false,
  );
}

// 2. Erro genérico (transitório/infra) permanece retentável.
{
  const decisao = classificarErroRetry(
    new Error("Network timeout"),
  );

  assert.equal(decisao.retryable, true);
  assert.equal(decisao.category, "TRANSIENT_INFRA");
  assert.equal(decisao.code, null);
}

// 3. Valores não-Error também são tratados como retentáveis por padrão.
{
  const decisao = classificarErroRetry("string de erro");

  assert.equal(decisao.retryable, true);
  assert.equal(decisao.category, "TRANSIENT_INFRA");
}

// 4. Envelope persistido no errorMessage:
//    NON_RETRYABLE|<categoria>|<código>| <detalhe>
{
  const mensagem = formatErrorMessageStructured(
    {
      retryable: false,
      category: "POLICY_NOT_READY",
      code: "MULTISTORE_NOT_READY",
    },
    "O produto permaneceu oculto.",
  );

  assert.ok(
    mensagem.startsWith("NON_RETRYABLE|POLICY_NOT_READY|MULTISTORE_NOT_READY|"),
  );

  assert.equal(
    isNonRetryableErrorMessage(mensagem),
    true,
  );
}

// 5. Código ausente usa o placeholder "-" e segue reconhecível.
{
  const mensagem = formatErrorMessageStructured(
    {
      retryable: false,
      category: "POLICY_NOT_READY",
      code: null,
    },
    "detalhe",
  );

  assert.ok(
    mensagem.startsWith("NON_RETRYABLE|POLICY_NOT_READY|-|"),
  );
  assert.equal(isNonRetryableErrorMessage(mensagem), true);
}

// 6. Mensagens comuns (não-envelopadas) não são terminais.
{
  assert.equal(
    isNonRetryableErrorMessage("AUTO_CATALOG_INSUFFICIENT_PUBLIC_MULTISTORE"),
    false,
  );
  assert.equal(
    isNonRetryableErrorMessage(null),
    false,
  );
  assert.equal(
    isNonRetryableErrorMessage(undefined),
    false,
  );
}

// 7. O prefixo do envelope é o contrato usado no filtro Prisma.
assert.equal(
  NON_RETRYABLE_ENVELOPE_PREFIX,
  "NON_RETRYABLE|",
  "prefixo estável para o filtro startsWith do errosRetentaveis",
);

// 8. Códigos de política usados nos gates.
{
  const gate = new PublicationPolicyError(
    "AUTO_CATALOG_MULTISTORE_NOT_READY",
    "x",
  );
  const decisao = classificarErroRetry(gate);

  assert.equal(decisao.retryable, false);
  assert.equal(decisao.code, "AUTO_CATALOG_MULTISTORE_NOT_READY");

  const inv = new PublicationPolicyError(
    "AUTO_CATALOG_PUBLISH_NOT_ACTIVE",
    "y",
  );
  assert.equal(
    classificarErroRetry(inv).code,
    "AUTO_CATALOG_PUBLISH_NOT_ACTIVE",
  );
}

console.log("retryClassification: todos os casos passaram");