import { chromium } from 'playwright';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

interface PocResult {
  mlAffiliatePoc: 'PASS' | 'FAIL' | 'BLOCKED_AUTH' | 'AUTH_REQUIRED' | 'CHROME_NOT_RUNNING';
  sourceUrl?: string;
  sourceItemId?: string;
  affiliateUrl?: string;
  targetValidated?: boolean;
  stage?: string;
  reason?: string;
}

const logsDir = resolve(process.cwd(), 'scripts', '.ml-affiliate-poc-logs');

// Conecta ao Google Chrome REAL já aberto pelo usuário via CDP.
const CDP_ENDPOINT = 'http://127.0.0.1:9222';
// Diretório de usuário do Chrome real de afiliados (fora do perfil Playwright).
const CHROME_PROFILE_DIR = resolve(process.cwd(), '.ml-affiliate-chrome');

const GENERATOR_URL = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';

// URLs/navegações que indicam que autenticação é necessária (redirect p/ login ou desafio)
const AUTH_REQUIRED_MARKERS = [
  '/jms/mlb/lgz/login',
  '/jms/mlb',
  '/login',
  'loginType=',
  '/registration',
  '/seguridad',
  '/security',
];

const AUTH_CHALLENGE_MARKERS = [
  'captcha',
  'não é um robô',
  'desafio',
  'verify',
  'confirme que',
  'security check',
];

const NAV_ERROR_MARKERS = [
  'Execution context was destroyed',
  'execution context was destroyed',
  'Navigation failed',
  'Target page, context or browser has been closed',
];

const STABILIZE_POLL_MS = 3000;

const logLines: string[] = [];

function log(msg: string): void {
  logLines.push(`[${new Date().toISOString()}] ${msg}`);
  process.stdout.write(msg + '\n');
}

function fail(stage: string, reason: string): PocResult {
  return { mlAffiliatePoc: 'FAIL', stage, reason };
}

function chromeNotRunning(errorMsg: string): PocResult {
  return {
    mlAffiliatePoc: 'CHROME_NOT_RUNNING',
    reason: errorMsg,
  };
}

function authRequired(reason: string): PocResult {
  return {
    mlAffiliatePoc: 'AUTH_REQUIRED',
    reason,
  };
}

function extractItemId(url: string): string | null {
  const clean = url.split('?')[0].split('#')[0];
  const m = clean.match(/(MLB[-_]?\d{5,})/i);
  return m ? m[1].toUpperCase().replace(/_/g, '-') : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientNavError(err: unknown): boolean {
  const msg = (err as Error)?.message || '';
  return NAV_ERROR_MARKERS.some((m) => msg.includes(m));
}

function urlNeedsAuth(url: string): boolean {
  return AUTH_REQUIRED_MARKERS.some((m) => url.includes(m));
}

// ===========================================================================
// Rotina segura de estabilização: NUNCA executa evaluate/DOM durante navegação.
// ===========================================================================

/**
 * Aguarda um período de "calmaria" no qual NÃO há navegação em curso e o DOM
 * está acessível. Tolerante a navegações intermediárias (redirects encadeados).
 */
async function waitForPageStable(
  page: import('playwright').Page,
  stabilityMs = 4000,
  timeoutMs = 60000,
): Promise<boolean> {
  const start = Date.now();

  // rastreia navegações em andamento para não tocar no DOM durante elas
  let navigationStartedAt: number | null = Date.now();

  const onNavigated = () => {
    navigationStartedAt = Date.now();
  };

  page.on('framenavigated', onNavigated);

  try {
    while (Date.now() - start < timeoutMs) {
      if (page.isClosed()) return false;

      // Espera domcontentloaded de forma tolerante (pode lançar se navegando)
      await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {
        /* transitório */
      });
      if (page.isClosed()) return false;

      // Janela de calmaria: nenhuma navegação iniciada nos últimos stabilityMs
      const now = Date.now();
      const settled =
        navigationStartedAt !== null && now - navigationStartedAt >= stabilityMs;
      if (settled) {
        // pequena pausa extra para garantir DOM acessível
        if (now - navigationStartedAt >= stabilityMs * 2) return true;
        await sleep(stabilityMs);
      } else {
        await sleep(STABILIZE_POLL_MS);
      }
    }
  } finally {
    page.off('framenavigated', onNavigated);
  }

  return false;
}

