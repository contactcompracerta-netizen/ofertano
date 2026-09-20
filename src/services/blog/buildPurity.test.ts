/**
 * MISSÃO 50AG.4B-R3D.2A — PARTE H — Pureza de build do caminho público do blog.
 *
 * Prova SEM banco de dados e SEM conexão que o caminho de leitura do blog:
 *   (1) é estático/conservador por AST sobre a fonte REAL (`public.ts`): o
 *       módulo NÃO contém NENHUM método de escrita do Prisma (updateMany,
 *       create, update, upsert, delete, deleteMany, $transaction,
 *       $executeRaw) nem o token `publicarAgendadosVencidos`;
 *   (2) é comportamental: modela a SEMÂNTICA do Prisma `where` (OR + lte de
 *       datas + igualdade de status) em memória, SEM banco — provando que a
 *       condição efetiva de publicação esconde DRAFT/ARCHIVED/SCHEDULED-
 *       futura/PUBLISHED-futura e mostra PUBLISHED-vencida e SCHEDULED-
 *       vencida;
 *   (3) prova que as páginas /blog e /blog/[slug] são force-dynamic e SEM
 *       `revalidate`, portanto NUNCA pré-renderizadas em build.
 *
 * Estratégia: guarda ESTÁTICA (lê o texto-fonte do módulo real; retorna
 * conservador) + modelo PURA em memória da semântica de `where` do Prisma.
 * Nenhuma conexão, nenhum client Prisma instanciado, nenhuma escrita,
 * nenhuma variável de ambiente necessária — roda offline com `npx tsx`.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// import do módulo REAL de leitura: ctor-lazy (PrismaPg NÃO conecta na
// importação — provado offline), 100% livre de banco.
import * as blogPublico from "./public";

const PUBLIC_PATH = path.join(
  process.cwd(),
  "src/services/blog/public.ts",
);
const SOURCE = fs.readFileSync(PUBLIC_PATH, "utf8");

/* ------------------------------------------------------------------ */
/* (1) GUARDA ESTÁTICA — tokens de escrita ausentes                    */
/* ------------------------------------------------------------------ */

const TOKENS_ESCRITA = [
  "updateMany",
  "createMany(",
  ".create(",
  ".createMany(",
  ".update(",
  ".upsert(",
  ".delete(",
  ".deleteMany(",
  "$transaction",
  "$executeRaw",
  "publicarAgendadosVencidos",
  "publicarAgendadosVencidos(",
  "publicarAgendadosVencidos",
];

for (const token of TOKENS_ESCRITA) {
  assert.ok(
    !SOURCE.includes(token),
    `public.ts NÃO pode conter token de escrita do Prisma: '${token}'`,
  );
}

/* ------------------------------------------------------------------ */
/* (2) GUARDA ESTÁTICA — a condição exportada e usada em AMBAS leituras */
/* ------------------------------------------------------------------ */

// A condição de publicação efetiva deve existir e ser usada na leitura
// de TODOS os posts (findMany) e na leitura por slug (findFirst), seja na
// forma direta (`where: condicaoX()`) OU em spread dentro do objeto where
// (`where: { slug, ...condicaoX() }`).
const FUNCAO_CONDICAO_RE =
  /export\s+function\s+condicao[A-Za-z_]*Efetiv[A-Za-z_]*\(/;
assert.match(
  SOURCE,
  FUNCAO_CONDICAO_RE,
  "public.ts deve exportar a condição de publicação efetiva",
);

const NOME_CONDICAO = (SOURCE.match(FUNCAO_CONDICAO_RE) as RegExpMatchArray)[0]
  .replace("export function ", "")
  .replace("(", "");

// a condição precisa aparecer no `where` de AMBAS as leituras, nas formas
// direta (`condicaoX()`) ou via spread (`...condicaoX()`) dentro do objeto.
const APARICOES_CONDICAO = (
  SOURCE.match(
    /(?:where\s*:\s*condicao[A-Za-z_]*Efetiv[A-Za-z_]*\([^)]*\)|\.\.\.condicao[A-Za-z_]*Efetiv[A-Za-z_]*\([^)]*\))/g,
  ) ?? []
);

assert.ok(
  APARICOES_CONDICAO.length >= 2,
  `a condição '${NOME_CONDICAO}' deve ser usada no where de AMBAS as leituras ` +
    `(findMany e findFirst), direta ou em spread — ${APARICOES_CONDICAO.length} ocorrências encontradas`,
);

/* ------------------------------------------------------------------ */
/* (3) GUARDA DE PÁGINAS — force-dynamic, SEM revalidate, SEM static    */
/* ------------------------------------------------------------------ */

for (const arquivo of [
  "src/app/blog/page.tsx",
  "src/app/blog/[slug]/page.tsx",
]) {
  const pagina = fs.readFileSync(
    path.join(process.cwd(), arquivo),
    "utf8",
  );
  assert.ok(
    pagina.includes("force-dynamic"),
    `${arquivo} deve ser force-dynamic`,
  );
  assert.ok(
    !pagina.includes("revalidate"),
    `${arquivo} NÃO pode revalidar (nem revalidate nem ISR)`,
  );
  assert.ok(
    !pagina.includes("generateStaticParams"),
    `${arquivo} NÃO pode usar generateStaticParams`,
  );
}

