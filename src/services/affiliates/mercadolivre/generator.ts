type PlaywrightModule = {
  chromium: {
    connectOverCDP(
      endpoint: string,
    ): Promise<{
      contexts(): unknown[];
      newContext(): Promise<unknown>;
      close(): Promise<void>;
    }>;
  };
};

export type GenerateOutcome =
  | {
      status: "SUCCESS";
      affiliateUrl: string;
      sourceItemId: string | null;
      validated: true;
    }
  | {
      status: "CHROME_NOT_RUNNING";
      reason: string;
    }
  | {
      status: "AUTH_REQUIRED";
      reason: string;
    }
  | {
      status: "GENERATION_FAILED";
      reason: string;
    }
  | {
      status: "VALIDATION_FAILED";
      reason: string;
    };

export type MercadoLivreAffiliateInput = {
  sourceUrl: string;
  expectedItemId?: string | null;
  cdpEndpoint?: string;
  generatorUrl?: string;
  log?: (msg: string) => void;
  timeoutMs?: number;
};

const DEFAULT_CDP_ENDPOINT = "http://127.0.0.1:9222";
const DEFAULT_GENERATOR_URL =
  "https://www.mercadolivre.com.br/afiliados/linkbuilder";

const AUTH_REQUIRED_MARKERS = [
  "/jms/mlb/lgz/login",
  "/jms/mlb",
  "/login",
  "loginType=",
  "/registration",
  "/seguridad",
  "/security",
];

const AUTH_CHALLENGE_MARKERS = [
  "captcha",
  "não é um robô",
  "desafio",
  "verify",
  "confirme que",
  "security check",
];

const NAV_ERROR_MARKERS = [
  "Execution context was destroyed",
  "execution context was destroyed",
  "Navigation failed",
  "Target page, context or browser has been closed",
];

const STABILIZE_POLL_MS = 3000;

export function extractItemId(url: string): string | null {
  const clean = url.split("?")[0].split("#")[0];
  const m = clean.match(/(MLB[-_]?\d{5,})/i);
  return m ? m[1].toUpperCase().replace(/_/g, "-") : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientNavError(err: unknown): boolean {
  const msg = (err as Error)?.message || "";
  return NAV_ERROR_MARKERS.some((m) => msg.includes(m));
}

function urlNeedsAuth(url: string): boolean {
  return AUTH_REQUIRED_MARKERS.some((m) => url.includes(m));
}

async function waitForPageStable(
  page: import("playwright").Page,
  stabilityMs = 4000,
  timeoutMs = 60000,
): Promise<boolean> {
  const start = Date.now();
  let navigationStartedAt: number | null = Date.now();

  const onNavigated = () => {
    navigationStartedAt = Date.now();
  };

  page.on("framenavigated", onNavigated);

  try {
    while (Date.now() - start < timeoutMs) {
      if (page.isClosed()) return false;
      await page
        .waitForLoadState("domcontentloaded", { timeout: 3000 })
        .catch(() => {});
      if (page.isClosed()) return false;

      const now = Date.now();
      const settled =
        navigationStartedAt !== null && now - navigationStartedAt >= stabilityMs;
      if (settled) {
        if (now - navigationStartedAt >= stabilityMs * 2) return true;
        await sleep(stabilityMs);
      } else {
        await sleep(STABILIZE_POLL_MS);
      }
    }
  } finally {
    page.off("framenavigated", onNavigated);
  }

  return false;
}

async function safeEval<T>(
  page: import("playwright").Page,
  fn: () => Promise<T>,
  retries = 3,
): Promise<T | undefined> {
  for (let i = 0; i < retries; i++) {
    if (page.isClosed()) return undefined;
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
      if (page.isClosed()) return undefined;
      return await fn();
    } catch (err) {
      if (isTransientNavError(err) && i < retries - 1) {
        await sleep(1500);
        continue;
      }
      throw err;
    }
  }
  return undefined;
}

