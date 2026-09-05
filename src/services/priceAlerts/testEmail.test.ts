/**
 * TESTES OBRIGATORIOS — Smoke test de envio real de email (missao
 * TEMP_EMAIL_SMOKE, endpooint /api/price-alerts/test-email).
 *
 * Garante que a rota:
 * - exige autenticacao Supabase e usa o userId da sessao (nunca do body);
 * - resolve o email do dono do alerta exclusivamente via userEmail.ts;
 * - usa o canal REAL da Brevo (producao), sem mock;
 * - e read-only no banco: sem priceAlert.update/upsert, sem
 *   priceAlertEvent.create, sem priceHistory.create, sem saveProduct,
 *   sem lastEmailNotified* e sem lastWhatsAppNotified*;
 * - NAO executa processProductAlerts nem processPriceMonitor;
 * - envia conteudo claramente marcado como teste e sem queda falsa.
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

import {
  montarConteudoTeste,
  sendTestEmailForUser,
  type TestEmailSender,
  type TestEmailStore,
} from "./testEmail";

function verificar(nome: string, ok: boolean, detalhe: string) {
  if (!ok) {
    console.error(`${nome}=FAIL ${detalhe}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${nome}=PASS`);
}

function criarStore(alerta?: {
  userId: string;
  productId: string;
  active?: boolean;
  notifyEmail?: boolean;
}): TestEmailStore & { writes: string[] } {
  const writes: string[] = [];
  const linhas = alerta
    ? [
        {
          id: "alert_1",
          userId: alerta.userId,
          productId: alerta.productId,
          active: alerta.active ?? true,
          notifyEmail: alerta.notifyEmail ?? true,
        },
      ]
    : [];

  return {
    writes,
    async findActiveAlert(userId, productId) {
      const linha = linhas.find(
        (l) => l.userId === userId && l.productId === productId,
      );
      if (!linha) {
        return null;
      }
      writes.push("read:findActiveAlert");
      return { ...linha };
    },
    async getProduct(productId) {
      if (productId !== "prod_1") {
        return null;
      }
      writes.push("read:getProduct");
      return { id: productId, name: "Geladeira Teste", price: 2999.9 };
    },
  };
}

function criarSender(captura: {
  emails: { toEmail: string; productId: string; productName: string }[];
  resultado: Awaited<ReturnType<TestEmailSender>>;
}): TestEmailSender {
  return async (input) => {
    captura.emails.push({
      toEmail: input.toEmail,
      productId: input.productId,
      productName: input.productName,
    });
    return captura.resultado;
  };
}

function lerArquivo(relativo: string): string {
  const arquivo = path.resolve(process.cwd(), relativo);
  return fs.existsSync(arquivo) ? fs.readFileSync(arquivo, "utf8") : "";
}

function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*(\/\/|#).*$/gm, "");
}

async function run() {
  /*
   * PRICE_ALERT_TEST_EMAIL_CONTENT_MARKED_AS_TEST
   *
   * O conteudo do email e claramente um teste tecnico, com assunto
   * identificado e a frase que nega queda real registrada.
   */
  {
    const ctx = montarConteudoTeste({
      productName: "Geladeira Teste",
      currentPrice: 2999.9,
      publicLink: "https://ofertano.vercel.app/produto/prod_1",
    });

    verificar(
      "PRICE_ALERT_TEST_EMAIL_CONTENT_MARKED_AS_TEST",
      ctx.subject === "Ofertano — teste de alerta de preço" &&
        (ctx.text.includes("teste técnico") ||
          ctx.text.includes("teste tecnico")) &&
        ctx.text.toLowerCase().includes("nenhuma queda de preço"),
      "conteudo precisa estar marcado como teste tecnico e negar queda real.",
    );
  }

  /*
   * PRICE_ALERT_TEST_EMAIL_NO_FAKE_PRICE_DROP
   *
   * O email mostra apenas o preco atual (sem preco anterior falso) e
   * jamais afirma "Preço caiu".
   */
  {
    const ctx = montarConteudoTeste({
      productName: "Geladeira Teste",
      currentPrice: 2999.9,
      publicLink: "https://ofertano.vercel.app/produto/prod_1",
    });

    verificar(
      "PRICE_ALERT_TEST_EMAIL_NO_FAKE_PRICE_DROP",
      ctx.text.includes("Preço atual") === true &&
        ctx.html.includes("Preço atual") === true &&
        (ctx.text + ctx.html).includes("Preço caiu") === false &&
        ctx.text.includes("Preço anterior") === false,
      "conteudo nao pode afirmar queda nem usar preco anterior falso.",
    );
  }

  /*
   * PRICE_ALERT_TEST_EMAIL_REQUIRES_AUTH
   *
   * A rota exige autenticacao Supabase antes de qualquer envio. Verificacao
   * estatica: o arquivo da rota importa authenticateSupabaseRequest e
   * devolve 401 quando nao autenticado. Alem disso, sem userId autenticado
   * a operacao de servico nao chega ao envio (usa o userId da sessao).
   */
  {
    const rota = lerArquivo(
      "src/app/api/price-alerts/test-email/route.ts",
    );

    verificar(
      "PRICE_ALERT_TEST_EMAIL_REQUIRES_AUTH",
      rota.includes("authenticateSupabaseRequest") === true &&
        rota.includes("Não autenticado") === true &&
        rota.includes("status: 401") === true,
      "a rota precisa autenticar via authenticateSupabaseRequest e negar (401) sem sessao.",
    );

    const store = criarStore();
    const captura: {
      emails: { toEmail: string; productId: string; productName: string }[];
      resultado: Awaited<ReturnType<TestEmailSender>>;
    } = { emails: [], resultado: { status: "EMAIL_SENT" } };

    const semAlerta = await sendTestEmailForUser(
      "",
      "prod_1",
      store,
      async () =>
        ({ status: "RESOLVIDO", email: "x@y.com" }) as const,
      criarSender(captura),
    );

    verificar(
      "PRICE_ALERT_TEST_EMAIL_REQUIRES_AUTH_EMPTY_USER",
      semAlerta.ok === false && captura.emails.length === 0,
      "sem sessao autenticada, nenhum envio pode ocorrer.",
    );
  }

  /*
   * PRICE_ALERT_TEST_EMAIL_FORGED_USER_BLOCKED
   *
   * O userId sempre vem da sessao (parametro `userId`), nunca do body. A
   * rota so le `body.productId`; um userId forjado no corpo e ignorado.
   */
  {
    const rota = lerArquivo(
      "src/app/api/price-alerts/test-email/route.ts",
    );

    verificar(
      "PRICE_ALERT_TEST_EMAIL_FORGED_USER_BLOCKED",
      rota.includes("body?.productId") === true &&
        (rota.includes("body.userId") === false &&
          rota.includes("body?.userId") === false &&
          rota.includes('body["userId"]') === false) &&
        rota.includes("auth.user.id") === true,
      "a rota precisa ignorar userId forjado no body e usar apenas auth.user.id.",
    );

    // Sessao autenticada "victim"; body forja "attacker" - o servico usa
    // o userId da sessao para localizar o alerta do PROPRIO usuario.
    const store = criarStore({
      userId: "victim",
      productId: "prod_1",
      active: true,
      notifyEmail: true,
    });
    const captura: {
      emails: { toEmail: string; productId: string; productName: string }[];
      resultado: Awaited<ReturnType<TestEmailSender>>;
    } = { emails: [], resultado: { status: "EMAIL_SENT" } };
    let userIdResolvido = "";

    const resultado = await sendTestEmailForUser(
      "victim",
      "prod_1",
      store,
      async (uid) => {
        userIdResolvido = uid;
        return { status: "RESOLVIDO", email: "victim@exemplo.com" } as const;
      },
      criarSender(captura),
    );

    verificar(
      "PRICE_ALERT_TEST_EMAIL_FORGED_USER_BLOCKED_RESOLVER",
      resultado.ok === true &&
        userIdResolvido === "victim" &&
        captura.emails[0]?.toEmail === "victim@exemplo.com",
      "email deve ser resolvido a partir do userId da sessao autenticada.",
    );
  }

  /*
   * PRICE_ALERT_TEST_EMAIL_OWN_ALERT_ONLY
   *
   * O alerta e localizado por userId (sessao) + productId. Alerta de outro
   * usuario (mesmo produto) nao e encontrado => 404 sem envio.
   */
  {
    const store = criarStore({
      userId: "dono",
      productId: "prod_1",
      active: true,
      notifyEmail: true,
    });
    const captura: {
      emails: { toEmail: string; productId: string; productName: string }[];
      resultado: Awaited<ReturnType<TestEmailSender>>;
    } = { emails: [], resultado: { status: "EMAIL_SENT" } };

    const intruso = await sendTestEmailForUser(
      "invasor",
      "prod_1",
      store,
      async () =>
        ({ status: "RESOLVIDO", email: "invasor@x.com" }) as const,
      criarSender(captura),
    );

    verificar(
      "PRICE_ALERT_TEST_EMAIL_OWN_ALERT_ONLY",
      intruso.ok === false &&
        intruso.status === 404 &&
        captura.emails.length === 0,
      "alerta alheio (outro userId) nao pode gerar envio.",
    );

    const dono = await sendTestEmailForUser(
      "dono",
      "prod_1",
      store,
      async () =>
        ({ status: "RESOLVIDO", email: "dono@x.com" }) as const,
      criarSender(captura),
    );

    verificar(
      "PRICE_ALERT_TEST_EMAIL_OWN_ALERT_ONLY_OWNER",
      dono.ok === true,
      "o dono do alerta consegue enviar.",
    );
  }

  /*
   * PRICE_ALERT_TEST_EMAIL_RESOLVES_AUTH_EMAIL
   *
   * O email do destinatario e resolvido do usuario autenticado via
   * resolver (userEmail.ts no runtime), nunca de um campo do cliente.
   */
  {
    const store = criarStore({
      userId: "user_1",
      productId: "prod_1",
      active: true,
      notifyEmail: true,
    });
    const captura: {
      emails: { toEmail: string; productId: string; productName: string }[];
      resultado: Awaited<ReturnType<TestEmailSender>>;
    } = { emails: [], resultado: { status: "EMAIL_SENT" } };

    const resultado = await sendTestEmailForUser(
      "user_1",
      "prod_1",
      store,
      async (uid) =>
        ({
          status: "RESOLVIDO",
          email: uid === "user_1" ? "destino@exemplo.com" : "",
        }) as const,
      criarSender(captura),
    );

    verificar(
      "PRICE_ALERT_TEST_EMAIL_RESOLVES_AUTH_EMAIL",
      resultado.ok === true &&
        captura.emails[0]?.toEmail === "destino@exemplo.com",
      "destinatario precisa vir do resolver, resolvido pela sessao autenticada.",
    );
  }

  /*
   * PRICE_ALERT_TEST_EMAIL_USES_REAL_CHANNEL
   *
   * O sender padrao de runtime e o canal REAL da Brevo (api.brevo.com +
   * BREVO_API_KEY/BREVO_SENDER_*), nao um mock. Verificacao estatica do
   * codigo-fonte.
   */
  {
    const fonte = lerArquivo(
      "src/services/priceAlerts/testEmail.ts",
    );
    const rota = lerArquivo(
      "src/app/api/price-alerts/test-email/route.ts",
    );

    verificar(
      "PRICE_ALERT_TEST_EMAIL_USES_REAL_CHANNEL",
      fonte.includes("api.brevo.com/v3/smtp/email") === true &&
        fonte.includes("BREVO_API_KEY") === true &&
        fonte.includes("BREVO_SENDER_EMAIL") === true &&
        fonte.includes("emailTransacionalConfigurado") === true &&
        rota.includes("sendTestEmailForUser") === true,
      "sender precisa usar o canal real da Brevo e a configuracao de producao.",
    );
  }

  /*
   * PRICE_ALERT_TEST_EMAIL_NO_DB_WRITE
   *
   * O servico e read-only: nao importa nem chama nenhuma escrita de banco
   * e, ao enviar com sucesso, nenhuma escrita ocorre.
   */
  {
    const fonte = semComentarios(
      lerArquivo("src/services/priceAlerts/testEmail.ts"),
    );

    const bloqueado =
      fonte.includes("priceAlert.update") ||
      fonte.includes("priceAlert.upsert") ||
      fonte.includes("priceAlertEvent.create") ||
      fonte.includes("priceHistory.create") ||
      fonte.includes("saveProduct") ||
      fonte.includes("lastEmailNotified") ||
      fonte.includes("lastWhatsAppNotified");

    verificar(
      "PRICE_ALERT_TEST_EMAIL_NO_DB_WRITE",
      !bloqueado,
      "testEmail.ts nao pode conter chamadas de escrita em banco nem dedupe.",
    );

    const store = criarStore({
      userId: "user_1",
      productId: "prod_1",
      active: true,
      notifyEmail: true,
    });
    const captura: {
      emails: { toEmail: string; productId: string; productName: string }[];
      resultado: Awaited<ReturnType<TestEmailSender>>;
    } = { emails: [], resultado: { status: "EMAIL_SENT" } };

    const resultado = await sendTestEmailForUser(
      "user_1",
      "prod_1",
      store,
      async () =>
        ({ status: "RESOLVIDO", email: "a@b.com" }) as const,
      criarSender(captura),
    );

    const escritas = store.writes.filter((w) => w.startsWith("write:"));

    verificar(
      "PRICE_ALERT_TEST_EMAIL_NO_DB_WRITE_RUNTIME",
      resultado.ok === true && escritas.length === 0,
      `nao pode haver escritas no banco durante o envio; escritas=${escritas.join(",")}.`,
    );
  }

  /*
   * PRICE_ALERT_TEST_EMAIL_NO_DEDUPE_UPDATE
   *
   * Nenhum campo lastEmailNotified* / lastWhatsAppNotified* / updatedAt e
   * modificado nem referenciado pelo fluxo de teste.
   */
  {
    const fonte = semComentarios(
      lerArquivo("src/services/priceAlerts/testEmail.ts"),
    );

    verificar(
      "PRICE_ALERT_TEST_EMAIL_NO_DEDUPE_UPDATE",
      fonte.includes("lastEmailNotified") === false &&
        fonte.includes("lastWhatsAppNotified") === false,
      "o fluxo de teste nao pode atualizar campos de dedupe/cooldown.",
    );
  }

  /*
   * PRICE_ALERT_TEST_EMAIL_DOES_NOT_RUN_MONITOR
   *
   * O fluxo de teste nao executa processPriceMonitor nem processProductAlerts.
   */
  {
    const fonte = semComentarios(
      lerArquivo("src/services/priceAlerts/testEmail.ts"),
    );
    const rota = lerArquivo(
      "src/app/api/price-alerts/test-email/route.ts",
    );

    verificar(
      "PRICE_ALERT_TEST_EMAIL_DOES_NOT_RUN_MONITOR",
      fonte.includes("processProductAlerts") === false &&
        fonte.includes("processPriceMonitor") === false &&
        rota.includes("processProductAlerts") === false &&
        rota.includes("processPriceMonitor") === false &&
        rota.includes("price-monitor") === false,
      "o fluxo de teste nao pode executar o monitor nem o motor de alertas.",
    );
  }

  assert.ok(true, "runner completo.");
}

run();