/**
 * Executa page.evaluate de forma segura: trata "Execution context was destroyed"
 * (navegação transitória) com retries limitados. Retorna undefined em caso de falha.
 */
async function safeEval<T>(
  page: import('playwright').Page,
  fn: () => Promise<T>,
  retries = 3,
): Promise<T | undefined> {
  for (let i = 0; i < retries; i++) {
    if (page.isClosed()) return undefined;
    try {
      // antes de avaliar, confere se não navegando ainda (calmaria rápida)
      await page
        .waitForLoadState('domcontentloaded', { timeout: 3000 })
        .catch(() => {});
      if (page.isClosed()) return undefined;
      return await fn();
    } catch (err) {
      if (isTransientNavError(err) && i < retries - 1) {
        log('[stabilize] contexto destruído durante navegação transitória; reavaliando...');
        await sleep(1500);
        continue;
      }
      // erro não transitório: propaga para o chamador tratar
      throw err;
    }
  }
  return undefined;
}

async function domText(page: import('playwright').Page): Promise<string> {
  const text = await safeEval(
    page,
    () => page.evaluate(() => document.body?.innerText || ''),
  );
  return text || '';
}

async function isAuthChallengePageSafe(page: import('playwright').Page): Promise<boolean> {
  const text = (await domText(page)).toLowerCase();
  return AUTH_CHALLENGE_MARKERS.some((m) => text.includes(m));
}

// ===========================================================================
// Helpers de autorização
// ===========================================================================

/**
 * Determina se a página atual exige autenticação, sem depender de evaluate:
 * prioriza URL/load state e, se estável, payload textual.
 */
async function requireAuth(
  page: import('playwright').Page,
): Promise<'required' | 'none' | 'unknown'> {
  if (page.isClosed()) return 'unknown';
  const url = page.url();
  if (urlNeedsAuth(url)) return 'required';
  // URL não indica auth; conferir desafio textual de forma segura
  const challenge = await isAuthChallengePageSafe(page);
  if (challenge) return 'required';
  return 'none';
}

// ===========================================================================
// Elementos do gerador
// ===========================================================================