async function isAuthChallengePageSafe(
  page: import("playwright").Page,
): Promise<boolean> {
  const text =
    (await safeEval(page, () =>
      page.evaluate(() => document.body?.innerText || ""),
    )) || "";
  return AUTH_CHALLENGE_MARKERS.some((m) => text.toLowerCase().includes(m));
}

async function requireAuth(
  page: import("playwright").Page,
): Promise<"required" | "none" | "unknown"> {
  if (page.isClosed()) return "unknown";
  const url = page.url();
  if (urlNeedsAuth(url)) return "required";
  const challenge = await isAuthChallengePageSafe(page);
  if (challenge) return "required";
  return "none";
}

interface CaptureCandidate {
  url: string;
  source: "anchor" | "input" | "textarea" | "text" | "generated-container";
}

async function collectCaptureCandidates(
  page: import("playwright").Page,
): Promise<CaptureCandidate[]> {
  const candidates: CaptureCandidate[] = [];

  try {
    const anchors = await safeEval(page, () =>
      page
        .locator('a[href*="meli.la"]')
        .evaluateAll((els) =>
          els
            .map((e) => e.getAttribute("href") || "")
            .filter((h) => h.length > 0 && h.includes("meli.la")),
        ),
    );
    for (const u of anchors || []) candidates.push({ url: u, source: "anchor" });
  } catch (err) {
    if (!isTransientNavError(err)) throw err;
  }

  try {
    const inputs = await safeEval(page, () =>
      page
        .locator("input, textarea")
        .evaluateAll((els) =>
          els
            .map((e) => ({
              v: (e as HTMLInputElement).value || "",
              readonly: (e as HTMLInputElement).readOnly,
            }))
            .filter((o) => o.v.includes("meli.la")),
        ),
    );
    for (const o of inputs || []) {
      candidates.push({ url: o.v, source: o.readonly ? "input" : "textarea" });
    }
  } catch (err) {
    if (!isTransientNavError(err)) throw err;
  }

  try {
    const texts = await safeEval(page, () =>
      page
        .locator("span, p, code, pre, div")
        .evaluateAll((els) =>
          els
            .map((e) => (e as HTMLElement).innerText || "")
            .filter((t) => t && t.includes("https://") && t.includes("meli.la")),
        ),
    );
    const seen = new Set<string>();
    for (const t of texts || []) {
      for (const m of t.match(/https?:\/\/meli\.la\/[\w.\-/]+/g) || []) {
        const key = m.replace(/[.\-|]$/, "");
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ url: key, source: "text" });
      }
    }
  } catch (err) {
    if (!isTransientNavError(err)) throw err;
  }

  try {
    const containerLinks = await safeEval(page, () =>
      page.evaluate(() => {
        const out: string[] = [];
        const labels = /copiar|link gerado|gerar link gerado|clique para copiar/i;
        const roots = [...document.querySelectorAll("button, a")].filter((el) =>
          labels.test((el as HTMLElement).innerText || ""),
        );
        for (const root of roots) {
          let node: HTMLElement | null = root as HTMLElement;
          for (let up = 0; up < 6 && node; up++) {
            node = node.parentElement;
            if (!node) break;
            const str = node.innerText || "";
            const textM = str.match(/https?:\/\/meli\.la\/[\w.\-/]+/);
            if (textM) {
              out.push(textM[0]);
              break;
            }
            const input = node.querySelector("input, textarea") as HTMLInputElement | null;
            const iv = input?.value || "";
            const ivM = iv.match(/https?:\/\/meli\.la\/[\w.\-/]+/);
            if (ivM) {
              out.push(ivM[0]);
              break;
            }
          }
        }
        return out;
      }),
    );
    for (const u of containerLinks || []) {
      candidates.push({ url: u, source: "generated-container" });
    }
  } catch (err) {
    if (!isTransientNavError(err)) throw err;
  }

  return candidates;
}

