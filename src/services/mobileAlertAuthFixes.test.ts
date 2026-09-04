import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { siteOrigin, siteUrl } from "../lib/siteUrl";

function ler(relativo: string) {
  return fs.readFileSync(
    path.join(process.cwd(), relativo),
    "utf8",
  );
}

function zFixedOverlay(fonte: string) {
  const correspondencia =
    fonte.match(/fixed inset-0 z-\[(\d+)\]/);

  assert.ok(
    correspondencia,
    "Overlay do alerta precisa ser fixed e ter z-index explícito.",
  );

  return Number(correspondencia[1]);
}

function zBarraCompra(fonte: string) {
  const correspondencia = fonte.match(
    /fixed inset-x-0 bottom-0 z-\[(\d+)\]/,
  );

  assert.ok(
    correspondencia,
    "Barra de compra mobile precisa ser fixed com z-index explícito.",
  );

  return Number(correspondencia[1]);
}

async function run() {
  const alerta = ler("src/components/PriceAlertButton.tsx");
  const produto = ler("src/app/produto/[id]/page.tsx");
  const login = ler("src/app/login/page.tsx");
  const recuperacao = ler(
    "src/app/recuperar-senha/page.tsx",
  );

  // ALERT_MODAL_ABOVE_PURCHASE_BAR — overlay acima da barra de compra
  assert.ok(
    zFixedOverlay(alerta) > zBarraCompra(produto),
    "O overlay do alerta de preço precisa ficar ABOVE da barra de compra mobile.",
  );

  // ALERT_MODAL_CONTENT_SCROLLABLE — conteúdo com scroll interno
  assert.match(alerta, /overflow-y-auto/);
  assert.match(
    alerta,
    /min-h-0 flex-1 overflow-y-auto/,
    "Conteúdo do modal precisa ser flex-1 com min-h-0 e scroll interno.",
  );

  // ALERT_MODAL_NO_BOTTOM_CLIPPING — altura limitada à viewport dinâmica
  assert.match(
    alerta,
    /max-h-\[100dvh\]/,
    "Modal precisa limitar a altura a 100dvh.",
  );
  assert.match(
    alerta,
    /flex max-h-\[100dvh\] w-full max-w-none flex-col overflow-hidden/,
    "Modal precisa ser flex-col com overflow-hidden dentro da altura da viewport.",
  );

  // ALERT_MODAL_CLOSE_ACCESSIBLE — botão fechar sempre visível
  assert.match(alerta, /aria-label="Fechar alerta"/);
  assert.match(alerta, /setAberto\(false\)/);

  // ALERT_MODAL_MOBILE_SAFE_AREA — safe-area inferior respeitada
  assert.match(
    alerta,
    /env\(safe-area-inset-bottom\)/,
    "Modal precisa respeitar env(safe-area-inset-bottom).",
  );

  // ALERT_MODAL_DESKTOP_REGRESSION — dropdown desktop preservado
  for (const token of [
    "sm:block",
    "sm:max-h-none",
    "sm:w-[360px]",
    "sm:rounded-2xl",
    "sm:max-h-[75vh]",
    "sm:pb-4",
  ]) {
    assert.match(
      alerta,
      new RegExp(
        token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ),
      `Desktop: ${token} precisa permanecer no alerta.`,
    );
  }

  // Scroll do fundo bloqueado enquanto o modal está aberto
  assert.match(
    alerta,
    /document\.body\.style\.overflow = "hidden"/,
  );

  // RESET_EMAIL_USES_PRODUCTION_ORIGIN / RESET_DOES_NOT_HARDCODE_LOCALHOST
  assert.doesNotMatch(login, /localhost/);
  assert.match(login, /siteUrl\("\/(recuperar-senha|favoritos)"\)/);
  assert.match(
    login,
    /siteUrl\("\/recuperar-senha"\)/,
    "Recuperação de senha precisa apontar para a rota /recuperar-senha via siteUrl.",
  );

  // RECOVERY_ROUTE_ACCEPTS_VALID_SESSION
  assert.match(recuperacao, /PASSWORD_RECOVERY/);
  assert.match(recuperacao, /supabase\.auth\.getSession/);
  assert.match(recuperacao, /window\.history\.replaceState/);

  // RECOVERY_FORM_UPDATES_PASSWORD
  assert.match(recuperacao, /updateUser/);
  assert.match(recuperacao, /password: senha/);

  // RECOVERY_WITHOUT_SESSION_IS_SAFE
  assert.match(recuperacao, /recoveryConfirmada/);
  assert.match(recuperacao, /invalida/);
  assert.match(recuperacao, /href="\/login"/);
  assert.doesNotMatch(
    recuperacao,
    /console\.log/,
    "Não logar token/code da recuperação.",
  );

  // LOCAL_DEV_REDIRECT_STILL_SUPPORTED + origem central
  const envAnterior = process.env.NEXT_PUBLIC_SITE_URL;

  try {
    delete process.env.NEXT_PUBLIC_SITE_URL;

    assert.equal(
      siteOrigin(),
      "https://ofertano.vercel.app",
      "Sem env, a origem padrão de produção deve ser ofertano.vercel.app.",
    );
    assert.equal(
      siteUrl("/recuperar-senha"),
      "https://ofertano.vercel.app/recuperar-senha",
    );
    assert.equal(
      siteUrl("recuperar-senha"),
      "https://ofertano.vercel.app/recuperar-senha",
      "Caminho sem barra inicial também precisa funcionar.",
    );
    assert.equal(
      siteUrl("https://outro.site/x"),
      "https://outro.site/x",
      "URL absoluta deve ser preservada.",
    );

    process.env.NEXT_PUBLIC_SITE_URL =
      "https://loja.exemplo.com/";

    assert.equal(
      siteOrigin(),
      "https://loja.exemplo.com",
      "NEXT_PUBLIC_SITE_URL deve ter prioridade no servidor.",
    );

    (globalThis as Record<string, unknown>).window = {
      location: { origin: "http://localhost:3000" },
    } as unknown as Window & typeof globalThis;

    assert.equal(
      siteOrigin(),
      "http://localhost:3000",
      "No cliente, a origem real deve manter localhost no dev.",
    );
  } finally {
    delete (globalThis as Record<string, unknown>).window;

    if (envAnterior === undefined) {
      delete process.env.NEXT_PUBLIC_SITE_URL;
    } else {
      process.env.NEXT_PUBLIC_SITE_URL = envAnterior;
    }
  }

  console.log("mobileAlertAuthFixes.test.ts ok");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});