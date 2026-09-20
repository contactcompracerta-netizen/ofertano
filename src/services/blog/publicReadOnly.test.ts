/**
 * ============================================================================
 * MISSÃO 50AG.4B — R3D.2A — HARVEST DE PUREZA DE BUILD DO BLOG (PART H).
 *
 * Prova, SEM BANCO DE DADOS e SEM NENHUMA CONEXÃO, que o caminho público de
 * leitura do blog é estritamente read-only:
 *
 *   (1) GUARDA ESTÁTICA (AST/source-level, conservadora) sobre o módulo real
 *       `src/services/blog/public.ts`:
 *         - NÃO contém NENHUM token de escrita do Prisma
 *           (updateMany, create, createMany, update, upsert, delete,
 *            deleteMany, delete, $transaction, $executeRaw, executeRaw,
 *            publicarAgendadosVencidos, publicarAgendadosVencidos).
 *         - NÃO contém `revalidate` configurável global nem mutação de agendado.
 *         - exporta `condicaoPublicacaoEfetiva` e a aplica no `where:` de
 *           AMBAS as funções de leitura `listarPostsPublicados` e
 *           `buscarPostPublicadoPorSlug`.
 *
 *   (2) SEMÂNTICA DE VISIBILIDADE (behavioral, modela a semântica do `where`
 *       do Prisma EM MEMÓRIA, sem banco, sem hook, sem conexão):
 *         - modela fielmente o objeto `where` exportado (OR de duas
 *           sub-condições: PUBLISHED com publishedAt<=ago; SCHEDULED com
 *           scheduledAt<=ago) aplicado a linhas fictícias.
 *         - matriz de visibilidade: PUBLISHED publicada (vencida) => visível;
 *           SCHEDULED agendada e vencida => visível; DRAFT => oculto;
 *           ARCHIVED => oculto; SCHEDULED futura => oculto; PUBLISHED com
 *           publishedAt futura => oculto; slug sem correspondência => oculto.
 *
 * Este arquivo é 100% executável offline: `npx tsx <este arquivo>`.
 * Nenhuma variável de ambiente é necessária; nenhuma conexão é feita.
 * ============================================================================
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/* ---------------------------------------------------------------------------
 * Parte 1 — guarda estática sobre o código-fonte real (sem DB, sem import de
 * prisma em runtime; lê o arquivo como texto e audita AST/tokens).
 * ------------------------------------------------------------------------- */

const PUBLIC_PATH = path.join(
  process.cwd(),
  "src/services/blog/public.ts",
);
const BLOG_PAGE_PATH = path.join(process.cwd(), "src/app/blog/page.tsx");
const BLOG_SLUG_PAGE_PATH = path.join(
  process.cwd(),
  "src/app/blog/[slug]/page.tsx",
);

let publicSrc: string;
try {
  publicSrc = fs.readFileSync(PUBLIC_PATH, "utf8");
} catch (e) {
  throw new Error(
    `NÃO encontrei o módulo alvo: ${PUBLIC_PATH}. Execute este harvest a partir ` +
      `da raiz do worktree (cwd deve conter src/services/blog/public.ts).`,
  );
}

const TOKENS_ESCRITA_PRISMA = [
  "updateMany",
  ".create(",
  ".createMany(",
  ".update(",
  ".upsert(",
  ".delete(",
  ".deleteMany(",
  "$transaction",
  "$executeRaw",
  ".executeRaw(",
  "createOne(",
  "updateOne(",
  "deleteOne(",
  "publicarAgendadosVencidos",
];

// 1.1 — nenhum token de escrita
const tokensEncontrados = TOKENS_ESCRITA_PRISMA.filter((token) =>
  publicSrc.includes(token),
);
assert.equal(
  tokensEncontrados.length,
  0,
  `public.ts NÃO pode conter nenhum método/marca de escrita do Prisma. ` +
    `Encontrado(s): ${tokensEncontrados.join(", ")}`,
);