function uniqueMeliLa(items: string[]): string[] {
  const out = new Set<string>();
  for (const it of items) {
    for (const m of it.match(/https?:\/\/meli\.la\/[\w.\-/]+(?:\.|\|\d*)?/g) || []) {
      out.add(m.replace(/[.\-|]$/, ""));
    }
  }
  return [...out];
}

async function diagnoseCapture(
  page: import("playwright").Page,
  log: (msg: string) => void,
): Promise<{ capturedUrl: string | null; isNew: boolean }> {
  const before = await collectCaptureCandidates(page);
  const beforeUrls = new Set(uniqueMeliLa(before.map((c) => c.url)));
  log(`CAPTURE_CANDIDATES_BEFORE=${beforeUrls.size}`);

  await sleep(2500);
  const after = await collectCaptureCandidates(page);
  const afterUrls = new Set(uniqueMeliLa(after.map((c) => c.url)));
  log(`CAPTURE_CANDIDATES_AFTER=${afterUrls.size}`);

  const newCandidates = [...afterUrls].filter((u) => !beforeUrls.has(u));
  log(`CAPTURE_NEW_CANDIDATES=${newCandidates.length}`);

  const sourceRank: Record<string, number> = {
    "generated-container": 1,
    input: 2,
    textarea: 2,
    text: 3,
    anchor: 4,
  };

  const byUrl = new Map<string, { rank: number; isNew: boolean }>();
  const register = (u: string, src: string) => {
    const rank = sourceRank[src] ?? 99;
    const isNew = newCandidates.includes(u);
    const cur = byUrl.get(u);
    if (!cur || rank < cur.rank) {
      byUrl.set(u, { rank, isNew });
    }
  };
  for (const cand of after) {
    for (const u of uniqueMeliLa([cand.url])) {
      register(u, cand.source);
    }
  }
  for (const u of newCandidates) {
    if (!byUrl.has(u)) register(u, "text");
  }

  const ranked = [...byUrl.entries()].sort((a, b) => {
    if (a[1].isNew !== b[1].isNew) return a[1].isNew ? -1 : 1;
    if (a[1].rank !== b[1].rank) return a[1].rank - b[1].rank;
    return a[0].localeCompare(b[0]);
  });

  const best = ranked[0];
  return {
    capturedUrl: best?.[0] ?? null,
    isNew: best?.[1].isNew ?? false,
  };
}

async function findExpectedMlb(
  page: import("playwright").Page,
  expectedItem: string,
): Promise<boolean> {
  const needle = expectedItem;
  const foundIn = async (urls: string[], text?: string[]): Promise<boolean> => {
    for (const u of urls) {
      if (u && u.includes(needle)) return true;
    }
    for (const t of text || []) {
      if (t && t.includes(needle)) return true;
    }
    return false;
  };

  if (await foundIn([page.url()])) return true;

  const canonical = await safeEval(
    page,
    () =>
      Promise.all([
        page.locator('link[rel="canonical"]').getAttribute("href").catch(() => null),
        page
          .locator('a[href*="/p/MLB"], a[href*="produto.mercadolivre.com.br/MLB"]')
          .evaluateAll((els) => els.map((e) => e.getAttribute("href") || "").slice(0, 20)),
        page
          .locator('a[href*="/p/"], a[href*="produto.mercadolivre"]')
          .evaluateAll((els) => els.map((e) => e.getAttribute("href") || "").slice(0, 20)),
      ]).then(([can, prodLinks, prodLinks2]) => ({ can, prodLinks, prodLinks2 })),
  );
  if (canonical) {
    const { can, prodLinks, prodLinks2 } = canonical;
    if (await foundIn([...(can ? [can] : []), ...(prodLinks || []), ...(prodLinks2 || [])]))
      return true;
  }

  const ld = await safeEval(
    page,
    () =>
      page
        .locator('script[type="application/ld+json"]')
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).textContent || "")),
  );
  if (ld) {
    const joined = ld.join("\n");
    if (joined.includes(needle)) return true;
    const urlFromLd = joined.match(/https?:\/\/[^"\\ ]*MLB\d{5,}/i);
    if (urlFromLd && urlFromLd[0].includes(needle)) return true;
  }

  const bodies = await safeEval(
    page,
    () =>
      page
        .locator("body")
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText || "")),
  );
  if (bodies && (await foundIn([], bodies))) return true;

  return false;
}

