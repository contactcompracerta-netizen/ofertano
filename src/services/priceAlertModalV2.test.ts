import fs from "node:fs";
import path from "node:path";

function ler(relativo: string) {
  return fs.readFileSync(
    path.join(process.cwd(), relativo),
    "utf8",
  );
}

function verificar(nome: string, ok: boolean, detalhe: string) {
  if (!ok) {
    console.error(`${nome}=FAIL ${detalhe}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${nome}=PASS`);
}

async function run() {
  const alerta = ler(
    "src/components/PriceAlertButton.tsx",
  );
  const produto = ler(
    "src/app/produto/[id]/page.tsx",
  );

  // PRICE_ALERT_OVERLAY_FIXED_FULL_VIEWPORT
  verificar(
    "PRICE_ALERT_OVERLAY_FIXED_FULL_VIEWPORT",
    /fixed inset-0 z-\[120\]/.test(alerta) ||
      /fixed inset-0 z-\[\d+\]/.test(alerta),
    "overlay precisa ser fixed inset-0 com z-index explícito.",
  );

  // PRICE_ALERT_DESKTOP_IS_CENTERED_DIALOG
  verificar(
    "PRICE_ALERT_DESKTOP_IS_CENTERED_DIALOG",
    /sm:items-center/.test(alerta) &&
      /sm:justify-center/.test(alerta),
    "desktop precisa centralizar o dialog (sm:items-center + sm:justify-center).",
  );

  // PRICE_ALERT_MOBILE_IS_BOTTOM_SHEET
  verificar(
    "PRICE_ALERT_MOBILE_IS_BOTTOM_SHEET",
    /items-end justify-center/.test(alerta) &&
      /rounded-t-3xl/.test(alerta) &&
      /sm:rounded-2xl/.test(alerta),
    "mobile precisa ser bottom sheet (items-end + rounded-t).",
  );

  // PRICE_ALERT_DIALOG_HAS_SAFE_MAX_WIDTH
  verificar(
    "PRICE_ALERT_DIALOG_HAS_SAFE_MAX_WIDTH",
    /sm:max-w-\[480px\]/.test(alerta),
    "desktop precisa ter largura confortável (~440-520px).",
  );

  // PRICE_ALERT_DIALOG_MAX_HEIGHT_DVH
  verificar(
    "PRICE_ALERT_DIALOG_MAX_HEIGHT_DVH",
    /max-h-\[100dvh\]/.test(alerta) &&
      /sm:max-h-\[calc\(100dvh-2rem\)\]/.test(alerta),
    "altura precisa ser limitada por 100dvh.",
  );

  // PRICE_ALERT_BODY_SCROLLABLE
  verificar(
    "PRICE_ALERT_BODY_SCROLLABLE",
    /min-h-0 min-w-0 w-full flex-1 overflow-y-auto/.test(
      alerta,
    ),
    "corpo precisa ser flex-1 com min-h-0 e overflow-y-auto.",
  );

  // PRICE_ALERT_BODY_MIN_WIDTH_ZERO
  verificar(
    "PRICE_ALERT_BODY_MIN_WIDTH_ZERO",
    /min-w-0 w-full flex-1 overflow-y-auto/.test(
      alerta,
    ) &&
      /w-full min-w-0 max-w-full flex-col overflow-hidden/.test(
        alerta,
      ) &&
      /flex shrink-0 items-start justify-between gap-3 px-4 pt-2 sm:pt-4/.test(
        alerta,
      ),
    "corpo/cabeçalho/dialog precisam ter min-w-0.",
  );

  // PRICE_ALERT_UNAUTH_CTA_FULL_WIDTH
  verificar(
    "PRICE_ALERT_UNAUTH_CTA_FULL_WIDTH",
    /onClick=\{abrirLogin\}\s+className="mt-3 flex min-h-11 w-full max-w-full items-center justify-center rounded-xl bg-emerald-600/.test(
      alerta,
    ),
    "CTA de login precisa ocupar a largura total (w-full max-w-full).",
  );

  // PRICE_ALERT_FORM_CONTROLS_FULL_WIDTH
  verificar(
    "PRICE_ALERT_FORM_CONTROLS_FULL_WIDTH",
    /mt-4 flex min-h-11 w-full max-w-full items-center justify-center gap-2 rounded-xl bg-emerald-600/.test(
      alerta,
    ) &&
      /flex h-11 w-full max-w-full items-center rounded-xl border/.test(
        alerta,
      ) &&
      /min-w-0 flex-1 bg-transparent/.test(alerta) &&
      /w-full max-w-full rounded-2xl border p-3/.test(
        alerta,
      ),
    "inputs/seletores/botões do formulário precisam respeitar a largura do dialog.",
  );

  // PRICE_ALERT_NO_DESKTOP_ABSOLUTE_DROPDOWN
  verificar(
    "PRICE_ALERT_NO_DESKTOP_ABSOLUTE_DROPDOWN",
    !/sm:absolute/.test(alerta) &&
      !/sm:right-0/.test(alerta) &&
      !/sm:top-12/.test(alerta) &&
      !/sm:inset-auto/.test(alerta) &&
      !/sm:block/.test(alerta) &&
      !/sm:w-\[360px\]/.test(alerta) &&
      !/sm:max-h-none/.test(alerta) &&
      !/sm:max-h-\[75vh\]/.test(alerta),
    "não pode existir dropdown absoluto preso ao botão no desktop.",
  );

  // PRICE_ALERT_ABOVE_PURCHASE_BAR
  const overlay = alerta.match(/fixed inset-0 z-\[(\d+)\]/);
  const barraCompra = produto.match(
    /fixed inset-x-0 bottom-0 z-\[(\d+)\]/,
  );
  const aboveBar =
    overlay !== null &&
    barraCompra !== null &&
    Number(overlay[1]) > Number(barraCompra[1]);
  verificar(
    "PRICE_ALERT_ABOVE_PURCHASE_BAR",
    aboveBar,
    `z-overlay=${overlay?.[1] ?? "ausente"} precisa ser maior que z-barraCompra=${barraCompra?.[1] ?? "ausente"}.`,
  );

  // PRICE_ALERT_SAFE_AREA
  verificar(
    "PRICE_ALERT_SAFE_AREA",
    /env\(safe-area-inset-bottom\)/.test(alerta),
    "safe-area inferior precisa ser respeitada.",
  );

  // PRICE_ALERT_PORTAL_TO_BODY
  verificar(
    "PRICE_ALERT_PORTAL_TO_BODY",
    /createPortal/.test(alerta) &&
      /document\.body/.test(alerta) &&
      /aberto &&\s+typeof document !== "undefined" &&\s+createPortal/.test(
        alerta,
      ),
    "modal precisa renderizar via portal em document.body apenas no cliente.",
  );

  if (process.exitCode === 1) {
    throw new Error(
      "Falhas de regressão do modal de alerta.",
    );
  }

  console.log("PRICE_ALERT_MODAL_V2=PASS");
}

void run().catch((error) => {
  console.error(error);
  process.exit(1);
});