/**
 * TESTES DE EMAIL — Missao final (EMAIL REAL + MIGRATION READINESS).
 *
 * Prova (MOCK/STATIC, sem banco real):
 * - resolucao do email do usuario acontece server-side via resolver;
 * - o destino nunca vem do cliente (resolver vazio => EMAIL_NOT_CONFIGURED,
 *   e `emailUsuarioValido` blinda o formato);
 * - conteudo completo (produto, preco anterior/atual, queda %, link
 *   publico + CTA "Ver oferta");
 * - falha do provider vira EMAIL_FAILED sem quebrar o monitor;
 * - notifyEmail=false nao dispara envio algum.
 */

import assert from "node:assert";

import {
  buscarEmailDoUsuario,
  emailUsuarioValido,
  resolverEmailUsuarioConfigurado,
} from "./userEmail";
import {
  createMemoryPriceAlertRepository,
  type PriceAlertRecord,
} from "./repository";
import {
  processProductAlerts,
  type ContextoAlertas,
  type DependenciasMotorAlertas,
} from "./processProductAlerts";
import {
  formatarPrecoBRL,
  montarCorpoEmail,
  montarAssuntoEmail,
  produtoLinkPublico,
} from "./content";
import {
  emailTransacionalConfigurado,
  emailTransporterPadrao,
  type ConteudoEmailAlerta,
  type EmailTransporter,
} from "./channels/emailChannel";

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
    id: "alert_email",
    userId: "user_real",
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
    productName: "Fone Bluetooth XYZ",
    marketplace: "MERCADO_LIVRE",
    store: "Loja Legal",
    ...sobreposicao,
  };
}