async function diagnoseValidationInNewPage(
  context: import("playwright").BrowserContext,
  affiliateUrl: string,
  expectedItem: string,
  log: (msg: string) => void,
): Promise<boolean> {
  const page = await context.newPage();
  const hops: string[] = [];

  const recordHop = (url: string) => {
    const clean = url.split("#")[0];
    if (clean && !hops.includes(clean)) {
      hops.push(clean);
      log(`VALIDATION_HOP_${hops.length} (não sensível)`);
    }
  };

  page.on("framenavigated", () => {
    try {
      recordHop(page.url());
    } catch {
      /* ignora */
    }
  });

  let found = false;
  const end = Date.now() + 15000;
  let last = "";
  try {
    await page
      .goto(affiliateUrl, { waitUntil: "domcontentloaded", timeout: 30000 })
      .catch(() => {});
    recordHop(page.url());
    last = page.url();

    while (Date.now() < end && !page.isClosed()) {
      await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
      const cur = page.url();
      if (cur && cur !== last) {
        recordHop(cur);
        last = cur;
      }
      if (await findExpectedMlb(page, expectedItem)) {
        found = true;
        break;
      }
      await sleep(1200);
    }
  } finally {
    await page.close().catch(() => {});
  }

  return found;
}

async function waitForUrlField(
  page: import("playwright").Page,
): Promise<import("playwright").Locator | null> {
  const selectors: Array<() => Promise<import("playwright").Locator | null>> = [
    async () => page.getByRole("textbox", { name: /insira.*url|url.*produto|link.*produto/i }).first(),
    async () => page.getByPlaceholder(/insira.*url|url.*produto|cole.*link/i).first(),
    async () => page.getByLabel(/insira.*url|url.*produto|link.*produto/i).first(),
    async () =>
      page
        .locator('textarea, input[type="text"], input[type="url"]')
        .filter({ hasText: /url|link/i })
        .first(),
    async () => page.locator("textarea").first(),
  ];
  for (const sel of selectors) {
    try {
      const loc = await sel();
      if (loc && (await loc.count()) > 0 && (await loc.isVisible())) {
        return loc;
      }
    } catch (err) {
      if (!isTransientNavError(err)) throw err;
    }
  }
  return null;
}

async function waitForGenerateButton(
  page: import("playwright").Page,
): Promise<import("playwright").Locator | null> {
  const selectors: Array<() => Promise<import("playwright").Locator | null>> = [
    async () => page.getByRole("button", { name: /gerar( link)?/i }).first(),
    async () => page.getByRole("button", { name: /generar/i }).first(),
    async () => page.getByRole("button", { name: /gerar/i }).last(),
  ];
  for (const sel of selectors) {
    try {
      const loc = await sel();
      if (loc && (await loc.count()) > 0 && (await loc.isVisible())) {
        return loc;
      }
    } catch (err) {
      if (!isTransientNavError(err)) throw err;
    }
  }
  return null;
}

