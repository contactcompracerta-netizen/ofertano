import assert from "node:assert/strict";

import {
  findOfertaListingAware,
  isUniqueConstraintViolation,
  listOfertasListingAware,
  upsertOfertaListingAware,
  withUniqueRaceRetry,
  type OfertaDb,
} from "./marketplaceOfferWriter";

/*
 * 42P10 / unicidade PARCIAL de `MarketplaceOffer` — testes de regressao.
 *
 * O defeito que este arquivo trava:
 *
 *   O schema declarava `@@unique([productId, marketplace])`. O Prisma gerava
 *   `ON CONFLICT ("productId","marketplace") DO UPDATE` SEM predicado, e o
 *   Postgres respondia 42P10 (`there is no unique or exclusion constraint
 *   matching the ON CONFLICT specification`) porque a garantia real e um
 *   indice PARCIAL (`WHERE marketplace <> 'MERCADO_LIVRE'`), que o Prisma nao
 *   consegue expressar. Toda escrita de oferta nao-ML quebrava.
 *
 * O que o writer central garante, e o que aqui e testado:
 *
 *   ML    -> `upsert` por `marketplace_externalId` (unique REAL, sem predicado
 *            exigido porque `externalId` nunca e nulo nas linhas ML).
 *   nao-ML-> `findFirst` -> `update` por `id`, ou `create`. Nenhum `upsert`,
 *            portanto nenhum `ON CONFLICT` que o Postgres possa recusar.
 *
 * Nenhum teste aqui toca no banco: o `OfertaDb` e um duble que registra as
 * operações pedidas. A prova com Postgres de verdade (42P10 = 0, duas
 * listings ML no mesmo Product) fica em
 * `scripts/bootstrap/ml-listing-first-replay.integration.mjs`.
 */

type Operacao = { nome: string; args: unknown };

function criarDuble(
  respostas: {
    findUnique?: unknown;
    findMany?: unknown[];
    update?: unknown;
    create?: unknown;
    upsert?: unknown;
  } = {},
) {
  const operacoes: Operacao[] = [];

  const db = {
    marketplaceOffer: {
      async findUnique(args: unknown) {
        operacoes.push({ nome: "findUnique", args });
        return respostas.findUnique ?? null;
      },
      async findMany(args: unknown) {
        operacoes.push({ nome: "findMany", args });
        return respostas.findMany ?? [];
      },
      async update(args: unknown) {
        operacoes.push({ nome: "update", args });
        return respostas.update ?? { id: "linha-1" };
      },
      async create(args: unknown) {
        operacoes.push({ nome: "create", args });
        return respostas.create ?? { id: "linha-nova" };
      },
      async upsert(args: unknown) {
        operacoes.push({ nome: "upsert", args });
        return respostas.upsert ?? { id: "linha-ml" };
      },
    },
  } as unknown as OfertaDb;

  return { db, operacoes };
}

/** Serializa os argumentos pedidos para poder procurar `productId_marketplace`. */
function textoDasOperacoes(operacoes: Operacao[]): string {
  return JSON.stringify(operacoes);
}

const SELECT = { id: true, price: true } as const;