async function waitForUrlField(
  page: import('playwright').Page,
): Promise<import('playwright').Locator | null> {
  const selectors: Array<() => Promise<import('playwright').Locator | null>> = [
    async () =>
      page.getByRole('textbox', { name: /insira.*url|url.*produto|link.*produto/i }).first(),
    async () => page.getByPlaceholder(/insira.*url|url.*produto|cole.*link/i).first(),
    async () => page.getByLabel(/insira.*url|url.*produto|link.*produto/i).first(),
    async () =>
      page
        .locator('textarea, input[type="text"], input[type="url"]')
        .filter({ hasText: /url|link/i })
        .first(),
    async () => page.locator('textarea').first(),
  ];
  // tolerantes a navegação: qualquer erro é tratado como transient e tentamos de novo
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
  page: import('playwright').Page,
): Promise<import('playwright').Locator | null> {
  const selectors: Array<() => Promise<import('playwright').Locator | null>> = [
    async () => page.getByRole('button', { name: /gerar( link)?/i }).first(),
    async () => page.getByRole('button', { name: /generar/i }).first(),
    async () => page.getByRole('button', { name: /gerar/i }).last(),
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

// ===========================================================================
// FASE 1 — Capture com diagnóstico (candidatas before/after + fonte)
// ===========================================================================

interface CaptureCandidate {
  url: string;
  source: 'anchor' | 'input' | 'textarea' | 'text' | 'generated-container';
}

/**
 * Coleta URLs candidatas de meli.la espalhadas pela página, com a fonte de cada uma.
 * Prioriza o container do resultado gerado (perto de "Copiar"/"Link gerado").
 */
async function collectCaptureCandidates(
  page: import('playwright').Page,
): Promise<CaptureCandidate[]> {
  const candidates: CaptureCandidate[] = [];

  // 1) Sempre: a[href] meli.la
  try {
    const anchors = await safeEval(page, () =>
      page
        .locator('a[href*="meli.la"]')
        .evaluateAll((els) =>
          els
            .map((e) => e.getAttribute('href') || '')
            .filter((h) => h.length > 0 && h.includes('meli.la')),
        ),
    );
    for (const u of anchors || []) candidates.push({ url: u, source: 'anchor' });
  } catch (err) {
    if (!isTransientNavError(err)) throw err;
  }

  // 2) input.value / textarea.value contendo meli.la
  try {
    const inputs = await safeEval(page, () =>
      page
        .locator('input, textarea')
        .evaluateAll((els) =>
          els
            .map((e) => ({
              v: (e as HTMLInputElement).value || '',
              readonly: (e as HTMLInputElement).readOnly,
            }))
            .filter((o) => o.v.includes('meli.la')),
        ),
    );
    for (const o of inputs || []) {
      candidates.push({ url: o.v, source: o.readonly ? 'input' : 'textarea' });
    }
  } catch (err) {
    if (!isTransientNavError(err)) throw err;
  }

  // 3) Texto visível contendo https:// e que também referencie meli.la
  try {
    const texts = await safeEval(page, () =>
      page
        .locator('span, p, code, pre, div')
        .evaluateAll((els) =>
          els
            .map((e) => (e as HTMLElement).innerText || '')
            .filter((t) => t && t.includes('https://') && t.includes('meli.la')),
        ),
    );
    const seen = new Set<string>();
    for (const t of texts || []) {
      for (const m of t.match(/https?:\/\/meli\.la\/[\w.\-/]+/g) || []) {
        const key = m.replace(/[.\-|]$/, '');
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ url: key, source: 'text' });
      }
    }
  } catch (err) {
    if (!isTransientNavError(err)) throw err;
  }

  // 4) Container do botão "Copiar"/"Link gerado": navegação pelo texto,
  //    captura anc por dentro do container (provável resultado canônico).
  try {
    const containerLinks = await safeEval(page, () =>
      page.evaluate(() => {
        const out: string[] = [];
        const labels = /copiar|link gerado|gerar link gerado|clique para copiar/i;
        const roots = [...document.querySelectorAll('button, a')].filter((el) =>
          labels.test((el as HTMLElement).innerText || ''),
        );
        for (const root of roots) {
          // sobe até um container razoável e procura meli.la dentro
          let node: HTMLElement | null = root as HTMLElement;
          for (let up = 0; up < 6 && node; up++) {
            node = node.parentElement;
            if (!node) break;
            const str = node.innerText || '';
            const textM = str.match(/https?:\/\/meli\.la\/[\w.\-/]+/);
            if (textM) {
              out.push(textM[0]);
              break;
            }
            const input = node.querySelector('input, textarea') as HTMLInputElement | null;
            const iv = input?.value || '';
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
      candidates.push({ url: u, source: 'generated-container' });
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
      out.add(m.replace(/[.\-|]$/, ''));
    }
  }
  return [...out];
}

interface CaptureDiagnosis {
  candidateCountBefore: number;
  candidateCountAfter: number;
  newCandidates: string[];
  source: string;
  capturedUrl: string | null;
  isNew: boolean;
}

/**
 * Decide a melhor URL capturada comparando antes/depois do clique em Gerar.
 */
async function diagnoseCapture(
  page: import('playwright').Page,
): Promise<CaptureDiagnosis> {
  const before = await collectCaptureCandidates(page);
  const beforeUrls = new Set(uniqueMeliLa(before.map((c) => c.url)));

  log(`CAPTURE_CANDIDATES_BEFORE=${beforeUrls.size}`);

  // Aguarda a interface atualizar após Gerar
  await sleep(2500);
  const after = await collectCaptureCandidates(page);
  const afterUrls = new Set(uniqueMeliLa(after.map((c) => c.url)));
  log(`CAPTURE_CANDIDATES_AFTER=${afterUrls.size}`);

  const newCandidates = [...afterUrls].filter((u) => !beforeUrls.has(u));
  log(`CAPTURE_NEW_CANDIDATES=${newCandidates.length}`);

  // Ordem de prioridade da fonte
  const sourceRank: Record<string, number> = {
    'generated-container': 1,
    input: 2,
    textarea: 2,
    text: 3,
    anchor: 4,
  };

  // Agrupa por URL, mantendo a menor fonte (melhor proveniência) e flag de novidade.
  const byUrl = new Map<string, { rank: number; isNew: boolean; source: string }>();
  const register = (u: string, src: string) => {
    const rank = sourceRank[src] ?? 99;
    const isNew = newCandidates.includes(u);
    const cur = byUrl.get(u);
    if (!cur || rank < cur.rank) {
      byUrl.set(u, { rank, isNew, source: src });
    }
  };
  for (const cand of after) {
    for (const u of uniqueMeliLa([cand.url])) {
      register(u, cand.source);
    }
  }
  // garante que novas sem fonte específica entram
  for (const u of newCandidates) {
    if (!byUrl.has(u)) register(u, 'text');
  }

  if (byUrl.size === 0) {
    log('CAPTURE_SOURCE=fallback');
    log('CAPTURED_URL=<nenhum>');
    return {
      candidateCountBefore: beforeUrls.size,
      candidateCountAfter: afterUrls.size,
      newCandidates,
      source: 'fallback',
      capturedUrl: null,
      isNew: false,
    };
  }

  // Escolhe: prefere URLs NOVAS, depois menor rank; dentro do mesmo critério, ordem estável.
  const ranked = [...byUrl.entries()].sort((a, b) => {
    if (a[1].isNew !== b[1].isNew) return a[1].isNew ? -1 : 1; // novas primeiro
    if (a[1].rank !== b[1].rank) return a[1].rank - b[1].rank; // menor rank
    return a[0].localeCompare(b[0]);
  });

  const [bestUrl, bestInfo] = ranked[0];
  const source = bestInfo.source === 'generated-container' ? 'generated-container' : bestInfo.source;

  log(`CAPTURE_SOURCE=${source}`);
  log(`CAPTURED_URL=${bestUrl}`);

  return {
    candidateCountBefore: beforeUrls.size,
    candidateCountAfter: afterUrls.size,
    newCandidates,
    source,
    capturedUrl: bestUrl,
    isNew: bestInfo.isNew,
  };
}

// ===========================================================================
// FASE 2 — Validação em NOVA página (rastreio de hops + multi-fonte do MLB)
// ===========================================================================

interface ValidationResult {
  hops: string[];
  targetValidated: boolean;
  finalUrl: string;
  mlbFound: string | null;
}

/**
 * Abre o link em uma NOVA página no mesmo contexto, rastreia hops de URL por até
 * 15s e procura o MLB esperado na URL final, canonical, links e JSON-LD.
 */
async function diagnoseValidationInNewPage(
  context: import('playwright').BrowserContext,
  affiliateUrl: string,
  expectedItem: string,
): Promise<ValidationResult> {
  const page = await context.newPage();
  const hops: string[] = [];
  let mlbFound: string | null = null;

  const recordHop = (url: string) => {
    // dedupe + guarda hop (nulas ignoradas)
    const clean = url.split('#')[0];
    if (clean && !hops.includes(clean)) {
      hops.push(clean);
      log(`VALIDATION_HOP_${hops.length}=${maskUrl(clean)}`);
    }
  };

  page.on('framenavigated', () => {
    try {
      recordHop(page.url());
    } catch {
      /* ignora */
    }
  });

  // monitoramentos periódicos (client-side pushes não disparam framenavigated)
  const end = Date.now() + 15000;
  let last = '';
  try {
    await page.goto(affiliateUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(
      (err) => log(`[validation] goto falhou: ${(err as Error).message}`),
    );
    recordHop(page.url());
    last = page.url();

    // janela de 15s tolerando redirects (HTTP e client-side)
    while (Date.now() < end && !page.isClosed()) {
      await page
        .waitForLoadState('networksidle', { timeout: 2000 })
        .catch(() => {});
      const cur = page.url();
      if (cur && cur !== last) {
        recordHop(cur);
        last = cur;
      }
      // procura MLB esperado assim que surgir
      mlbFound = await findExpectedMlb(page, expectedItem);
      if (mlbFound) break;
      await sleep(1200);
    }
  } finally {
    // fecha SÓ a página nova (não o Chrome)
    await page.close().catch(() => {});
  }

  return {
    hops,
    targetValidated: mlbFound !== null,
    finalUrl: last || affiliateUrl,
    mlbFound,
  };
}

/**
 * Procura o MLB esperado em várias fontes públicas da página:
 * URL final, canonical, links de produto, JSON-LD e texto visível.
 */
async function findExpectedMlb(
  page: import('playwright').Page,
  expectedItem: string,
): Promise<string | null> {
  const needle = expectedItem;
  const foundIn = async (urls: string[], text?: string[]): Promise<string | null> => {
    for (const u of urls) {
      if (u && u.includes(needle)) return needle;
    }
    for (const t of text || []) {
      if (t && t.includes(needle)) return needle;
    }
    return null;
  };

  // URL final e atual
  const current = page.url();
  if (await foundIn([current])) return needle;

  // canonical + links de produto principais (a[href] contendo /p/MLB ou p/MLB)
  const canonical = await safeEval(
    page,
    () =>
      Promise.all([
        page.locator('link[rel="canonical"]').getAttribute('href').catch(() => null),
        page
          .locator('a[href*="/p/MLB"], a[href*="produto.mercadolivre.com.br/MLB"]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('href') || '').slice(0, 20)),
        page
          .locator('a[href*="/p/"], a[href*="produto.mercadolivre"]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('href') || '').slice(0, 20)),
      ]).then(([can, prodLinks, prodLinks2]) => ({ can, prodLinks, prodLinks2 })),
  );
  if (canonical) {
    const { can, prodLinks, prodLinks2 } = canonical;
    if (await foundIn([...[can], ...(prodLinks || []), ...(prodLinks2 || [])])) return needle;
  }

  // JSON-LD / dados estruturados públicos
  const ld = await safeEval(
    page,
    () =>
      page
        .locator('script[type="application/ld+json"]')
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).textContent || '')),
  );
  if (ld) {
    const joined = ld.join('\n');
    // procura o identificador ou a URL completa do item
    if (joined.includes(needle)) return needle;
    const urlFromLd = joined.match(/https?:\/\/[^"\\ ]*MLB\d{5,}/i);
    if (urlFromLd && urlFromLd[0].includes(needle)) return needle;
  }

  // atributos/hrefs/medias visíveis de produto
  const bodies = await safeEval(
    page,
    () =>
      page
        .locator('body')
        .evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText || '')),
  );
  if (await foundIn([], bodies)) return needle;

  return null;
}

// ===========================================================================
// Navegação + fluxo principal
// ===========================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sourceUrl = args.find((a) => /^https?:\/\//i.test(a));

  // CHROME_NOT_RUNNING é reportado independente de ter URL (teste de conexão primeiro).
  if (!sourceUrl) {
    const res = fail(
      'input',
      'URL de produto Mercado Livre não fornecida. Ex.: npx tsx scripts/ml-affiliate-poc.mts "https://produto.mercadolivre.com.br/MLB-XXXX"',
    );
    printResult(res);
    return;
  }

  const sourceItemId = extractItemId(sourceUrl);
  if (!sourceItemId) {
    const res = fail('input', `Não foi possível extrair MLB da URL fornecida: ${sourceUrl}`);
    printResult(res);
    return;
  }

  log(`SOURCE_URL=${sourceUrl}`);
  log(`SOURCE_ITEM_ID=${sourceItemId}`);

  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  let browser: import('playwright').Browser | undefined;
  let context: import('playwright').BrowserContext | undefined;

  try {
    // ---- Teste de conexão CDP (Chrome real) ----
    log(`[cdp] conectando em ${CDP_ENDPOINT}`);
    let connected = false;
    let connectErr: unknown;
    try {
      browser = await chromium.connectOverCDP(CDP_ENDPOINT);
      connected = true;
    } catch (err) {
      connectErr = err;
    }

    if (!connected || !browser) {
      log(`[cdp] falha de conexão: ${(connectErr as Error)?.message || 'desconhecido'}`);
      // Não fechar nada: nem chegamos a conectar.
      printResult(
        chromeNotRunning(
          'Chrome real não está acessível via CDP em http://127.0.0.1:9222. ' +
            'Abra o Google Chrome de afiliados e tente novamente.',
        ),
      );
      // Instruções de uso são impressas mesmo assim (helper abaixo).
      printChromeCommand();
      return;
    }

    log('[cdp] conectado ao Google Chrome real.');

    // ---- Reutilizar BrowserContext existente ----
    const contexts = browser.contexts();
    context = contexts.length > 0 ? contexts[0] : await browser.newContext();

    // ---- Abrir/reutilizar uma página nesse contexto ----
    let page = context.pages().find((p) => !p.isClosed());
    if (!page) {
      page = await context.newPage();
    }

    // ---- Navegar para o gerador ----
    log(`[generator] abrindo ${GENERATOR_URL}`);
    await page.goto(GENERATOR_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    }).catch((err) => log(`[nav] ${(err as Error).message}`));

    await waitForPageStable(page, 4000, 60000);

    // ---- Detectar estado de autenticação ----
    const authState = await requireAuth(page);
    log(`[auth?] requireAuth => ${authState} (url=${maskUrl(page.url())})`);

    if (authState === 'required') {
      // NÃO autenticar. Apenas informar e aguardar o usuário autenticar no Chrome real.
      log('[auth] redirecionado para login/segurança. Não tentaremos autenticar.');
      log('AUTH_STATE=REQUIRED');
      printResult(
        authRequired('Abra o Chrome de afiliados e autentique manualmente.'),
      );
      return;
    }

    // ---- STAGE generator: garantir que estamos no gerador ----
    if (!page.url().includes('afiliados/linkbuilder')) {
      log('GENERATOR_STATE=NAVIGATING');
      await page.goto(GENERATOR_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      }).catch((err) => log(`[nav] ${(err as Error).message}`));
      await waitForPageStable(page, 4000, 60000);
      // sessão pode ter expirado durante a navegação
      const reAuth = await requireAuth(page);
      if (reAuth === 'required') {
        log('[auth] redirecionado para login/segurança ao navegar ao gerador.');
        log('AUTH_STATE=REQUIRED');
        printResult(
          authRequired('Abra o Chrome de afiliados e autentique manualmente.'),
        );
        return;
      }
    }
    await waitForPageStable(page, 4000, 60000);
    log('GENERATOR_STATE=READY');
    log(`[generator] URL final: ${maskUrl(page.url())}`);

    // ---- STAGE input ----
    const field = await waitForUrlField(page);
    if (!field) {
      printResult(fail('input', 'Campo de URL não localizado na página do gerador'));
      return;
    }
    await field.click();
    await field.fill(sourceUrl);
    log('[input] URL inserida no campo.');

    // ---- STAGE generate ----
    const btn = await waitForGenerateButton(page);
    if (!btn) {
      printResult(fail('generate', 'Botão de gerar link não localizado'));
      return;
    }
    await btn.click();
    log('[generate] botão de gerar acionado.');

    // ---- STAGE capture (com diagnóstico) ----
    const diag = await diagnoseCapture(page);

    if (!diag.capturedUrl) {
      log('CAPTURE_DIAGNOSIS=INCONCLUSIVE');
      printResult(fail('capture', 'Nenhum link meli.la capturado após gerar'));
      return;
    }
    log('[capture] link afiliado capturado (detalhes em CAPTURED_URL).');

    // ---- STAGE validation (em NOVA página, rastreio de hops) ----
    const val = await diagnoseValidationInNewPage(context, diag.capturedUrl, sourceItemId);

    if (val.targetValidated) {
      log('CAPTURE_DIAGNOSIS=VALID_AFFILIATE_SOCIAL_INTERMEDIATE');
      printResult({
        mlAffiliatePoc: 'PASS',
        sourceUrl,
        sourceItemId,
        affiliateUrl: diag.capturedUrl,
        targetValidated: true,
      });
      return;
    }

    // Não confirmado: classificar entre WRONG_LINK_CAPTURED e INCONCLUSIVE
    if (!diag.isNew) {
      // O link capturado já existia na página antes de Gerar -> quase certamente errado
      log('CAPTURE_DIAGNOSIS=WRONG_LINK_CAPTURED');
      printResult(
        fail(
          'validation',
          `Link afiliado não corresponde ao anúncio esperado. Esperado ${sourceItemId}, encontrado nenhum. ` +
            `O link capturado já existia na página antes de Gerar (não foi gerado agora).`,
        ),
      );
      return;
    }

    // URL nova mas sem confirmação do produto -> não conseguimos diferenciar ainda
    log('CAPTURE_DIAGNOSIS=INCONCLUSIVE');
    printResult(
      fail(
        'validation',
        `Link afiliado foi gerado mas não confirmado. Esperado ${sourceItemId}, encontrado nenhum. ` +
          `Página final: ${maskUrl(val.finalUrl)}.`,
      ),
    );
  } catch (err) {
    const msg = (err as Error)?.message || String(err);
    if (isTransientNavError(err)) {
      log('[stabilize] navegação transitória capturada; estado de autenticação.');
      log('AUTH_STATE=REQUIRED');
      printResult(
        authRequired('Abra o Chrome de afiliados e autentique manualmente.'),
      );
    } else {
      log(`[error] ${msg}`);
      printResult(fail('generator', msg));
    }
  } finally {
    // NÃO fechar o Chrome real. Apenas desconectar do CDP.
    if (browser) {
      try {
        await browser.close().catch(() => {});
        log('[cdp] desconectado (Chrome real permanece aberto).');
      } catch {
        /* ignora */
      }
    }
    writeLog();
  }
}

function printChromeCommand(): void {
  process.stdout.write('\n');
  process.stdout.write('Para abrir o Google Chrome real de afiliados:\n');
  process.stdout.write(
    '  & "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"\n' +
      '    --remote-debugging-port=9222\n' +
      '    --remote-debugging-address=127.0.0.1\n' +
      '    --user-data-dir="' +
      CHROME_PROFILE_DIR +
      '"\n',
  );
  process.stdout.write('\nDepois, autentique manualmente no Mercado Livre nesse Chrome.\n');
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const item = extractItemId(url);
    return `${u.origin}${u.pathname.split('/').slice(0, 3).join('/')}${item ? ' (item ' + item + ')' : ''}`;
  } catch {
    return '(url não parseável)';
  }
}

function printResult(res: PocResult): void {
  process.stdout.write('\n');
  process.stdout.write(`ML_AFFILIATE_POC=${res.mlAffiliatePoc}\n`);
  if (res.sourceUrl) process.stdout.write(`SOURCE_URL=${res.sourceUrl}\n`);
  if (res.sourceItemId) process.stdout.write(`SOURCE_ITEM_ID=${res.sourceItemId}\n`);
  if (res.affiliateUrl) process.stdout.write(`AFFILIATE_URL=${res.affiliateUrl}\n`);
  if (res.targetValidated !== undefined) process.stdout.write(`TARGET_VALIDATED=${res.targetValidated}\n`);
  if (res.stage) process.stdout.write(`STAGE=${res.stage}\n`);
  if (res.reason) process.stdout.write(`REASON=${res.reason}\n`);
}

function writeLog(): void {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = join(logsDir, `ml-affiliate-poc-${ts}.log`);
    mkdirSync(logsDir, { recursive: true });
    writeFileSync(file, logLines.join('\n') + '\n', 'utf8');
    process.stdout.write(`LOG_FILE=${file}\n`);
  } catch {
    // ignora
  }
}

main();