export async function generateMercadoLivreAffiliateLink(
  input: MercadoLivreAffiliateInput,
): Promise<GenerateOutcome> {
  const log = input.log ?? (() => {});
  const sourceUrl = input.sourceUrl.trim();
  const cdpEndpoint = input.cdpEndpoint?.trim() || DEFAULT_CDP_ENDPOINT;
  const generatorUrl = input.generatorUrl?.trim() || DEFAULT_GENERATOR_URL;
  const expectedItemId =
    input.expectedItemId?.trim() || extractItemId(sourceUrl);

  if (!expectedItemId) {
    return {
      status: "GENERATION_FAILED",
      reason: `Não foi possível extrair MLB da URL fornecida: ${sourceUrl}`,
    };
  }

  let browser: import("playwright").Browser | undefined;
  let context: import("playwright").BrowserContext | undefined;

  try {
    let connected = false;
    let connectErr: unknown;
    try {
      const pw = (await import("playwright")) as PlaywrightModule;
      browser = (await pw.chromium.connectOverCDP(
        cdpEndpoint,
      )) as import("playwright").Browser;
      connected = true;
    } catch (err) {
      connectErr = err;
    }

    if (!connected || !browser) {
      log(`[cdp] falha de conexão: ${(connectErr as Error)?.message || "desconhecido"}`);
      return {
        status: "CHROME_NOT_RUNNING",
        reason:
          "Chrome real não está acessível via CDP em " + cdpEndpoint + ". " +
          "Abra o Google Chrome de afiliados e tente novamente.",
      };
    }

    const contexts = browser.contexts();
    context = contexts.length > 0 ? contexts[0] : await browser.newContext();

    let page = context.pages().find((p) => !p.isClosed());
    if (!page) {
      page = await context.newPage();
    }

    await page
      .goto(generatorUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
      .catch(() => {});

    await waitForPageStable(page, 4000, 60000);

    const authState = await requireAuth(page);
    log(`AUTH_STATE=${authState === "required" ? "REQUIRED" : "NONE"}`);
    if (authState === "required") {
      return {
        status: "AUTH_REQUIRED",
        reason: "Abra o Chrome de afiliados e autentique manualmente.",
      };
    }

    if (!page.url().includes("afiliados/linkbuilder")) {
      await page
        .goto(generatorUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
        .catch(() => {});
      await waitForPageStable(page, 4000, 60000);
      const reAuth = await requireAuth(page);
      if (reAuth === "required") {
        return {
          status: "AUTH_REQUIRED",
          reason: "Abra o Chrome de afiliados e autentique manualmente.",
        };
      }
    }
    await waitForPageStable(page, 4000, 60000);
    log("GENERATOR_STATE=READY");

    const field = await waitForUrlField(page);
    if (!field) {
      return { status: "GENERATION_FAILED", reason: "Campo de URL não localizado no gerador" };
    }
    await field.click();
    await field.fill(sourceUrl);
    log("[input] URL inserida no campo.");

    const btn = await waitForGenerateButton(page);
    if (!btn) {
      return { status: "GENERATION_FAILED", reason: "Botão de gerar link não localizado" };
    }
    await btn.click();
    log("[generate] gerou.");

    const diag = await diagnoseCapture(page, log);

    if (!diag.capturedUrl) {
      return { status: "GENERATION_FAILED", reason: "Nenhum link meli.la capturado após gerar" };
    }

    const affiliateUrl = diag.capturedUrl;
    const validated = await diagnoseValidationInNewPage(
      context,
      affiliateUrl,
      expectedItemId,
      log,
    );

    if (validated) {
      return {
        status: "SUCCESS",
        affiliateUrl,
        sourceItemId: expectedItemId,
        validated: true,
      };
    }

    if (!diag.isNew) {
      return {
        status: "VALIDATION_FAILED",
        reason: `Link afiliado não corresponde ao anúncio esperado. Esperado ${expectedItemId}. O link capturado já existia na página antes de Gerar.`,
      };
    }

    return {
      status: "VALIDATION_FAILED",
      reason: `Link afiliado foi gerado mas não confirmado. Esperado ${expectedItemId}.`,
    };
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    if (isTransientNavError(err)) {
      return {
        status: "AUTH_REQUIRED",
        reason: "Navegação transitória capturada; autentique manualmente.",
      };
    }
    return { status: "GENERATION_FAILED", reason: msg };
  } finally {
    if (browser) {
      try {
        await browser.close().catch(() => {});
        log("[cdp] desconectado (Chrome real permanece aberto).");
      } catch {
        log("[cdp] falha ao desconectar.");
      }
    }
  }
}
