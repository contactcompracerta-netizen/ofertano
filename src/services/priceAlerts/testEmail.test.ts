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
  testEmailSenderPadrao,
  type TestEmailSender,
  type TestEmailStore,
} from "./testEmail";
import { codigoBrevoDeStatus } from "./channels/emailChannel";
import { buscarEmailDoUsuarioDiagnostico } from "./userEmail";

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

  /*
   * TEST_EMAIL_DIAG_SUPABASE_NOT_CONFIGURED
   *
   * Sem SUPABASE_SERVICE_ROLE_KEY no runtime, o resolver diagnostico
   * devolve RESOLVER_NAO_CONFIGURADO e o smoke test retorna o codigo
   * sanitizado SUPABASE_ADMIN_NOT_CONFIGURED (HTTP 500) sem enviar nada.
   */
  {
    const chaveAnterior = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const urlAnterior = process.env.NEXT_PUBLIC_SUPABASE_URL;

    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";

    try {
      const store = criarStore({
        userId: "user_1",
        productId: "prod_1",
        active: true,
        notifyEmail: true,
      });
      const captura: {
        emails: { toEmail: string }[];
        resultado: Awaited<ReturnType<TestEmailSender>>;
      } = { emails: [], resultado: { status: "EMAIL_SENT" } };

      const resultado = await sendTestEmailForUser(
        "user_1",
        "prod_1",
        store,
        buscarEmailDoUsuarioDiagnostico,
        criarSender(captura),
      );

      verificar(
        "TEST_EMAIL_DIAG_SUPABASE_NOT_CONFIGURED",
        resultado.ok === false &&
          resultado.status === 500 &&
          "code" in resultado &&
          resultado.code === "SUPABASE_ADMIN_NOT_CONFIGURED" &&
          captura.emails.length === 0,
        `sem service role, esperava SUPABASE_ADMIN_NOT_CONFIGURED sem envio; obteve ${JSON.stringify(
          resultado,
        )}.`,
      );
    } finally {
      if (chaveAnterior !== undefined) {
        process.env.SUPABASE_SERVICE_ROLE_KEY = chaveAnterior;
      }
      if (urlAnterior !== undefined) {
        process.env.NEXT_PUBLIC_SUPABASE_URL = urlAnterior;
      }
    }
  }

  /*
   * TEST_EMAIL_DIAG_EMAIL_RESOLUTION_FAILED
   *
   * Chamada Admin que falha (sem resposta) vira EMAIL_RESOLUTION_FAILED,
   * distinta de SUPABASE_ADMIN_NOT_CONFIGURED e de EMAIL_NOT_FOUND.
   */
  {
    const store = criarStore({
      userId: "user_1",
      productId: "prod_1",
      active: true,
      notifyEmail: true,
    });
    const captura: {
      emails: { toEmail: string }[];
      resultado: Awaited<ReturnType<TestEmailSender>>;
    } = { emails: [], resultado: { status: "EMAIL_SENT" } };

    const resultado = await sendTestEmailForUser(
      "user_1",
      "prod_1",
      store,
      async () => ({ status: "RESOLUTION_FAILED" }) as const,
      criarSender(captura),
    );

    verificar(
      "TEST_EMAIL_DIAG_EMAIL_RESOLUTION_FAILED",
      resultado.ok === false &&
        "code" in resultado &&
        resultado.code === "EMAIL_RESOLUTION_FAILED" &&
        captura.emails.length === 0,
      `falha da chamada Admin deve virar EMAIL_RESOLUTION_FAILED; obteve ${JSON.stringify(
        resultado,
      )}.`,
    );
  }

  /*
   * TEST_EMAIL_DIAG_EMAIL_NOT_FOUND
   *
   * Usuario sem email na Auth vira EMAIL_NOT_FOUND (nao confundir com
   * falta de configuracao nem com falha da chamada).
   */
  {
    const store = criarStore({
      userId: "user_1",
      productId: "prod_1",
      active: true,
      notifyEmail: true,
    });
    const captura: {
      emails: { toEmail: string }[];
      resultado: Awaited<ReturnType<TestEmailSender>>;
    } = { emails: [], resultado: { status: "EMAIL_SENT" } };

    const resultado = await sendTestEmailForUser(
      "user_1",
      "prod_1",
      store,
      async () => ({ status: "USUARIO_NAO_ENCONTRADO" }) as const,
      criarSender(captura),
    );

    verificar(
      "TEST_EMAIL_DIAG_EMAIL_NOT_FOUND",
      resultado.ok === false &&
        "code" in resultado &&
        resultado.code === "EMAIL_NOT_FOUND" &&
        captura.emails.length === 0,
      `usuario sem email deve virar EMAIL_NOT_FOUND; obteve ${JSON.stringify(
        resultado,
      )}.`,
    );
  }

  /*
   * TEST_EMAIL_DIAG_BREVO_NOT_CONFIGURED
   *
   * Sem BREVO_API_KEY/BREVO_SENDER_EMAIL o sender padrao devolve
   * EMAIL_NOT_CONFIGURED e o smoke test traduz para BREVO_NOT_CONFIGURED.
   */
  {
    const store = criarStore({
      userId: "user_1",
      productId: "prod_1",
      active: true,
      notifyEmail: true,
    });
    const captura: {
      emails: { toEmail: string }[];
      resultado: Awaited<ReturnType<TestEmailSender>>;
    } = {
      emails: [],
      resultado: { status: "EMAIL_NOT_CONFIGURED", code: "BREVO_NOT_CONFIGURED" },
    };

    const resultado = await sendTestEmailForUser(
      "user_1",
      "prod_1",
      store,
      async () => ({ status: "RESOLVIDO", email: "a@b.com" }) as const,
      criarSender(captura),
    );

    verificar(
      "TEST_EMAIL_DIAG_BREVO_NOT_CONFIGURED",
      resultado.ok === false &&
        "code" in resultado &&
        resultado.code === "BREVO_NOT_CONFIGURED",
      `sem configuracao Brevo deve virar BREVO_NOT_CONFIGURED; obteve ${JSON.stringify(
        resultado,
      )}.`,
    );
  }

  /*
   * TEST_EMAIL_DIAG_BREVO_400 / 401 / 403 / 429 / 500
   *
   * O mapeamento status HTTP Brevo -> codigo sanitizado
   * (codigoBrevoDeStatus) e a propagacao do codigo do sender ao outcome.
   */
  {
    verificar(
      "TEST_EMAIL_DIAG_BREVO_400",
      codigoBrevoDeStatus(400) === "BREVO_BAD_REQUEST" &&
        codigoBrevoDeStatus(402) === "BREVO_UNKNOWN_ERROR",
      "status 400 deve mapear para BREVO_BAD_REQUEST.",
    );
    verificar(
      "TEST_EMAIL_DIAG_BREVO_401",
      codigoBrevoDeStatus(401) === "BREVO_AUTH_FAILED",
      "status 401 deve mapear para BREVO_AUTH_FAILED.",
    );
    verificar(
      "TEST_EMAIL_DIAG_BREVO_403",
      codigoBrevoDeStatus(403) === "BREVO_FORBIDDEN",
      "status 403 deve mapear para BREVO_FORBIDDEN.",
    );
    verificar(
      "TEST_EMAIL_DIAG_BREVO_429",
      codigoBrevoDeStatus(429) === "BREVO_RATE_LIMITED",
      "status 429 deve mapear para BREVO_RATE_LIMITED.",
    );
    verificar(
      "TEST_EMAIL_DIAG_BREVO_500",
      codigoBrevoDeStatus(500) === "BREVO_PROVIDER_ERROR" &&
        codigoBrevoDeStatus(502) === "BREVO_PROVIDER_ERROR",
      "status 5xx deve mapear para BREVO_PROVIDER_ERROR.",
    );

    async function propagarCodigo(
      nome: string,
      senderResultado: Awaited<ReturnType<TestEmailSender>>,
      esperado: string,
    ) {
      const store = criarStore({
        userId: "user_1",
        productId: "prod_1",
        active: true,
        notifyEmail: true,
      });
      const captura: {
        emails: { toEmail: string }[];
        resultado: Awaited<ReturnType<TestEmailSender>>;
      } = { emails: [], resultado: senderResultado };

      const resultado = await sendTestEmailForUser(
        "user_1",
        "prod_1",
        store,
        async () => ({ status: "RESOLVIDO", email: "a@b.com" }) as const,
        criarSender(captura),
      );

      verificar(
        nome,
        resultado.ok === false &&
          "code" in resultado &&
          resultado.code === esperado,
        `esperava codigo ${esperado}; obteve ${JSON.stringify(resultado)}.`,
      );
    }

    await propagarCodigo(
      "TEST_EMAIL_DIAG_BREVO_400_PROPAGADO",
      { status: "EMAIL_FAILED", code: "BREVO_BAD_REQUEST" },
      "BREVO_BAD_REQUEST",
    );
    await propagarCodigo(
      "TEST_EMAIL_DIAG_BREVO_401_PROPAGADO",
      { status: "EMAIL_FAILED", code: "BREVO_AUTH_FAILED" },
      "BREVO_AUTH_FAILED",
    );
    await propagarCodigo(
      "TEST_EMAIL_DIAG_BREVO_403_PROPAGADO",
      { status: "EMAIL_FAILED", code: "BREVO_FORBIDDEN" },
      "BREVO_FORBIDDEN",
    );
    await propagarCodigo(
      "TEST_EMAIL_DIAG_BREVO_429_PROPAGADO",
      { status: "EMAIL_FAILED", code: "BREVO_RATE_LIMITED" },
      "BREVO_RATE_LIMITED",
    );
    await propagarCodigo(
      "TEST_EMAIL_DIAG_BREVO_500_PROPAGADO",
      { status: "EMAIL_FAILED", code: "BREVO_PROVIDER_ERROR" },
      "BREVO_PROVIDER_ERROR",
    );
  }

  /*
   * TEST_EMAIL_DIAG_NETWORK_ERROR
   *
   * Falha de rede no sender padrao (fetch lanca) vira
   * BREVO_NETWORK_ERROR, sem body do provider.
   */
  {
    const chaveAnterior = process.env.BREVO_API_KEY;
    const remetenteAnterior = process.env.BREVO_SENDER_EMAIL;

    process.env.BREVO_API_KEY = "chave-diagnostico-teste";
    process.env.BREVO_SENDER_EMAIL = "sender@exemplo.com";

    const fetchOriginal = globalThis.fetch;

    const fakeFetch: typeof fetch = async () => {
      throw new Error("network down (simulado)");
    };
    globalThis.fetch = fakeFetch;

    try {
      const resultado = await testEmailSenderPadrao({
        toEmail: "destino@exemplo.com",
        productId: "prod_1",
        productName: "Geladeira Teste",
        currentPrice: 2999.9,
        publicLink: "https://ofertano.vercel.app/produto/prod_1",
      });

      verificar(
        "TEST_EMAIL_DIAG_NETWORK_ERROR",
        resultado.status === "EMAIL_FAILED" &&
          resultado.code === "BREVO_NETWORK_ERROR",
        `fetch lancando deve virar BREVO_NETWORK_ERROR; obteve ${JSON.stringify(
          resultado,
        )}.`,
      );
    } finally {
      globalThis.fetch = fetchOriginal;

      if (chaveAnterior !== undefined) {
        process.env.BREVO_API_KEY = chaveAnterior;
      } else {
        delete process.env.BREVO_API_KEY;
      }
      if (remetenteAnterior !== undefined) {
        process.env.BREVO_SENDER_EMAIL = remetenteAnterior;
      } else {
        delete process.env.BREVO_SENDER_EMAIL;
      }
    }
  }

  /*
   * TEST_EMAIL_DIAG_NO_SECRET_LEAK
   *
   * Nenhum codigo sanitizado, log ou resposta HTTP pode conter email,
   * token, chave, sender ou body do provider.
   */
  {
    const fonteServico = lerArquivo(
      "src/services/priceAlerts/testEmail.ts",
    );
    const fonteRota = lerArquivo(
      "src/app/api/price-alerts/test-email/route.ts",
    );

    const vazamentosProibidosRota = [
      "process.env",
      "outcome.error",
      "resposta.json",
      "await resposta.text",
      "request.body",
    ];
    const vazamentosProibidosServico = [
      "process.env.SUPABASE_SERVICE_ROLE_KEY",
      "resposta.json",
      "await resposta.text",
    ];

    const vazouEstatico =
      vazamentosProibidosRota.some((f) => fonteRota.includes(f)) ||
      vazamentosProibidosServico.some((f) => fonteServico.includes(f));

    const chamadasConsole =
      (fonteServico.match(/console\.error\(/g) || []).length;

    verificar(
      "TEST_EMAIL_DIAG_NO_SECRET_LEAK_STATIC",
      !vazouEstatico && chamadasConsole === 1,
      "rota nao lê env/body bruto na resposta e servico so loga via logger sanitizado.",
    );

    verificar(
      "TEST_EMAIL_DIAG_NO_SECRET_LEAK_RESPONSE_SANITIZED",
      fonteRota.includes('{ ok: false, code: outcome.code }') === true,
      "a resposta de falha precisa ser apenas { ok: false, code } sanitizado.",
    );

    const store = criarStore({
      userId: "user_1",
      productId: "prod_1",
      active: true,
      notifyEmail: true,
    });

    const resultado = await sendTestEmailForUser(
      "user_1",
      "prod_1",
      store,
      async () => ({ status: "RESOLVIDO", email: "secreto@exemplo.com" }) as const,
      async () => ({
        status: "EMAIL_FAILED",
        code: "BREVO_FORBIDDEN",
      }) as const,
    );

    const seriado = JSON.stringify(resultado);

    verificar(
      "TEST_EMAIL_DIAG_NO_SECRET_LEAK_OUTCOME",
      seriado.includes("@") === false &&
        seriado.includes("secreto") === false &&
        seriado.includes("chave-diagnostico-teste") === false,
      "o outcome nao pode conter email nem segredos.",
    );

    const logsCapturados: unknown[] = [];
    const consoleOriginal = console.error;
    console.error = (...args: unknown[]) => {
      logsCapturados.push(args);
    };

    try {
      await sendTestEmailForUser(
        "user_1",
        "prod_1",
        store,
        async () => ({ status: "USUARIO_NAO_ENCONTRADO" }) as const,
        async () => ({ status: "EMAIL_SENT" }) as const,
      );
    } finally {
      console.error = consoleOriginal;
    }

    verificar(
      "TEST_EMAIL_DIAG_NO_SECRET_LEAK_LOG",
      logsCapturados.length > 0 &&
        logsCapturados.every(
          (entrada) =>
            Array.isArray(entrada) &&
            entrada.every(
              (v) => typeof v === "string" ? v.includes("@") === false : true,
            ),
        ),
      "logs devem existir por estagio e nunca conter email/segredo.",
    );
  }

  assert.ok(true, "runner completo.");
}

run();