async function main(): Promise<void> {
  // CASO 1 — nao-ML: oferta ja existe -> `update` por `id`, e NUNCA `upsert`.
  {
    const { db, operacoes } = criarDuble({ findMany: [{ id: "linha-1" }] });

    await upsertOfertaListingAware({
      db,
      productId: "prod-1",
      marketplace: "SHOPEE",
      externalId: "S-1",
      update: { price: 10 },
      create: { externalId: "S-1", price: 10 },
      select: SELECT,
    });

    const nomes = operacoes.map((o) => o.nome);
    assert.deepEqual(
      nomes,
      ["findMany", "update"],
      `nao-ML existente: findFirst -> update, sem upsert (obtido ${nomes.join(",")})`,
    );

    const update = operacoes.find((o) => o.nome === "update");
    assert.deepEqual(
      (update?.args as { where: unknown }).where,
      { id: "linha-1" },
      "update nao-ML e por id, nao por compound unique",
    );
    console.log("NON_ML_UPDATE_BY_ID=PASS");
  }

  // CASO 2 — nao-ML: oferta nao existe -> `create`, e NUNCA `upsert`.
  {
    const { db, operacoes } = criarDuble({ findMany: [] });

    await upsertOfertaListingAware({
      db,
      productId: "prod-1",
      marketplace: "MAGAZINE_LUIZA",
      externalId: "M-1",
      update: { price: 20 },
      create: { externalId: "M-1", price: 20 },
      select: SELECT,
    });

    const nomes = operacoes.map((o) => o.nome);
    assert.deepEqual(
      nomes,
      ["findMany", "create"],
      `nao-ML ausente: findFirst -> create, sem upsert (obtido ${nomes.join(",")})`,
    );

    const leitura = operacoes.find((o) => o.nome === "findMany");
    assert.deepEqual(
      (leitura?.args as { where: unknown }).where,
      { productId: "prod-1", marketplace: "MAGAZINE_LUIZA" },
      "leitura nao-ML e por (productId, marketplace)",
    );
    assert.deepEqual(
      (leitura?.args as { orderBy: unknown }).orderBy,
      { createdAt: "asc" },
      "leitura nao-ML e deterministica (createdAt asc, take 1)",
    );
    console.log("NON_ML_CREATE_WHEN_ABSENT=PASS");
  }

  // CASO 3 — o bug original, fechado: NENHUMA operacao de escrita pode
  // mencionar a unique global que o banco nao tem.
  {
    const naoMl = criarDuble({ findMany: [] });
    await upsertOfertaListingAware({
      db: naoMl.db,
      productId: "prod-1",
      marketplace: "SHOPEE",
      externalId: "S-1",
      update: { price: 10 },
      create: { externalId: "S-1", price: 10 },
      select: SELECT,
    });

    const ml = criarDuble();
    await upsertOfertaListingAware({
      db: ml.db,
      productId: "prod-1",
      marketplace: "MERCADO_LIVRE",
      externalId: "MLB1234567890",
      update: { price: 30 },
      create: {
        externalId: "MLB1234567890",
        price: 30,
        identityVersion: 1,
        rawPayload: { listing: { item_id: "MLB1234567890" } },
      },
      select: SELECT,
    });

    assert.ok(
      !textoDasOperacoes([...naoMl.operacoes, ...ml.operacoes]).includes(
        "productId_marketplace",
      ),
      "nenhuma operacao pode usar a unique global removida (42P10)",
    );
    console.log("NO_PRODUCTID_MARKETPLACE_UNIQUE=PASS");
  }

  // CASO 4 — ML: identidade e o anuncio. Dois anuncios do MESMO Product sao
  // duas gravacoes distintas por `marketplace_externalId`.
  {
    const { db, operacoes } = criarDuble();

    await upsertOfertaListingAware({
      db,
      productId: "prod-1",
      marketplace: "MERCADO_LIVRE",
      externalId: "MLB1000000001",
      update: { price: 10 },
      create: { externalId: "MLB1000000001", price: 10 },
      select: SELECT,
    });

    await upsertOfertaListingAware({
      db,
      productId: "prod-1",
      marketplace: "MERCADO_LIVRE",
      externalId: "MLB1000000002",
      update: { price: 12 },
      create: { externalId: "MLB1000000002", price: 12 },
      select: SELECT,
    });

    const upserts = operacoes.filter((o) => o.nome === "upsert");
    assert.equal(
      upserts.length,
      2,
      "cada anuncio ML e uma gravacao propria",
    );
    assert.deepEqual(
      (upserts[0].args as { where: unknown }).where,
      { marketplace_externalId: { marketplace: "MERCADO_LIVRE", externalId: "MLB1000000001" } },
      "identidade ML e marketplace_externalId",
    );
    assert.deepEqual(
      (upserts[1].args as { where: unknown }).where,
      { marketplace_externalId: { marketplace: "MERCADO_LIVRE", externalId: "MLB1000000002" } },
      "o segundo anuncio nao colide com o primeiro",
    );
    assert.equal(
      operacoes.filter((o) => o.nome === "findMany").length,
      0,
      "ML nao depende de findFirst por Product (isso seria uma oferta so)",
    );
    console.log("ML_IDENTITY_IS_LISTING=PASS");
  }

  // CASO 5 — ML sem `externalId`: erro explicito. Escolher "a primeira" seria
  // inventar qual anuncio o Product representa.
  {
    const { db, operacoes } = criarDuble({ findMany: [{ id: "legada" }] });

    await assert.rejects(
      () =>
        upsertOfertaListingAware({
          db,
          productId: "prod-1",
          marketplace: "MERCADO_LIVRE",
          externalId: null,
          update: { price: 10 },
          create: { price: 10 },
          select: SELECT,
        }),
      /LISTING_FIRST/,
      "ML sem item_id nao grava",
    );
    assert.equal(
      operacoes.length,
      0,
      "nenhuma operacao e emitida quando a identidade ML falta",
    );
    console.log("ML_WITHOUT_ITEM_ID_REFUSED=PASS");
  }

  // CASO 6 — leitura: ML procura por anuncio; nao-ML por Product+Marketplace e
  // traz todas as linhas (o indice parcial garante no maximo uma fora do ML).
  {
    const ml = criarDuble();
    assert.equal(
      await findOfertaListingAware({
        db: ml.db,
        productId: "prod-1",
        marketplace: "MERCADO_LIVRE",
        externalId: "MLB1000000001",
        select: SELECT,
      }),
      null,
      "ML inexistente devolve null, nao erro",
    );
    assert.deepEqual(
      (ml.operacoes[0].args as { where: unknown }).where,
      { marketplace_externalId: { marketplace: "MERCADO_LIVRE", externalId: "MLB1000000001" } },
      "ML le por marketplace_externalId",
    );

    const mlSemId = criarDuble({ findMany: [{ id: "legada" }] });
    assert.equal(
      await findOfertaListingAware({
        db: mlSemId.db,
        productId: "prod-1",
        marketplace: "MERCADO_LIVRE",
        externalId: null,
        select: SELECT,
      }),
      null,
      "ML sem item_id nao escolhe nenhuma linha",
    );
    assert.equal(
      mlSemId.operacoes.length,
      0,
      "ML sem item_id nem chega a consultar o banco",
    );

    const naoMl = criarDuble({ findMany: [{ id: "a" }, { id: "b" }] });
    const todas = await listOfertasListingAware({
      db: naoMl.db,
      productId: "prod-1",
      marketplace: "SHOPEE",
      select: SELECT,
    });
    assert.equal(todas.length, 2, "list devolve todas as linhas do par");
    assert.ok(
      !("take" in (naoMl.operacoes[0].args as object)),
      "a listagem completa nao aplica take",
    );
    console.log("LISTING_AWARE_READ=PASS");
  }

  // CASO 7 — corrida de criacao: o perdedor leva P2002 do indice PARCIAL do
  // banco (ultima garantia). `withUniqueRaceRetry` refaz a UNIDADE INTEIRA uma
  // vez; na segunda volta o `findFirst` enxerga a linha vencedora e atualiza.
  {
    assert.equal(isUniqueConstraintViolation({ code: "P2002" }), true);
    assert.equal(isUniqueConstraintViolation({ code: "P2003" }), false);
    assert.equal(isUniqueConstraintViolation(new Error("42P10")), false);
    assert.equal(isUniqueConstraintViolation(null), false);

    let voltas = 0;
    const resultado = await withUniqueRaceRetry(async () => {
      voltas += 1;

      if (voltas === 1) {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }

      return "atualizou";
    });

    assert.equal(voltas, 2, "P2002 consome exatamente um retry");
    assert.equal(resultado, "atualizou");

    let semP2002 = 0;
    await assert.rejects(
      () =>
        withUniqueRaceRetry(async () => {
          semP2002 += 1;
          throw Object.assign(new Error("42P10"), { code: "P2002_INEXISTENTE" });
        }),
      /42P10/,
      "erro que nao e P2002 sobe intacto",
    );
    assert.equal(semP2002, 1, "nao-P2002 nao e reprocessado");

    let sempre = 0;
    await assert.rejects(
      () =>
        withUniqueRaceRetry(async () => {
          sempre += 1;
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }),
      /unique/,
      "P2002 persistente sobe; nao ha loop infinito nem escrita silenciosa",
    );
    assert.equal(sempre, 2, "no maximo duas tentativas");
    console.log("UNIQUE_RACE_RETRY_BOUNDS=PASS");
  }

  // CASO 8 — o caminho real da corrida: primeira volta `create` leva P2002,
  // segunda volta `findFirst` acha a linha e o writer atualiza.
  {
    const { operacoes } = criarDuble({
      findMany: [],
      create: { id: "vencedora" },
      update: { id: "vencedora" },
    });

    let jaExiste = false;
    const dbComCorrida = {
      marketplaceOffer: {
        async findUnique(args: unknown) {
          operacoes.push({ nome: "findUnique", args });
          return null;
        },
        async findMany(args: unknown) {
          operacoes.push({ nome: "findMany", args });
          return jaExiste ? [{ id: "vencedora" }] : [];
        },
        async create(args: unknown) {
          operacoes.push({ nome: "create", args });
          if (!jaExiste) {
            // A outra transacao grava entre o findFirst e o create.
            jaExiste = true;
            throw Object.assign(new Error("unique"), { code: "P2002" });
          }
          return { id: "vencedora" };
        },
        async update(args: unknown) {
          operacoes.push({ nome: "update", args });
          return { id: "vencedora" };
        },
        async upsert(args: unknown) {
          operacoes.push({ nome: "upsert", args });
          return { id: "linha-ml" };
        },
      },
    } as unknown as OfertaDb;

    const gravacao = async () =>
      upsertOfertaListingAware({
        db: dbComCorrida,
        productId: "prod-1",
        marketplace: "SHOPEE",
        externalId: "S-1",
        update: { price: 11 },
        create: { externalId: "S-1", price: 10 },
        select: SELECT,
      });

    const linha = await withUniqueRaceRetry(gravacao);

    assert.equal(linha.id, "vencedora", "a segunda volta atualiza a linha vencedora");
    assert.deepEqual(
      operacoes.map((o) => o.nome),
      ["findMany", "create", "findMany", "update"],
      "corrida: create perdedor -> retry -> update da linha vencedora",
    );
    assert.ok(
      !textoDasOperacoes(operacoes).includes("productId_marketplace"),
      "a corrida tambem nao usa a unique global",
    );
    console.log("RACE_CONVERGES_TO_WINNER=PASS");
  }

  console.log(
    "marketplaceOfferWriter.partialUnique: todos os casos passaram",
  );

}

void main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