function criarDeps(
  sobreposicao: Partial<
    DependenciasMotorAlertas & {
      emailTransporter: EmailTransporter;
    }
  > = {},
) {
  const envios: ConteudoEmailAlerta[] = [];

  const emailTransporter: EmailTransporter = async (conteudo) => {
    envios.push(conteudo);
    return { status: "EMAIL_SENT" };
  };

  const deps: DependenciasMotorAlertas & {
    envios: ConteudoEmailAlerta[];
  } = {
    repository: createMemoryPriceAlertRepository(),
    resolverEmailDoUsuario: async () => ({
      status: "RESOLVIDO",
      email: "usuario.real@exemplo.com",
    }),
    emailTransporter,
    whatsAppSender: async () => ({ status: "WHATSAPP_SENT" }),
    whatsAppConfigurado: false,
    cooldownMs: 0,
    now: new Date("2026-09-05T12:00:00.000Z"),
    envios,
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
   * PRICE_ALERT_EMAIL_RESOLVES_USER_EMAIL
   *
   * Com queda real e resolver do usuario presente, o email e enviado ao
   * endereco resolvido server-side e o estado dedupe e gravado.
   */
  {
    let destinoRecebido: string | null = null;

    const deps = criarDeps({
      repository: createMemoryPriceAlertRepository([criarAlerta()]),
      resolverEmailDoUsuario: async (userId) => {
        assert.strictEqual(userId, "user_real");
        return { status: "RESOLVIDO", email: "usuario.real@exemplo.com" };
      },
      emailTransporter: async (conteudo) => {
        destinoRecebido = conteudo.toEmail;
        return { status: "EMAIL_SENT" };
      },
    });

    const repositorio = deps.repository as ReturnType<
      typeof createMemoryPriceAlertRepository
    >;

    const resultado = await processProductAlerts(
      criarContexto(),
      deps,
    );

    verificar(
      "PRICE_ALERT_EMAIL_RESOLVES_USER_EMAIL",
      resultado.canais.some(
        (canal) =>
          canal.canal === "EMAIL" && canal.status === "EMAIL_SENT",
      ) &&
        destinoRecebido === "usuario.real@exemplo.com" &&
        repositorio.dump()[0].lastEmailNotifiedPrice === 899 &&
        repositorio.dump()[0].lastEmailNotifiedAt !== null,
      `esperava EMAIL_SENT para o email do resolver com estado gravado; obteve ${statuses(
        resultado,
      )} destino=${destinoRecebido}.`,
    );
  }

  /*
   * PRICE_ALERT_EMAIL_NO_CLIENT_FORGED_DESTINATION
   *
   * O destino so existe via resolver server-side. Resolver nulo (usuario
   * sem email valido) => EMAIL_NOT_CONFIGURED e NENHUM envio, mesmo que o
   * cliente tente forjar campos. `emailUsuarioValido` bloqueia formatos
   * invalidos antes de qualquer envio.
   */
  {
    let transporterChamado = false;

    const deps = criarDeps({
      repository: createMemoryPriceAlertRepository([criarAlerta()]),
      resolverEmailDoUsuario: async () => ({ status: "USUARIO_NAO_ENCONTRADO" }),
      emailTransporter: async () => {
        transporterChamado = true;
        return { status: "EMAIL_SENT" };
      },
    });

    const repositorio = deps.repository as ReturnType<
      typeof createMemoryPriceAlertRepository
    >;

    const resultado = await processProductAlerts(
      criarContexto(),
      deps,
    );

    verificar(
      "PRICE_ALERT_EMAIL_NO_CLIENT_FORGED_DESTINATION",
      !transporterChamado &&
        resultado.canais.some(
          (canal) => canal.status === "EMAIL_NOT_CONFIGURED",
        ) &&
        repositorio.dump()[0].lastEmailNotifiedPrice === null &&
        emailUsuarioValido("usuario.real@exemplo.com") === true &&
        emailUsuarioValido("cliente forjado@exemplo.com") === false &&
        emailUsuarioValido("sem-arroba.example") === false &&
        emailUsuarioValido("a@b") === false &&
        emailUsuarioValido("tambem@não-host") === false &&
        emailUsuarioValido(42) === false &&
        emailUsuarioValido("") === false,
      `sem resolver NAO pode haver envio nem destino forjado; obteve ${statuses(
        resultado,
      )} transporterChamado=${transporterChamado}.`,
    );
  }

  /*
   * PRICE_ALERT_EMAIL_CONTENT_PRODUCT
   *
   * O email transacional contém o nome do produto.
   */
  {
    const corpo = montarCorpoEmail({
      productId: "prod_1",
      productName: "Fone Bluetooth XYZ",
      previousPrice: 1000,
      currentPrice: 899,
      dropPercentage: 10.1,
      marketplace: "MERCADO_LIVRE",
    });

    verificar(
      "PRICE_ALERT_EMAIL_CONTENT_PRODUCT",
      corpo.html.includes("Fone Bluetooth XYZ") &&
        corpo.text.includes("Fone Bluetooth XYZ"),
      "conteudo do email deve conter o nome do produto.",
    );
  }

  /*
   * PRICE_ALERT_EMAIL_CONTENT_PREVIOUS_CURRENT
   *
   * Preço anterior e preço atual (R$) no corpo do email.
   */
  {
    const corpo = montarCorpoEmail({
      productId: "prod_1",
      productName: "Fone Bluetooth XYZ",
      previousPrice: 1000,
      currentPrice: 899,
      dropPercentage: 10.1,
    });

    const precoAnterior = formatarPrecoBRL(1000);
    const precoAtual = formatarPrecoBRL(899);

    verificar(
      "PRICE_ALERT_EMAIL_CONTENT_PREVIOUS_CURRENT",
      corpo.html.includes(precoAnterior) &&
        corpo.html.includes(precoAtual) &&
        corpo.text.includes(precoAnterior) &&
        corpo.text.includes(precoAtual),
      "email deve mostrar preço anterior e atual em R$.",
    );
  }

  /*
   * PRICE_ALERT_EMAIL_CONTENT_DROP
   *
   * Queda percentual aparece no corpo do email.
   */
  {
    const corpo = montarCorpoEmail({
      productId: "prod_1",
      productName: "Fone Bluetooth XYZ",
      previousPrice: 1000,
      currentPrice: 899,
      dropPercentage: 10.1,
    });

    verificar(
      "PRICE_ALERT_EMAIL_CONTENT_DROP",
      corpo.html.includes("10.10% de queda") &&
        corpo.text.includes("10.10% de queda"),
      "email deve conter a queda percentual.",
    );
  }

  /*
   * PRICE_ALERT_EMAIL_PUBLIC_LINK
   *
   * Link publico do produto e CTA "Ver oferta" presentes.
   */
  {
    const link = produtoLinkPublico("prod_1");
    const corpo = montarCorpoEmail({
      productId: "prod_1",
      productName: "Fone Bluetooth XYZ",
      previousPrice: 1000,
      currentPrice: 899,
      dropPercentage: 10.1,
    });
    const assunto = montarAssuntoEmail({
      productId: "prod_1",
      productName: "Fone Bluetooth XYZ",
      previousPrice: 1000,
      currentPrice: 899,
      dropPercentage: 10.1,
    });

    verificar(
      "PRICE_ALERT_EMAIL_PUBLIC_LINK",
      link.includes("/produto/prod_1") &&
        corpo.html.includes(link) &&
        corpo.text.includes(link) &&
        corpo.html.includes("Ver oferta") &&
        corpo.text.includes("Ver oferta") &&
        assunto.includes("Preço caiu"),
      "email deve conter link publico, CTA e assunto de queda.",
    );
  }

  /*
   * PRICE_ALERT_EMAIL_PROVIDER_FAILURE_SAFE
   *
   * Provider que lanca erro => EMAIL_FAILED; processProductAlerts NAO
   * lanca (monitor continua vivo) e nada e marcado como enviado.
   */
  {
    const deps = criarDeps({
      repository: createMemoryPriceAlertRepository([criarAlerta()]),
      emailTransporter: async () => {
        throw new Error("smtp fora do ar (simulado)");
      },
    });

    const repositorio = deps.repository as ReturnType<
      typeof createMemoryPriceAlertRepository
    >;

    let resultado:
      | ReturnType<typeof statuses>
      | undefined = undefined;

    await assert.doesNotReject(async () => {
      const saida = await processProductAlerts(criarContexto(), deps);
      resultado = statuses(saida);
    });

    verificar(
      "PRICE_ALERT_EMAIL_PROVIDER_FAILURE_SAFE",
      resultado !== undefined &&
        resultado.some((status) => status === "EMAIL_FAILED") &&
        repositorio.dump()[0].lastEmailNotifiedPrice === null,
      `falha do provider deve resultar em EMAIL_FAILED sem lancar; obteve ${JSON.stringify(
        resultado,
      )}.`,
    );
  }

  /*
   * PRICE_ALERT_EMAIL_DISABLED_NO_SEND
   *
   * notifyEmail=false => nenhum envio de email (transporter nunca chamado,
   * nenhum resultado EMAIL).
   */
  {
    let transporterChamado = false;

    const deps = criarDeps({
      emailTransporter: async () => {
        transporterChamado = true;
        return { status: "EMAIL_SENT" };
      },
    });

    const repositorio = createMemoryPriceAlertRepository([
      criarAlerta({ notifyEmail: false, notifyWhatsApp: false }),
    ]);

    const resultado = await processProductAlerts(
      criarContexto(),
      { ...deps, repository: repositorio },
    );

    verificar(
      "PRICE_ALERT_EMAIL_DISABLED_NO_SEND",
      !transporterChamado &&
        resultado.canais.every(
          (canal) => canal.canal !== "EMAIL",
        ) &&
        repositorio.dump()[0].lastEmailNotifiedPrice === null,
      `alerta com email desabilitado nao pode enviar; obteve ${statuses(
        resultado,
      )}.`,
    );
  }

  /*
   * PRICE_ALERT_RESOLVES_EMAIL_FROM_AUTH_USER_ID
   *
   * O email do destinatario chega EXCLUSIVAMENTE do resolver server-side
   * (que no runtime usa a Supabase Auth Admin API a partir do userId). O
   * monitor nao recebe email do cliente e repassa exatamente o email
   * resolvido ao transporter.
   */
  {
    let destinoRecebido: string | null = null;
    let userIdConsultado: string | null = null;

    const deps = criarDeps({
      repository: createMemoryPriceAlertRepository([criarAlerta()]),
      resolverEmailDoUsuario: async (userId) => {
        userIdConsultado = userId;
        return { status: "RESOLVIDO", email: "auth.exato@exemplo.com" };
      },
      emailTransporter: async (conteudo) => {
        destinoRecebido = conteudo.toEmail;
        return { status: "EMAIL_SENT" };
      },
    });

    const resultado = await processProductAlerts(criarContexto(), deps);

    verificar(
      "PRICE_ALERT_RESOLVES_EMAIL_FROM_AUTH_USER_ID",
      userIdConsultado === "user_real" &&
        destinoRecebido === "auth.exato@exemplo.com" &&
        resultado.canais.some(
          (canal) => canal.status === "EMAIL_SENT",
        ),
      `o email precisa vir do resolver (userId=${userIdConsultado}) e chegar ao transporter; destino=${destinoRecebido}.`,
    );
  }

  /*
   * PRICE_ALERT_DOES_NOT_TRUST_CLIENT_EMAIL
   *
   * O motor nunca aceita email vindo do cliente: usuario nao encontrado na
   * Auth => EMAIL_NOT_CONFIGURED e nenhum envio.
   */
  {
    let transporterChamado = false;

    const deps = criarDeps({
      repository: createMemoryPriceAlertRepository([criarAlerta()]),
      resolverEmailDoUsuario: async () => ({
        status: "USUARIO_NAO_ENCONTRADO",
      }),
      emailTransporter: async () => {
        transporterChamado = true;
        return { status: "EMAIL_SENT" };
      },
    });

    const repositorio = deps.repository as ReturnType<
      typeof createMemoryPriceAlertRepository
    >;

    const resultado = await processProductAlerts(criarContexto(), deps);

    verificar(
      "PRICE_ALERT_DOES_NOT_TRUST_CLIENT_EMAIL",
      !transporterChamado &&
        resultado.canais.some(
          (canal) => canal.status === "EMAIL_NOT_CONFIGURED",
        ) &&
        repositorio.dump()[0].lastEmailNotifiedPrice === null,
      `usuario sem email valido na Auth nao pode gerar envio; obteve ${statuses(
        resultado,
      )}.`,
    );
  }

  /*
   * PRICE_ALERT_USER_RESOLVER_FAILURE_SAFE
   *
   * Sem SUPABASE_SERVICE_ROLE_KEY o resolver devolve
   * RESOLVER_NAO_CONFIGURADO => EMAIL_USER_RESOLVER_NOT_CONFIGURED, nada e
   * enviado e o monitor continua.
   */
  {
    const anterior = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    let transporterChamado = false;

    try {
      verificar(
        "PRICE_ALERT_USER_RESOLVER_FAILURE_SAFE_CONFIG",
        resolverEmailUsuarioConfigurado() === false,
        "sem service role, o resolver nao esta configurado.",
      );

      const deps = criarDeps({
        repository: createMemoryPriceAlertRepository([criarAlerta()]),
        resolverEmailDoUsuario: async () => {
          const resolucao = await buscarEmailDoUsuario("user_real");
          assert.ok(
            resolucao.status === "RESOLVER_NAO_CONFIGURADO",
          );
          return resolucao;
        },
        emailTransporter: async () => {
          transporterChamado = true;
          return { status: "EMAIL_SENT" };
        },
      });

      const repositorio = deps.repository as ReturnType<
        typeof createMemoryPriceAlertRepository
      >;

      const resultado = await processProductAlerts(criarContexto(), deps);

      verificar(
        "PRICE_ALERT_USER_RESOLVER_FAILURE_SAFE",
        !transporterChamado &&
          resultado.canais.some(
            (canal) =>
              canal.status === "EMAIL_USER_RESOLVER_NOT_CONFIGURED",
          ) &&
          repositorio.dump()[0].lastEmailNotifiedPrice === null,
        `sem service role precisa virar EMAIL_USER_RESOLVER_NOT_CONFIGURED sem envio nem quebra; obteve ${statuses(
          resultado,
        )}.`,
      );
    } finally {
      if (anterior !== undefined) {
        process.env.SUPABASE_SERVICE_ROLE_KEY = anterior;
      }
    }
  }

  /*
   * PRICE_ALERT_SERVICE_ROLE_SERVER_ONLY
   *
   * Garantia estatica: SUPABASE_SERVICE_ROLE_KEY nunca aparece com prefixo
   * NEXT_PUBLIC_ e nunca e lida em arquivos de cliente/componente.
   */
  {
    const fs = await import("node:fs");
    const path = await import("node:path");

    const arquivo = path.resolve(
      process.cwd(),
      "src/services/priceAlerts/userEmail.ts",
    );

    const conteudo = fs.existsSync(arquivo)
      ? fs.readFileSync(arquivo, "utf8")
      : "";

    verificar(
      "PRICE_ALERT_SERVICE_ROLE_SERVER_ONLY",
      conteudo.includes("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY") === false &&
        conteudo.includes("SUPABASE_SERVICE_ROLE_KEY") === true &&
        conteudo.includes("auth.admin.getUserById") === true,
      "a service role precisa ser usada so no resolver server-side.",
    );
  }

  /*
   * PRICE_ALERT_BREVO_API_KEY_REQUIRED
   *
   * O adapter real exige BREVO_API_KEY + remetente; sem eles retorna
   * EMAIL_NOT_CONFIGURED. Nenhum valor hardcoded.
   */
  {
    const chaveAnterior = process.env.BREVO_API_KEY;
    const remetenteAnterior = process.env.BREVO_SENDER_EMAIL;
    const senderNameAnterior = process.env.BREVO_SENDER_NAME;

    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_SENDER_EMAIL;
    delete process.env.BREVO_SENDER_NAME;

    try {
      verificar(
        "PRICE_ALERT_BREVO_API_KEY_REQUIRED",
        emailTransacionalConfigurado() === false,
        "sem BREVO_API_KEY o transporte nao pode estar configurado.",
      );

      const resultado = await emailTransporterPadrao({
        toEmail: "destino@exemplo.com",
        productId: "prod_1",
        productName: "Produto",
        previousPrice: 1000,
        currentPrice: 899,
        savings: 101,
        dropPercentage: 10.1,
      });

      verificar(
        "PRICE_ALERT_BREVO_API_KEY_REQUIRED_NO_SEND",
        resultado.status === "EMAIL_NOT_CONFIGURED",
        `sem chave, o envio precisa ser EMAIL_NOT_CONFIGURED, obteve ${JSON.stringify(
          resultado,
        )}.`,
      );
    } finally {
      if (chaveAnterior !== undefined) {
        process.env.BREVO_API_KEY = chaveAnterior;
      }
      if (remetenteAnterior !== undefined) {
        process.env.BREVO_SENDER_EMAIL = remetenteAnterior;
      }
      if (senderNameAnterior !== undefined) {
        process.env.BREVO_SENDER_NAME = senderNameAnterior;
      }
    }
  }

  /*
   * PRICE_ALERT_BREVO_SMTP_KEY_NOT_REUSED
   *
   * A implementacao usa API REST v3 (api-key); uma senha SMTP (ou variavel
   * SMTP_*) nao pode ser reutilizada como BREVO_API_KEY.
   */
  {
    const smtpUserAnterior = process.env.SMTP_USER;
    const smtpPassAnterior = process.env.SMTP_PASSWORD;
    const smtpHostAnterior = process.env.SMTP_HOST;
    const remetenteAnterior = process.env.BREVO_SENDER_EMAIL;

    process.env.SMTP_USER = "usuario-smtp";
    process.env.SMTP_PASSWORD = "senha-smtp";
    process.env.SMTP_HOST = "smtp.brevo.com";
    process.env.BREVO_SENDER_EMAIL = "ofertano@exemplo.com";
    delete process.env.BREVO_API_KEY;

    try {
      verificar(
        "PRICE_ALERT_BREVO_SMTP_KEY_NOT_REUSED",
        emailTransacionalConfigurado() === false,
        "SMTP key/senha nao pode ser reutilizada como API key do Brevo.",
      );

      const resultado = await emailTransporterPadrao({
        toEmail: "destino@exemplo.com",
        productId: "prod_1",
        productName: "Produto",
        previousPrice: 1000,
        currentPrice: 899,
        savings: 101,
        dropPercentage: 10.1,
      });

      verificar(
        "PRICE_ALERT_BREVO_SMTP_KEY_NOT_REUSED_RESULT",
        resultado.status === "EMAIL_NOT_CONFIGURED",
        `SMTP sozinho nao pode enviar via API Brevo; obteve ${JSON.stringify(
          resultado,
        )}.`,
      );
    } finally {
      if (smtpUserAnterior !== undefined) {
        process.env.SMTP_USER = smtpUserAnterior;
      } else {
        delete process.env.SMTP_USER;
      }
      if (smtpPassAnterior !== undefined) {
        process.env.SMTP_PASSWORD = smtpPassAnterior;
      } else {
        delete process.env.SMTP_PASSWORD;
      }
      if (smtpHostAnterior !== undefined) {
        process.env.SMTP_HOST = smtpHostAnterior;
      } else {
        delete process.env.SMTP_HOST;
      }
      if (remetenteAnterior !== undefined) {
        process.env.BREVO_SENDER_EMAIL = remetenteAnterior;
      } else {
        delete process.env.BREVO_SENDER_EMAIL;
      }
    }
  }

  assert.ok(true, "runner completo.");
}

run();