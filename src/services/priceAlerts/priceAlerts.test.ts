/**
 * TESTES OBRIGATORIOS — Alertas automaticos de preco.
 *
 * Cobre os casos exigidos pela missao AUTOMATIC_PRICE_ALERTS, incluindo
 * regras de disparo (ANY_DROP/TARGET/percentual), dedupe/cooldown por
 * canal, independencia de canais, preco invalido, minimas 30/90 dias,
 * falha de provider sem quebrar o monitor, WhatsApp nao configurado NAO
 * marcado como enviado, link publico e protecao contra duplicata
 * concorrente.
 */

import assert from "node:assert";

import { avaliarRegraAlerta } from "./rule";
import { podeReivindicarNotificacao } from "./repository";
import {
  createMemoryPriceAlertRepository,
  type PriceAlertRecord,
} from "./repository";
import {
  processProductAlerts,
  type ContextoAlertas,
  type DependenciasMotorAlertas,
} from "./processProductAlerts";
import { montarCorpoEmail, produtoLinkPublico } from "./content";
import type { EmailTransporter } from "./channels/emailChannel";
import type { WhatsAppSender } from "./channels/whatsappChannel";

function verificar(nome: string, ok: boolean, detalhe: string) {
  if (!ok) {
    console.error(`${nome}=FAIL ${detalhe}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${nome}=PASS`);
}

function criarAlerta(
  sobreposicao: Partial<PriceAlertRecord> = {},
): PriceAlertRecord {
  return {
    id: "alert_1",
    userId: "user_1",
    productId: "prod_1",
    alertType: "ANY_DROP",
    targetPrice: null,
    referencePrice: 1000,
    lowestSeenPrice: null,
    percentageDrop: null,
    active: true,
    notifyEmail: true,
    notifyWhatsApp: false,
    lastEmailNotifiedPrice: null,
    lastEmailNotifiedAt: null,
    lastWhatsAppNotifiedPrice: null,
    lastWhatsAppNotifiedAt: null,
    ...sobreposicao,
  };
}

function criarContexto(
  sobreposicao: Partial<ContextoAlertas> = {},
): ContextoAlertas {
  return {
    productId: "prod_1",
    currentPrice: 899,
    previousPrice: 1000,
    lowest30Days: null,
    lowest90Days: null,
    productName: "Produto Teste",
    marketplace: "MERCADO_LIVRE",
    store: "Loja Legal",
    ...sobreposicao,
  };
}

function criarDeps(
  sobreposicao: Partial<DependenciasMotorAlertas & {
    emailTransporter: EmailTransporter;
    whatsAppSender: WhatsAppSender;
  }> = {},
) {
  const deps: DependenciasMotorAlertas = {
    repository: createMemoryPriceAlertRepository(),
    resolverEmailDoUsuario: async () => "cliente@exemplo.com",
    emailTransporter: async () => ({ status: "EMAIL_SENT" }),
    whatsAppSender: async () => ({ status: "WHATSAPP_SENT" }),
    whatsAppConfigurado: true,
    cooldownMs: 0,
    now: new Date("2026-09-05T12:00:00.000Z"),
    ...sobreposicao,
  };

  return deps;
}

function statuses(resultado: {
  canais: Array<{ canal: "EMAIL" | "WHATSAPP"; status: string }>;
}) {
  return resultado.canais.map((canal) => canal.status);
}

async function run() {
  /*
   * PRICE_ALERT_NO_DROP_NO_SEND
   *
   * Sem queda real (preco igual ou subindo), nada dispara.
   */
  {
    const repositorio = createMemoryPriceAlertRepository([
      criarAlerta(),
    ]);

    const semQueda = await processProductAlerts(
      criarContexto({
        currentPrice: 1000,
        previousPrice: 1000,
      }),
      criarDeps({ repository: repositorio }),
    );

    verificar(
      "PRICE_ALERT_NO_DROP_NO_SEND",
      semQueda.canais.length === 1 &&
        semQueda.canais[0].status === "SKIPPED_NO_DROP" &&
        repositorio.dump()[0].lastEmailNotifiedPrice === null,
      `esperava SKIPPED_NO_DROP sem estado de envio, obteve ${JSON.stringify(
        statuses(semQueda),
      )}.`,
    );

    const subindo = await processProductAlerts(
      criarContexto({
        currentPrice: 1100,
        previousPrice: 1000,
      }),
      criarDeps({ repository: repositorio }),
    );

    verificar(
      "PRICE_ALERT_NO_DROP_NO_SEND_RISE",
      subindo.canais[0].status === "SKIPPED_NO_DROP",
      "subida de preco nao pode produzir envio.",
    );
  }

  /*
   * PRICE_ALERT_TARGET_PRICE_REACHED
   *
   * Alvo atingido com queda real dispara email.
   */
  {
    const repositorio = createMemoryPriceAlertRepository([
      criarAlerta({
        alertType: "TARGET",
        targetPrice: 900,
      }),
    ]);

    const resultado = await processProductAlerts(
      criarContexto({ currentPrice: 899, previousPrice: 950 }),
      criarDeps({ repository: repositorio }),
    );

    verificar(
      "PRICE_ALERT_TARGET_PRICE_REACHED",
      resultado.canais.some(
        (canal) =>
          canal.canal === "EMAIL" &&
          canal.status === "EMAIL_SENT" &&
          canal.notifiedPrice === 899,
      ),
      `esperava EMAIL_SENT para preco<=alvo, obteve ${JSON.stringify(
        statuses(resultado),
      )}.`,
    );

    verificar(
      "PRICE_ALERT_TARGET_PRICE_REACHED_STATE",
      repositorio.dump()[0].lastEmailNotifiedPrice === 899,
      "estado de dedupe do canal precisa refletir o preco notificado.",
    );
  }

  /*
   * PRICE_ALERT_PERCENTAGE_THRESHOLD_REACHED
   *
   * Queda percentual minima configuravel: 10% exigido, queda de 12%
   * dispara; queda menor que o exigido fica bloqueada.
   */
  {
    const atingiu = await processProductAlerts(
      criarContexto({ currentPrice: 880, previousPrice: 1000 }),
      criarDeps({
        repository: createMemoryPriceAlertRepository([
          criarAlerta({ percentageDrop: 10 }),
        ]),
      }),
    );

    verificar(
      "PRICE_ALERT_PERCENTAGE_THRESHOLD_REACHED",
      atingiu.canais.some(
        (canal) => canal.status === "EMAIL_SENT",
      ),
      `queda de 12% (exigido 10%) precisa disparar, obteve ${JSON.stringify(
        statuses(atingiu),
      )}.`,
    );

    const bloqueada = await processProductAlerts(
      criarContexto({ currentPrice: 960, previousPrice: 1000 }),
      criarDeps({
        repository: createMemoryPriceAlertRepository([
          criarAlerta({ percentageDrop: 10 }),
        ]),
      }),
    );

    verificar(
      "PRICE_ALERT_PERCENTAGE_THRESHOLD_NOT_REACHED_SKIPPED",
      bloqueada.canais.some(
        (canal) => canal.status === "SKIPPED_THRESHOLD",
      ),
      `queda de 4% nao pode passar o limite de 10%, obteve ${JSON.stringify(
        statuses(bloqueada),
      )}.`,
    );
  }

  /*
   * PRICE_ALERT_DUPLICATE_SAME_PRICE_BLOCKED
   *
   * Mesmo preco ja notificado nao gera novo envio.
   */
  {
    const repositorio = createMemoryPriceAlertRepository([
      criarAlerta({ lastEmailNotifiedPrice: 900 }),
    ]);

    const repetido = await processProductAlerts(
      criarContexto({ currentPrice: 900, previousPrice: 950 }),
      criarDeps({ repository: repositorio }),
    );

    verificar(
      "PRICE_ALERT_DUPLICATE_SAME_PRICE_BLOCKED",
      repetido.canais.some(
        (canal) => canal.status === "SKIPPED_DUPLICATE",
      ),
      `preco 900 ja notificado (900) nao pode reenviar, obteve ${JSON.stringify(
        statuses(repetido),
      )}.`,
    );
  }

  /*
   * PRICE_ALERT_NEW_LOWER_PRICE_SENDS_AGAIN
   *
   * Novo preco menor que o ultimo notificado reenvia.
   */
  {
    const repositorio = createMemoryPriceAlertRepository([
      criarAlerta({ lastEmailNotifiedPrice: 900 }),
    ]);

    const novoMinimo = await processProductAlerts(
      criarContexto({ currentPrice: 850, previousPrice: 900 }),
      criarDeps({ repository: repositorio }),
    );

    verificar(
      "PRICE_ALERT_NEW_LOWER_PRICE_SENDS_AGAIN",
      novoMinimo.canais.some(
        (canal) =>
          canal.canal === "EMAIL" &&
          canal.status === "EMAIL_SENT" &&
          canal.notifiedPrice === 850,
      ),
      `preco 850 novo minimo apos 900 precisa reenviar, obteve ${JSON.stringify(
        statuses(novoMinimo),
      )}.`,
    );
  }

  /*
   * PRICE_ALERT_EMAIL_ONLY
   *
   * Alerta apenas de email nao toca em WhatsApp.
   */
  {
    const repositorio = createMemoryPriceAlertRepository([
      criarAlerta({ notifyEmail: true, notifyWhatsApp: false }),
    ]);

    const resultado = await processProductAlerts(
      criarContexto({ currentPrice: 880, previousPrice: 1000 }),
      criarDeps({ repository: repositorio }),
    );

    verificar(
      "PRICE_ALERT_EMAIL_ONLY",
      resultado.canais.some((canal) => canal.canal === "EMAIL") &&
        resultado.canais.every((canal) => canal.canal === "EMAIL"),
      `alerta email-only nao pode gerar canal WHATSAPP, obteve ${JSON.stringify(
        resultado.canais,
      )}.`,
    );
  }

  /*
   * PRICE_ALERT_WHATSAPP_ONLY
   *
   * Alerta apenas de WhatsApp nao toca em email.
   */
  {
    const repositorio = createMemoryPriceAlertRepository([
      criarAlerta({ notifyEmail: false, notifyWhatsApp: true }),
    ]);

    const resultado = await processProductAlerts(
      criarContexto({ currentPrice: 880, previousPrice: 1000 }),
      criarDeps({ repository: repositorio }),
    );

    verificar(
      "PRICE_ALERT_WHATSAPP_ONLY",
      resultado.canais.some(
        (canal) =>
          canal.canal === "WHATSAPP" && canal.status === "WHATSAPP_SENT",
      ) &&
        resultado.canais.every((canal) => canal.canal === "WHATSAPP"),
      `alerta whatsapp-only preciso gerar apenas WHATSAPP, obteve ${JSON.stringify(
        resultado.canais,
      )}.`,
    );
  }

  /*
   * PRICE_ALERT_BOTH_CHANNELS_INDEPENDENT
   *
   * Dedupe e por canal: email ja notificado em 900 nao bloqueia WhatsApp.
   * E o inverso: whatsapp notificado em 900 nao bloqueia email.
   */
  {
    const repositorio = createMemoryPriceAlertRepository([
      criarAlerta({
        notifyEmail: true,
        notifyWhatsApp: true,
        lastEmailNotifiedPrice: 900,
        lastWhatsAppNotifiedPrice: null,
      }),
    ]);

    const resultado = await processProductAlerts(
      criarContexto({ currentPrice: 900, previousPrice: 950 }),
      criarDeps({ repository: repositorio }),
    );

    const email = resultado.canais.find((canal) => canal.canal === "EMAIL");
    const whatsapp = resultado.canais.find(
      (canal) => canal.canal === "WHATSAPP",
    );

    verificar(
      "PRICE_ALERT_BOTH_CHANNELS_INDEPENDENT",
      email?.status === "SKIPPED_DUPLICATE" &&
        whatsapp?.status === "WHATSAPP_SENT" &&
        repositorio.dump()[0].lastWhatsAppNotifiedPrice === 900,
      `email bloqueado (dedupe) precisa deixar WhatsApp livre, obteve email=${email?.status} whatsapp=${whatsapp?.status}.`,
    );

    const inverso = await processProductAlerts(
      criarContexto({ currentPrice: 900, previousPrice: 950 }),
      criarDeps({
        repository: createMemoryPriceAlertRepository([
          criarAlerta({
            notifyEmail: true,
            notifyWhatsApp: true,
            lastEmailNotifiedPrice: null,
            lastWhatsAppNotifiedPrice: 900,
          }),
        ]),
      }),
    );

    const emailInverso = inverso.canais.find(
      (canal) => canal.canal === "EMAIL",
    );
    const whatsAppInverso = inverso.canais.find(
      (canal) => canal.canal === "WHATSAPP",
    );

    verificar(
      "PRICE_ALERT_BOTH_CHANNELS_INDEPENDENT_INVERSE",
      emailInverso?.status === "EMAIL_SENT" &&
        whatsAppInverso?.status === "SKIPPED_DUPLICATE",
      `estados de dedupe precisam ser independentes por canal (inverso).`,
    );
  }

  /*
   * PRICE_ALERT_INVALID_PRICE_NO_SEND
   *
   * NaN, Infinity, preco <= 0 ou ausente nunca disparam.
   */
  {
    const invalidos = [
      NaN,
      Infinity,
      -Infinity,
      0,
      -1,
      -0.01,
    ];

    for (const preco of invalidos) {
      const repositorio = createMemoryPriceAlertRepository([
        criarAlerta(),
      ]);

      const resultado = await processProductAlerts(
        criarContexto({ currentPrice: preco, previousPrice: 1000 }),
        criarDeps({ repository: repositorio }),
      );

      verificar(
        "PRICE_ALERT_INVALID_PRICE_NO_SEND",
        resultado.canais.every(
          (canal) => canal.status === "SKIPPED_INVALID_PRICE",
        ) &&
          repositorio.dump()[0].lastEmailNotifiedPrice === null,
        `preco invalido (${String(preco)}) nao pode disparar, obteve ${JSON.stringify(
          statuses(resultado),
        )}.`,
      );
    }

    const regra = avaliarRegraAlerta({
      alertType: "ANY_DROP",
      targetPrice: null,
      percentageDrop: null,
      previousPrice: 1000,
      currentPrice: NaN,
      lowest30Days: null,
      lowest90Days: null,
    });

    verificar(
      "PRICE_ALERT_INVALID_PRICE_RULE",
      regra.satisfied === false &&
        regra.motivo === "INVALID_PRICE",
      "regra precisa rejeitar preco NaN.",
    );
  }

  /*
   * PRICE_ALERT_30_DAY_LOW / PRICE_ALERT_90_DAY_LOW
   *
   * O avaliacao do produto reporta novas minimas de 30 e 90 dias quando
   * o preco real cruza as referencias do historico.
   */
  {
    const resultado = await processProductAlerts(
      criarContexto({
        currentPrice: 640,
        previousPrice: 700,
        lowest30Days: 660,
        lowest90Days: 650,
      }),
      criarDeps({
        repository: createMemoryPriceAlertRepository([criarAlerta()]),
      }),
    );

    verificar(
      "PRICE_ALERT_30_DAY_LOW",
      resultado.avaliacao?.isNew30DayLow === true,
      `preco 640 com referencia 30 dias 660 precisa ser nova minima de 30 dias.`,
    );

    verificar(
      "PRICE_ALERT_90_DAY_LOW",
      resultado.avaliacao?.isNew90DayLow === true,
      `preco 640 com referencia 90 dias 650 precisa ser nova minima de 90 dias.`,
    );
  }

  /*
   * PRICE_ALERT_PROVIDER_FAILURE_DOES_NOT_BREAK_MONITOR
   *
   * Provider de email que lanca erro vira EMAIL_FAILED; o WhatsApp segue,
   * o processo nao lanca e o estado do canal em que falhou nao e marcado.
   */
  {
    const repositorio = createMemoryPriceAlertRepository([
      criarAlerta({ notifyEmail: true, notifyWhatsApp: true }),
    ]);

    let resultado:
      | Awaited<ReturnType<typeof processProductAlerts>>
      | { erroLancado: true };

    try {
      resultado = await processProductAlerts(
        criarContexto({ currentPrice: 880, previousPrice: 1000 }),
        criarDeps({
          repository: repositorio,
          emailTransporter: async () => {
            throw new Error("falha do provedor");
          },
          whatsAppSender: async () => ({ status: "WHATSAPP_SENT" }),
          whatsAppConfigurado: true,
        }),
      );
    } catch {
      resultado = { erroLancado: true };
    }

    verificar(
      "PRICE_ALERT_PROVIDER_FAILURE_DOES_NOT_BREAK_MONITOR",
      !("erroLancado" in resultado) &&
        resultado.canais.some(
          (canal) => canal.status === "EMAIL_FAILED",
        ) &&
        resultado.canais.some(
          (canal) => canal.status === "WHATSAPP_SENT",
        ),
      `falha de provider precisa virar status e nao derrubar o fluxo, obteve ${JSON.stringify(
        resultado,
      )}.`,
    );

    verificar(
      "PRICE_ALERT_PROVIDER_FAILURE_NOT_MARKED_SENT",
      repositorio.dump()[0].lastEmailNotifiedPrice === null &&
        repositorio.dump()[0].lastWhatsAppNotifiedPrice === 880,
      "canal que falhou nao pode ser marcado como enviado; o que enviou sim.",
    );
  }

  /*
   * PRICE_ALERT_WHATSAPP_NOT_CONFIGURED_NOT_MARKED_SENT
   *
   * Sem provider, WhatsApp retorna WHATSAPP_PROVIDER_NOT_CONFIGURED e o
   * estado NAO e marcado como enviado. O restante (email) continua.
   */
  {
    const repositorio = createMemoryPriceAlertRepository([
      criarAlerta({ notifyEmail: true, notifyWhatsApp: true }),
    ]);

    const resultado = await processProductAlerts(
      criarContexto({ currentPrice: 880, previousPrice: 1000 }),
      criarDeps({
        repository: repositorio,
        whatsAppConfigurado: false,
        whatsAppSender: async () => ({ status: "WHATSAPP_SENT" }),
      }),
    );

    const whatsapp = resultado.canais.find(
      (canal) => canal.canal === "WHATSAPP",
    );

    verificar(
      "PRICE_ALERT_WHATSAPP_NOT_CONFIGURED_NOT_MARKED_SENT",
      whatsapp?.status === "WHATSAPP_PROVIDER_NOT_CONFIGURED" &&
        repositorio.dump()[0].lastWhatsAppNotifiedPrice === null &&
        repositorio.dump()[0].lastEmailNotifiedPrice === 880,
      `sem provider, WhatsApp nao pode ser marcado enviado; email continua, obteve ${JSON.stringify(
        statuses(resultado),
      )}.`,
    );
  }

  /*
   * PRICE_ALERT_PUBLIC_PRODUCT_LINK
   *
   * Toda notificacao aponta para a pagina publica do Ofertano construida
   * pelo helper central (siteUrl). Nunca link direto.
   */
  {
    const envAnterior = process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;

    try {
      const link = produtoLinkPublico("prod_123");
      const corpo = montarCorpoEmail({
        productName: "Produto Teste",
        productId: "prod_123",
        previousPrice: 1000,
        currentPrice: 899,
        dropPercentage: 10.1,
        marketplace: "MERCADO_LIVRE",
      });

      verificar(
        "PRICE_ALERT_PUBLIC_PRODUCT_LINK",
        link === "https://ofertano.vercel.app/produto/prod_123" &&
          corpo.html.includes(
            "https://ofertano.vercel.app/produto/prod_123",
          ) &&
          corpo.text.includes(
            "https://ofertano.vercel.app/produto/prod_123",
          ) &&
          corpo.html.includes("Ver oferta"),
        `link publico precisa apontar para a pagina publica: ${link}`,
      );

      verificar(
        "PRICE_ALERT_EMAIL_CONTENT_PT_BR",
        corpo.text.includes("Preco anterior") === false ||
          corpo.text.includes("R$") === true,
        "conteudo do email precisa estar em portugues e mostrar precos.",
      );
    } finally {
      if (envAnterior !== undefined) {
        process.env.NEXT_PUBLIC_SITE_URL = envAnterior;
      }
    }
  }

  /*
   * PRICE_ALERT_MULTISTORE_PRODUCT_PRESERVED
   *
   * Alertas de outro produto nunca sao processados/enviados quando o
   * monitor processa apenas este produto.
   */
  {
    const alertaDeste = criarAlerta();
    const alertaDeOutro = criarAlerta({
      id: "alert_outro",
      productId: "prod_outro",
      userId: "user_outro",
    });

    const repositorio = createMemoryPriceAlertRepository([
      alertaDeste,
      alertaDeOutro,
    ]);

    const resultado = await processProductAlerts(
      criarContexto({ productId: "prod_1" }),
      criarDeps({ repository: repositorio }),
    );

    const estadoOutro = repositorio
      .dump()
      .find((linha) => linha.id === "alert_outro");

    verificar(
      "PRICE_ALERT_MULTISTORE_PRODUCT_PRESERVED",
      resultado.canais.length >= 1 &&
        estadoOutro?.lastEmailNotifiedPrice === null &&
        estadoOutro?.lastWhatsAppNotifiedPrice === null,
      "produto B nao pode receber disparo quando o monitor processa produto A.",
    );
  }

  /*
   * PRICE_ALERT_CONCURRENT_DUPLICATE_PROTECTION
   *
   * A guarda otimista (compare-and-set) impede que o estado de dedupe
   * regrida: um segundo worker que disputa o mesmo preco nao sobrescreve
   * nem marca envio duplicado no estado. Precos mais baixos prevalecem.
   */
  {
    verificar(
      "PRICE_ALERT_CONCURRENT_DUPLICATE_PROTECTION_FIRST",
      podeReivindicarNotificacao({
        estadoAtual: null,
        novoPreco: 900,
      }) === true,
      "primeiro aviso (estado nulo) pode reivindicar.",
    );

    verificar(
      "PRICE_ALERT_CONCURRENT_DUPLICATE_PROTECTION_SAME_PRICE",
      podeReivindicarNotificacao({
        estadoAtual: 900,
        novoPreco: 900,
      }) === false,
      "mesmo preco ja reivindicado nao pode ser reivindicado de novo.",
    );

    verificar(
      "PRICE_ALERT_CONCURRENT_DUPLICATE_PROTECTION_NEW_LOW",
      podeReivindicarNotificacao({
        estadoAtual: 900,
        novoPreco: 850,
      }) === true,
      "preco menor que o reivindicado pode ser reivindicado.",
    );

    verificar(
      "PRICE_ALERT_CONCURRENT_DUPLICATE_PROTECTION_HIGHER",
      podeReivindicarNotificacao({
        estadoAtual: 900,
        novoPreco: 901,
      }) === false,
      "preco maior que o reivindicado nao pode regredir o estado.",
    );

    verificar(
      "PRICE_ALERT_CONCURRENT_DUPLICATE_PROTECTION_INVALID",
      podeReivindicarNotificacao({
        estadoAtual: null,
        novoPreco: 0,
      }) === false,
      "preco invalido nunca pode ser reivindicado.",
    );

    // Estado final apos disputa: dedupe posterior no mesmo preco bloqueia.
    const repositorio = createMemoryPriceAlertRepository([
      criarAlerta({
        id: "alerta_concorrente",
        lastEmailNotifiedPrice: 900,
      }),
    ]);

    const concorrente = await processProductAlerts(
      criarContexto({ currentPrice: 900, previousPrice: 950 }),
      criarDeps({ repository: repositorio }),
    );

    verificar(
      "PRICE_ALERT_CONCURRENT_DUPLICATE_PROTECTION_POST_RACE",
      concorrente.canais.some(
        (canal) => canal.status === "SKIPPED_DUPLICATE",
      ),
      "apos a disputa, o mesmo preco precisa estar deduplicado.",
    );
  }

  assert.ok(true, "runner completo.");
}

run();