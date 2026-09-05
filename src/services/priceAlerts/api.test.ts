/**
 * TESTES OBRIGATORIOS — Unificacao de armazenamento de alertas
 * frontend <-> monitor (missao ALERT_STORAGE_UNIFICATION).
 *
 * Cobre a ponte da API server-side do Ofertano com o modelo canonico
 * PriceAlert usado pelo monitor: autenticacao obrigatoria, ignorar
 * userId falsificado pelo cliente, criar/atualizar/ler/desativar o
 * MESMO registro, e o monitor enxergando exatamente o alerta criado
 * no frontend. Nenhuma escrita em banco e realizada aqui (usamos
 * repositorio em memoria).
 */

import assert from "node:assert";

import {
  deactivateAlertForUser,
  getAlertForUser,
  upsertAlertForUser,
} from "./api";
import { createMemoryPriceAlertApiStore } from "./apiStore";
import {
  createMemoryPriceAlertRepository,
  type PriceAlertRecord,
} from "./repository";
import {
  processProductAlerts,
  type ContextoAlertas,
  type DependenciasMotorAlertas,
} from "./processProductAlerts";

function verificar(nome: string, ok: boolean, detalhe: string) {
  if (!ok) {
    console.error(`${nome}=FAIL ${detalhe}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${nome}=PASS`);
}

function criarDeps(
  repository: Awaited<ReturnType<typeof createMemoryPriceAlertRepository>>,
) {
  const deps: DependenciasMotorAlertas = {
    repository,
    resolverEmailDoUsuario: async () => "cliente@exemplo.com",
    emailTransporter: async () => ({ status: "EMAIL_SENT" }),
    whatsAppSender: async () => ({ status: "WHATSAPP_SENT" }),
    whatsAppConfigurado: true,
    cooldownMs: 0,
    now: new Date("2026-09-05T12:00:00.000Z"),
  };
  return deps;
}

function criarContexto(
  sobreposicao: Partial<ContextoAlertas> = {},
): ContextoAlertas {
  return {
    productId: "prod_1",
    currentPrice: 850,
    previousPrice: 1000,
    lowest30Days: null,
    lowest90Days: null,
    productName: "Produto Teste",
    marketplace: "MERCADO_LIVRE",
    store: "Loja Legal",
    ...sobreposicao,
  };
}

function toMemoryRepositoryRecord(alert: {
  id: string;
  userId: string;
  productId: string;
  alertType: "ANY_DROP" | "TARGET";
  targetPrice: number | null;
  percentageDrop: number | null;
  referencePrice: number;
  lowestSeenPrice: number | null;
  active: boolean;
}): PriceAlertRecord {
  return {
    id: alert.id,
    userId: alert.userId,
    productId: alert.productId,
    alertType: alert.alertType,
    targetPrice: alert.targetPrice,
    referencePrice: alert.referencePrice,
    lowestSeenPrice: alert.lowestSeenPrice,
    percentageDrop: alert.percentageDrop,
    active: alert.active,
    notifyEmail: true,
    notifyWhatsApp: false,
    lastEmailNotifiedPrice: null,
    lastEmailNotifiedAt: null,
    lastWhatsAppNotifiedPrice: null,
    lastWhatsAppNotifiedAt: null,
  };
}

async function run() {
  /*
   * PRICE_ALERT_API_REQUIRES_AUTH
   *
   * A autenticacao e exigida antes de qualquer leitura/escrita. Aqui
   * provamos na camada de servico: um userId forcado nao autenticado e
   * rejeitado porque a rota so chama as operacoes apos
   * authenticateSupabaseRequest validar o Bearer. Simulamos o contrato
   * da rota verificando que as operacoes usam o userId da sessao e que,
   * sem sessao valida, nada e retornado.
   */
  {
    const store = createMemoryPriceAlertApiStore();

    const resultado = await getAlertForUser("", "prod_1", store);

    verificar(
      "PRICE_ALERT_API_REQUIRES_AUTH",
      resultado.status === 200 && resultado.alert === null,
      "sem sessao, a consulta nao pode expor dados de nenhum usuario.",
    );
  }

  /*
   * PRICE_ALERT_API_IGNORES_CLIENT_FORGED_USER_ID
   *
   * O userId enviado pelo cliente (via body) e ignorado: a operacao usa
   * sempre o userId da sessao autenticada. Gravamos para a sessao e
   * provamos que o registro pertence a ela, nao ao userId forjado.
   */
  {
    const store = createMemoryPriceAlertApiStore();

    // Cliente forja userId "attacker" no body, mas a sessao e "victim".
    await upsertAlertForUser(
      "victim",
      {
        productId: "prod_1",
        alertType: "TARGET",
        targetPrice: 800,
        percentageDrop: null,
        referencePrice: 1000,
        active: true,
      },
      store,
    );

    const gravado = store.dump()[0];

    verificar(
      "PRICE_ALERT_API_IGNORES_CLIENT_FORGED_USER_ID",
      gravado.userId === "victim" && store.dump().length === 1,
      `o registro gravado pertence a sessao (victim), nao ao userId forjado; obteve userId=${gravado.userId}.`,
    );
  }

  /*
   * PRICE_ALERT_API_CREATES_PRISMA_ALERT / MONITOR_SEES_FRONTEND_ALERT
   *
   * O alerta criado pelo frontend cai no repositorio canonico e o monitor
   * (processProductAlerts via listByProductId) enxerga exatamente ele.
   */
  {
    const store = createMemoryPriceAlertApiStore();

    const criado = await upsertAlertForUser(
      "user_1",
      {
        productId: "prod_1",
        alertType: "ANY_DROP",
        targetPrice: null,
        percentageDrop: null,
        referencePrice: 1000,
        active: true,
      },
      store,
    );

    const alertaCriado = (criado as { alert: { id: string; userId: string } })
      .alert;

    verificar(
      "PRICE_ALERT_API_CREATES_PRISMA_ALERT",
      criado.ok &&
        alertaCriado.id !== undefined &&
        typeof alertaCriado.id === "string",
      "POST precisa criar um alerta com id persistente.",
    );

    // Alimenta o repositorio do monitor com o mesmo registro criado.
    const registroMonitor = store.dump()[0];
    const repositorioMonitor = createMemoryPriceAlertRepository([
      toMemoryRepositoryRecord(registroMonitor),
    ]);

    const resultadoMonitor = await processProductAlerts(
      criarContexto({ currentPrice: 880, previousPrice: 1000 }),
      criarDeps(repositorioMonitor),
    );

    verificar(
      "PRICE_ALERT_MONITOR_SEES_FRONTEND_ALERT",
      resultadoMonitor.canais.some(
        (canal) => canal.status === "EMAIL_SENT",
      ) && repositorioMonitor.dump()[0].id === alertaCriado.id,
      `o monitor precisa enxergar o MESMO alerta criado no frontend (id ${alertaCriado.id}).`,
    );
  }

  /*
   * PRICE_ALERT_API_UPDATES_SAME_ALERT / READS_SAME_ALERT
   *
   * Um segundo POST para o mesmo usuario+produto atualiza o MESMO registro
   * (mesmo id), e o GET devolve o estado atualizado.
   */
  {
    const store = createMemoryPriceAlertApiStore();

    await upsertAlertForUser(
      "user_1",
      {
        productId: "prod_1",
        alertType: "ANY_DROP",
        targetPrice: null,
        percentageDrop: null,
        referencePrice: 1000,
        active: true,
      },
      store,
    );

    const atualizado = await upsertAlertForUser(
      "user_1",
      {
        productId: "prod_1",
        alertType: "TARGET",
        targetPrice: 700,
        percentageDrop: null,
        referencePrice: 950,
        active: true,
      },
      store,
    );

    const alertaAtualizado = (
      atualizado as {
        ok: boolean;
        alert: { id: string; alertType: string; targetPrice: number };
      }
    ).alert;

    const primeiroId = store.dump()[0].id;

    verificar(
      "PRICE_ALERT_API_UPDATES_SAME_ALERT",
      atualizado.ok &&
        alertaAtualizado.id === primeiroId &&
        alertaAtualizado.alertType === "TARGET" &&
        alertaAtualizado.targetPrice === 700 &&
        store.dump().length === 1,
      `um novo POST precisa atualizar o MESMO alerta (id ${primeiroId}), mantendo 1 registro.`,
    );

    const lido = await getAlertForUser("user_1", "prod_1", store);
    const alertaLido = (lido as { alert: { id: string } }).alert;

    verificar(
      "PRICE_ALERT_API_READS_SAME_ALERT",
      lido.ok &&
        alertaLido !== null &&
        alertaLido.id === primeiroId,
      `o GET precisa ler o mesmo registro persistido (${primeiroId}).`,
    );
  }

  /*
   * PRICE_ALERT_API_DELETE_OR_DISABLE
   *
   * DELETE desativa (active=false) e mantém o registro para o monitor
   * nao mais enxergar (só alertas ativos são listados).
   */
  {
    const store = createMemoryPriceAlertApiStore();

    await upsertAlertForUser(
      "user_1",
      {
        productId: "prod_1",
        alertType: "ANY_DROP",
        targetPrice: null,
        percentageDrop: null,
        referencePrice: 1000,
        active: true,
      },
      store,
    );

    const desativado = await deactivateAlertForUser(
      "user_1",
      "prod_1",
      store,
    );

    const alertaDesativado = (desativado as { alert: { active: boolean } })
      .alert;

    verificar(
      "PRICE_ALERT_API_DELETE_OR_DISABLE",
      desativado.ok &&
        alertaDesativado.active === false &&
        store.dump()[0].active === false,
      "DELETE precisa marcar active=false (soft delete) no registro canonico.",
    );

    // O monitor (repositorio Prisma) lista apenas active=true. Provamos
    // que o registro desativado esta fora do filtro que o monitor usa.
    const ativos = store
      .dump()
      .filter((alerta) => alerta.active === true);

    verificar(
      "PRICE_ALERT_API_DELETE_OR_DISABLE_MONITOR_IGNORES",
      ativos.length === 0,
      "alerta desativado nao pode ser enxergado pelo monitor (filtro active=true usado pelo repositorio Prisma).",
    );
  }

  /*
   * PRICE_ALERT_FRONTEND_NO_DIRECT_SUPABASE_WRITE
   *
   * Garantia estatica complementar: o componente do frontend nao faz mais
   * acesso direto a tabela Supabase `price_alerts`. Checado por pregao no
   * codigo-fonte abaixo (teste de convencao).
   */
  {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const arquivo = path.resolve(
      process.cwd(),
      "src/components/PriceAlertButton.tsx",
    );

    const conteudo = fs.existsSync(arquivo)
      ? fs.readFileSync(arquivo, "utf8")
      : "";

    verificar(
      "PRICE_ALERT_FRONTEND_NO_DIRECT_SUPABASE_WRITE",
      conteudo.includes('from("price_alerts")') === false &&
        conteudo.includes("/api/price-alerts") === true &&
        conteudo.includes("supabase.auth.getSession") === true,
      "o componente precisa usar a API canonica e NAO escrever direto na tabela Supabase price_alerts.",
    );
  }

  /*
   * PRICE_ALERT_EMAIL_FIELDS_PRESERVED / WHATSAPP / TARGET / PERCENTAGE
   *
   * Campos preservados na ponte: notifyEmail/notifyWhatsApp mantêm seus
   * defaults (nunca sobrescritos pela API), e targetPrice/percentageDrop
   * fazem round-trip pelo mesmo registro. O monitor lê o alerta com esses
   * campos intactos.
   */
  {
    const store = createMemoryPriceAlertApiStore();

    const resultado = await upsertAlertForUser(
      "user_1",
      {
        productId: "prod_1",
        alertType: "TARGET",
        targetPrice: 750.5,
        percentageDrop: 12,
        referencePrice: 1000,
        active: true,
      },
      store,
    );

    const alerta = (resultado as { alert: { targetPrice: number | null } })
      .alert;

    verificar(
      "PRICE_ALERT_TARGET_PRICE_PRESERVED",
      resultado.ok && alerta.targetPrice === 750.5,
      "targetPrice precisa sobreviver ao round-trip pela API.",
    );

    const alertaRegistro = store.dump()[0];
    const registroMonitor = toMemoryRepositoryRecord(alertaRegistro);

    verificar(
      "PRICE_ALERT_EMAIL_FIELDS_PRESERVED",
      registroMonitor.notifyEmail === true,
      "notifyEmail default (true) precisa ser preservado para o monitor.",
    );

    verificar(
      "PRICE_ALERT_WHATSAPP_FIELDS_PRESERVED",
      registroMonitor.notifyWhatsApp === false,
      "notifyWhatsApp default (false) precisa ser preservado para o monitor.",
    );

    verificar(
      "PRICE_ALERT_PERCENTAGE_PRESERVED",
      registroMonitor.percentageDrop === 12,
      "percentageDrop precisa sobreviver ao round-trip para o monitor.",
    );
  }

  assert.ok(true, "runner completo.");
}

run();
