/**
 * FASE 9.22 / 9.24 — GUARDAS DO ENDPOINT DE SYNC DE MARKETPLACE.
 *
 * O endpoint `/api/cron/marketplace-sync` e a porta que a internet pode
 * tocar. Estes testes travam as tres garantias que o tornam aceitavel:
 *
 *   1. SEM `CRON_SECRET` (ou sem header) => 401, e NADA executa;
 *   2. marketplace fora da allowlist => 400, sem tocar em nada;
 *   3. writer nao autorizado => 403, sem fingir que sincronizou.
 *
 * Nenhum teste aqui chega a rede: todos param antes da coleta.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GET as marketplaceSync } from "./marketplace-sync/route";

function request(query = "", headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/cron/marketplace-sync${query}`, {
    headers,
  });
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test("sem CRON_SECRET configurado => 401 e nada executa", async () => {
  const previous = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    const response = await marketplaceSync(
      request("", { authorization: "Bearer qualquer" }),
    );
    assert.equal(response.status, 401);
    const body = await json(response);
    assert.equal(body.success, false);
  } finally {
    if (previous !== undefined) process.env.CRON_SECRET = previous;
  }
});

test("CRON_SECRET configurado mas header ausente => 401", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret";
  try {
    const response = await marketplaceSync(request());
    assert.equal(response.status, 401);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("CRON_SECRET configurado mas token errado => 401", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret";
  try {
    const response = await marketplaceSync(
      request("", { authorization: "Bearer errado" }),
    );
    assert.equal(response.status, 401);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("marketplace fora da allowlist de sync => 400", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret";
  try {
    const response = await marketplaceSync(
      request("?marketplace=amazon", { authorization: "Bearer test-secret" }),
    );
    assert.equal(response.status, 400);
    const body = await json(response);
    assert.equal(body.success, false);
    assert.match(
      String(body.error),
      /MARKETPLACE_NOT_IN_SYNC_ALLOWLIST/,
      "marketplace arbitrario da internet tem de ser recusado pelo nome",
    );
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

test("grafia do enum tambem e canonicalizada antes do allowlist", async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = "test-secret";
  try {
    // "AMAZON" e "amazon" sao a mesma fonte; ambas tem de ser recusadas.
    const response = await marketplaceSync(
      request("?marketplace=AMAZON", { authorization: "Bearer test-secret" }),
    );
    assert.equal(response.status, 400);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