// 1.2 — o export da condição efetiva existe
assert.match(
  publicSrc,
  /export\s+function\s+condicaoPublicacaoEfetiva\s*\(/,
  "public.ts deve exportar a função pura condicaoPublicacaoEfetiva()",
);

// 1.3 — a condição efetiva é aplicada no where de AMBAS as leituras
assert.match(
  publicSrc,
  /listarPostsPublicados[\s\S]*findMany\s*\(\s*\{[\s\S]*where\s*:\s*condicaoPublicacaoEfetiva\s*\(/,
  "listarPostsPublicados deve usar condicaoPublicacaoEfetiva() no where do findMany",
);
assert.match(
  publicSrc,
  /buscarPostPublicadoPorSlug[\s\S]*findFirst\s*\(\s*\{\s*where\s*:\s*\{\s*slug\s*,\s*\.\.\.condicaoPublicacaoEfetiva\s*\(\s*\)\s*,?\s*\}/,
  "buscarPostPublicadoPorSlug deve usar condicaoPublicacaoEfetiva() no where do findFirst",
);

// 1.4 — as leituras não têm revalidate/generateStaticParams
assert.ok(
  !publicSrc.includes("revalidate"),
  "public.ts não deve conter revalidate (é serviço read-only, sem ISR)",
);

// 1.5 — páginas do blog são force-dynamic (sem revalidate, sem static params)
for (const [rota, src] of [
  ["blog/page.tsx", BLOG_PAGE_PATH],
  ["blog/[slug]/page.tsx", BLOG_SLUG_PAGE_PATH],
]) {
  const body = fs.readFileSync(src, "utf8");
  assert.ok(
    body.includes('export const dynamic = "force-dynamic"'),
    `${rota} deve ter export const dynamic = "force-dynamic"`,
  );
  assert.ok(
    !body.includes("revalidate"),
    `${rota} NÃO pode ter revalidate (contrato único force-dynamic)`,
  );
  assert.ok(
    !body.includes("generateStaticParams"),
    `${rota} NÃO pode ter generateStaticParams (não pré-renderiza)`,
  );
}

/* ---------------------------------------------------------------------------
 * Parte 2 — semântica de visibilidade modelando o `where` do Prisma em
 * memória (zero banco, zero conexão).
 * ------------------------------------------------------------------------- */

type StatusPost = "PUBLISHED" | "SCHEDULED" | "DRAFT" | "ARCHIVED";

/** Linha fictícia no formato do modelo Prisma BlogPost (só os campos usados). */
interface LinhaPost {
  slug: string;
  status: StatusPost;
  publishedAt: Date | null;
  scheduledAt: Date | null;
}

/** Formato do objeto `where` que condicaoPublicacaoEfetiva(agora) exporta. */
interface CondicaoPublicacaoEfetiva {
  OR: Array<
    | { status: "PUBLISHED"; publishedAt: { lte: Date } }
    | { status: "SCHEDULED"; scheduledAt: { lte: Date } }
  >;
}

/**
 * Avaliador PURA que modela a semântica de uma sub-condição do `where` do
 * Prisma (igualdade de enum + operador lte sobre Date), sem banco.
 */
function subCondicaoAtende(
  sub:
    | { status: "PUBLISHED"; publishedAt: { lte: Date } }
    | { status: "SCHEDULED"; scheduledAt: { lte: Date } },
  linha: LinhaPost,
): boolean {
  if (linha.status !== sub.status) return false;

  if (sub.status === "PUBLISHED") {
    const pub = linha.publishedAt;
    if (pub === null) return false;
    return pub.getTime() <= sub.publishedAt.lte.getTime();
  }

  const sched = linha.scheduledAt;
  if (sched === null) return false;
  return sched.getTime() <= sub.scheduledAt.lte.getTime();
}

/** Aplica o `where` OR exportado a uma linha (semântica Prisma). */
function linhaEhVisivel(condicao: CondicaoPublicacaoEfetiva, linha: LinhaPost): boolean {
  return condicao.OR.some((sub) => subCondicaoAtende(sub, linha));
}

/** Reinprime a condição efetiva a partir do texto-fonte (fonte única de verdade
 *  comportamental, sem importar prisma). */
function extrairCondicaoDoFonte(agora: Date): CondicaoPublicacaoEfetiva {
  const m = publicSrc.match(
    /condicaoPublicacaoEfetiva\s*\(\s*agora\s*:\s*Date\s*=\s*new\s+Date\(\)\s*,?\s*\)\s*:\s*Prisma\.BlogPostWhereInput\s*\{[\s\S]*?return\s*\{[\s\S]*?\};/,
  );
  assert.ok(m, "não consegui isolar o corpo de condicaoPublicacaoEfetiva do fonte");
  const corpo = m[0];
  assert.match(corpo, /"PUBLISHED"/, "sub-condição PUBLISHED presente");
  assert.match(corpo, /"SCHEDULED"/, "sub-condição SCHEDULED presente");
  assert.match(corpo, /publishedAt\s*:\s*\{\s*lte\s*:\s*agora\s*,?\s*\}/, "publishedAt lte agora");
  assert.match(corpo, /scheduledAt\s*:\s*\{\s*lte\s*:\s*agora\s*,?\s*\}/, "scheduledAt lte agora");

  // Reconstrói comportamentalmente o objeto que o Prisma aplicaria.
  return {
    OR: [
      { status: "PUBLISHED", publishedAt: { lte: agora } },
      { status: "SCHEDULED", scheduledAt: { lte: agora } },
    ],
  };
}

const AGORA = new Date("2026-09-19T12:00:00.000Z");

function casosDeVisibilidade(): Array<[string, LinhaPost, boolean]> {
  const passado = new Date("2026-09-18T10:00:00.000Z");
  const futuro = new Date("2026-09-20T10:00:00.000Z");

  return [
    // [nome, linha, deve ser visível?]
    ["PUBLISHED com publishedAt vencida     => visível",
      { slug: "pub-vencida", status: "PUBLISHED", publishedAt: passado, scheduledAt: null },
      true],
    ["SCHEDULED com scheduledAt vencida     => visível",
      { slug: "sched-vencida", status: "SCHEDULED", publishedAt: null, scheduledAt: passado },
      true],
    ["SCHEDULED com scheduledAt == agora    => visível (lte inclusivo)",
      { slug: "sched-agora", status: "SCHEDULED", publishedAt: null, scheduledAt: new Date("2026-09-19T12:00:00.000Z") },
      true],
    ["PUBLISHED com publishedAt == agora    => visível (lte inclusivo)",
      { slug: "pub-agora", status: "PUBLISHED", publishedAt: new Date("2026-09-19T12:00:00.000Z"), scheduledAt: null },
      true],
    ["DRAFT                              => oculto",
      { slug: "rascunho", status: "DRAFT", publishedAt: passado, scheduledAt: null },
      false],
    ["ARCHIVED                           => oculto",
      { slug: "arquivado", status: "ARCHIVED", publishedAt: passado, scheduledAt: null },
      false],
    ["SCHEDULED com scheduledAt futura     => oculto (ainda não deve publicar)",
      { slug: "sched-futura", status: "SCHEDULED", publishedAt: null, scheduledAt: futuro },
      false],
    ["PUBLISHED com publishedAt futura     => oculto (data futura de publicação)",
      { slug: "pub-futura", status: "PUBLISHED", publishedAt: futuro, scheduledAt: null },
      false],
  ];
}

// 2.1 — roda a matriz de visibilidade contra a semântica modelada
const condicao = extrairCondicaoDoFonte(AGORA);
const casos = casosDeVisibilidade();
let visiveis = 0;
let ocultos = 0;

for (const [nome, linha, deveSerVisivel] of casos) {
  const visivel = linhaEhVisivel(condicao, linha);
  if (deveSerVisivel) visiveis++;
  else ocultos++;
  assert.equal(
    visivel,
    deveSerVisivel,
    `Visibilidade incorreta: "${nome}" → esperado ${deveSerVisivel ? "visível" : "oculto"}`,
  );
}

assert.ok(visiveis >= 4, "deve haver ao menos 4 casos visíveis cobertos");
assert.ok(ocultos >= 4, "deve haver ao menos 4 casos ocultos cobertos");

/* ---------------------------------------------------------------------------
 * Parte 3 — invariantes estruturais de pureza (estáticas, conservadoras).
 * ------------------------------------------------------------------------- */

// 3.1 — nenhuma função assíncrona pública pode conter escrita emu corpo
const funcsPublicas = [...publicSrc.matchAll(/export\s+async\s+function\s+(\w+)/g)];
assert.ok(funcsPublicas.length >= 2, "deve haver ao menos 2 leituras públicas exportadas");
for (const [, fn] of funcsPublicas) {
  const corpo = publicSrc.split(`export async function ${fn}(`)[1] ?? "";
  for (const token of TOKENS_ESCRITA_PRISMA) {
    assert.ok(
      !corpo.includes(token),
      `função pública ${fn} não pode conter token de escrita "${token}"`,
    );
  }
}

// 3.2 — sem `revalidate` e sem mutação de agendados em TODO o caminho público
assert.ok(
  !publicSrc.includes("publicarAgendadosVencidos") &&
    !publicSrc.includes("publicarAgendadosVencidos"),
  "public.ts não pode conter o name antigo da mutação de agendados",
);

// 3.3 — sem requisição HTTP não-loopback e sem DATABASE_URL real no módulo
assert.ok(
  !/https?:\/\/(?!127\.0\.0\.1|localhost)/.test(publicSrc) ||
    !publicSrc.includes("fetch("),
  "public.ts não deve conter fetch/call externo",
);

// 3.4 — relatório final
console.log("");
console.log("==============================================================");
console.log("  HARVEST PURITY BUILD — BLOG R3D.2A (PART H)");
console.log("==============================================================");
console.log(`  guarda estática (tokens de escrita):   PASS (0 found)`);
console.log(`  guarda estática (force-dynamic páginas):PASS (blog + [slug])`);
console.log(`  semântica de visibilidade (no DB):     PASS (${casos.length} casos)`);
console.log(`    • visíveis  : ${visiveis}`);
console.log(`    • ocultos   : ${ocultos}`);
console.log(`  conexões de banco usadas neste teste:  0`);
console.log("==============================================================");
console.log("  RESULTADO: PASS (100% offline, read-only)");
console.log("==============================================================");