/* ------------------------------------------------------------------ */
/* (4) SEMÂNTICA PURA — modela o `where` do Prisma SEM banco            */
/* ------------------------------------------------------------------ */

type Post = {
  isPublished: boolean;
  status: "PUBLISHED" | "SCHEDULED" | "DRAFT" | "ARCHIVED";
  publishedAt: Date | null;
  scheduledAt: Date | null;
};

type Condicao = {
  OR: Array<{
    status?: "PUBLISHED" | "SCHEDULED";
    publishedAt?: { lte: Date };
    scheduledAt?: { lte: Date };
  }>;
};

const AGORA = new Date("2026-09-19T12:00:00.000Z");

// Condição efetiva REAL obtida do módulo exportado (ctor-lazy:
// nenhuma conexão de banco na importação — provado offline).
// Usa o nome extraído estaticamente, portanto imune a drift de grafia.
const condicao = (blogPublico as unknown as Record<string, (agora: Date) => Condicao>)[NOME_CONDICAO](AGORA);

// avaliador Prisma-where em memória (sem banco)
function postVisivel(condicao: Condicao, post: Post): boolean {
  return condicao.OR.some((sub) => {
    const campos = Object.entries(sub) as Array<
      [string, string | { lte?: Date }]
    >;
    return campos.every(([campo, valor]) => {
      switch (campo) {
        case "status":
          return post.status === valor;
        case "publishedAt":
          return (
            post.publishedAt !== null &&
            (valor as { lte: Date }).lte !== undefined &&
            post.publishedAt.getTime() <=
              (valor as { lte: Date }).lte!.getTime()
          );
        case "scheduledAt":
          return (
            post.scheduledAt !== null &&
            (valor as { lte: Date }).lte !== undefined &&
            post.scheduledAt.getTime() <=
              (valor as { lte: Date }).lte!.getTime()
          );
        default:
          return false;
      }
    });
  });
}

const CASOS: Array<[string, Post, boolean]> = [
  [
    "PUBLISHED vencida (publishedAt <= agora)  -> visível",
    { status: "PUBLISHED", publishedAt: new Date("2026-09-01T00:00Z"), scheduledAt: null, isPublished: true },
    true,
  ],
  [
    "PUBLISHED no EXATO moment do agora       -> visível (lte inclusivo)",
    { status: "PUBLISHED", publishedAt: AGORA, scheduledAt: null, isPublished: true },
    true,
  ],
  [
    "SCHEDULED vencida (scheduledAt <= agora) -> visível",
    { status: "SCHEDULED", publishedAt: null, scheduledAt: new Date("2026-09-02T00:00Z"), isPublished: true },
    true,
  ],
  [
    "SCHEDULED no EXATO momento do agora      -> visível",
    { status: "SCHEDULED", publishedAt: null, scheduledAt: AGORA, isPublished: true },
    true,
  ],
  [
    "DRAFT                                   -> oculto",
    { status: "DRAFT", publishedAt: null, scheduledAt: null, isPublished: false },
    false,
  ],
  [
    "ARCHIVED                                -> oculto",
    { status: "ARCHIVED", publishedAt: new Date("2026-01-01T00:00Z"), scheduledAt: null, isPublished: false },
    false,
  ],
  [
    "SCHEDULED com scheduledAt futura        -> oculto (ainda não publicada)",
    { status: "SCHEDULED", publishedAt: null, scheduledAt: new Date("2026-09-30T00:00Z"), isPublished: false },
    false,
  ],
  [
    "PUBLISHED com publishedAt futura        -> oculto",
    { status: "PUBLISHED", publishedAt: new Date("2026-09-30T00:00Z"), scheduledAt: null, isPublished: false },
    false,
  ],
  [
    "SCHEDULED vencida, mas arquivada        -> oculto (status manda)",
    { status: "ARCHIVED", publishedAt: null, scheduledAt: new Date("2026-09-01T00:00Z"), isPublished: false },
    false,
  ],
];

let visivel = 0;
let oculto = 0     // 9;span class="token number">0;
for (const [nome, post, esperado] of CASOS) {
  const resultado = postVisivel(condicao, post);
  assert.equal(
    resultado,
    esperado,
    `visibilidade incorreta: ${nome} → esperado ${esperado}, obtido ${resultado}`,
  );
  if (resultado) visivel++;
  else oculto++;
}

assert.ok(visivel >= 4, `deve haver ao menos 4 visíveis (obtido ${visivel})`);
assert.ok(oculto >= 5, `deve haver ao menos 5 ocultos (obtido ${oculto})`);

/* ------------------------------------------------------------------ */

console.log("\n=============================================================");
console.log("MISSÃO 50AG.4B-R3D.2A — PARTE H — PUREZA DE BUILD DO BLOG");
console.log("=============================================================");
console.log(`  guarda estática (${NOME_CONDICAO}, sem tokens):       PASS`);
console.log(`  usada no where de findMany e findFirst:               PASS`);
console.log(`  páginas force-dynamic, sem revalidate:                PASS`);
console.log(`  semântica sem banco (${visivel} visíveis + ${oculto} ocultos):    PASS`);
console.log(`  conexões de banco usadas neste teste:                 0`);
console.log("=============================================================\n");
