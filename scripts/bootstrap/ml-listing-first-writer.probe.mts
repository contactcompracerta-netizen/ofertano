/**
 * Prova de 42P10: o writer central contra um PostgreSQL de verdade.
 *
 * Reproduz o defeito real e mostra que ele sumiu.
 *
 * Defeito: com `@@unique([productId, marketplace])` no schema, o Prisma gerava
 * `ON CONFLICT ("productId","marketplace") DO UPDATE`. Como a garantia do banco
 * e um indice PARCIAL (`WHERE marketplace <> 'MERCADO_LIVRE'`), o Postgres
 * respondia 42P10 e nenhuma escrita de oferta nao-ML passava.
 *
 * Aqui: duas gravacoes Shopee do MESMO Product (o caminho que quebrava) e duas
 * listings ML do mesmo Product (o que a garantia parcial permite) rodam pelo
 * `upsertOfertaListingAware` de verdade, contra o banco descartavel do replay.
 *
 * Nao toca producao: o alvo vem por argv e precisa estar em 127.0.0.1:55433.
 */

import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { upsertOfertaListingAware } from "@/services/database/marketplaceOfferWriter";

const target = process.argv[2];

if (!target) {
  console.error("TARGET_ABSENT");
  process.exit(1);
}

const url = new URL(target);
assert.equal(
  url.hostname,
  "127.0.0.1",
  "PROBE_TEACHER_TRIPWIRE: alvo nao local",
);
assert.equal(url.port, "55433", "PROBE_TEACHER_TRIPWIRE: porta errada");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target }) });

/** Conta violacoes 42P10 sem esconder nenhuma outra falha. */
let violacoes42P10 = 0;
let outrasFalhas = 0;

async function medir<T>(rotulo: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (erro) {
    const codigo = (erro as { code?: string }).code;
    const mensagem = erro instanceof Error ? erro.message : String(erro);

    if (codigo === "P2002" && /non_ml_product_marketplace/.test(mensagem)) {
      violacoes42P10 += 1;
    } else if (mensagem.includes("42P10")) {
      violacoes42P10 += 1;
    } else {
      outrasFalhas += 1;
      console.error(`${rotulo}: ${codigo ?? ""} ${mensagem}`);
      throw erro;
    }

    throw erro;
  }
}

async function main(): Promise<void> {
  const productId = "p-writer-probe";

  await prisma.$transaction(async (tx) => {
    await tx.marketplaceOffer.deleteMany({ where: { productId } });
    await tx.product.deleteMany({ where: { id: productId } });
    await tx.product.create({
      data: {
        id: productId,
        name: "Probe 42P10",
        image: "",
        images: [],
        category: "Probe",
        store: "Probe",
        affiliateLink: "",
        price: 10,
      },
    });
  });

  const gravar = (marketplace: "SHOPEE" | "MERCADO_LIVRE", externalId: string, price: number) =>
    medir(`${marketplace}/${externalId}`, () =>
      prisma.$transaction((tx) =>
        upsertOfertaListingAware({
          db: tx,
          productId,
          marketplace,
          externalId,
          update: { price },
          create: {
            externalId,
            title: `Probe ${externalId}`,
            price,
            identityVersion: marketplace === "MERCADO_LIVRE" ? 1 : 0,
            ...(marketplace === "MERCADO_LIVRE"
              ? {
                  catalogProductId: "MLB9876543210",
                  rawPayload: { listing: { item_id: externalId } },
                }
              : { sourceUrl: `https://probe.test/${externalId}` }),
          },
        }),
      ),
    );

  // O caminho que quebrava: a MESMA oferta nao-ML gravada duas vezes.
  // A segunda vez e um UPDATE por id, nao um upsert sobre unique global.
  await gravar("SHOPEE", "S-PROBE-1", 10);
  await gravar("SHOPEE", "S-PROBE-1", 12);
  await gravar("SHOPEE", "S-PROBE-1", 11);

  /*
   * Um externalId nao-ML DIFERENTE no mesmo Product nao cria uma segunda
   * linha: a identidade fora do ML e (productId, marketplace), entao o writer
   * encontra a linha existente e atualiza. E o que o indice parcial permite
   * (no maximo uma) e o que evita que o scraper acumule oferta duplicada de
   * anuncio trocado.
   */
  await gravar("SHOPEE", "S-PROBE-2", 20);
  const aposTroca = await prisma.marketplaceOffer.findFirst({
    where: { productId, marketplace: "SHOPEE" },
  });
  assert.equal(
    aposTroca?.price,
    20,
    "a oferta nao-ML do produto continua sendo uma unica linha",
  );
  assert.equal(
    aposTroca?.externalId,
    "S-PROBE-1",
    "o externalId nao-ML nao e substituido (a oferta nao troca de anuncio)",
  );

  // Duas listings ML do MESMO Product:identityVersion 1 com evidencia.
  await gravar("MERCADO_LIVRE", "MLB1000000001", 100);
  await gravar("MERCADO_LIVRE", "MLB1000000002", 200);
  await gravar("MERCADO_LIVRE", "MLB1000000001", 105);

  const shopee = await prisma.marketplaceOffer.count({
    where: { productId, marketplace: "SHOPEE" },
  });
  const ml = await prisma.marketplaceOffer.count({
    where: { productId, marketplace: "MERCADO_LIVRE" },
  });

  await prisma.$transaction(async (tx) => {
    await tx.marketplaceOffer.deleteMany({ where: { productId } });
    await tx.product.deleteMany({ where: { id: productId } });
  });

  assert.equal(violacoes42P10, 0, `42P10 observado ${violacoes42P10}x`);
  assert.equal(outrasFalhas, 0, `falhas inesperadas: ${outrasFalhas}`);

  console.log("WRITER_42P10_COUNT=0");
  console.log(`WRITER_SHOPEE_ROWS=${shopee}`);
  console.log(`WRITER_ML_ROWS=${ml}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (erro) => {
    console.error(erro);
    await prisma.$disconnect();
    process.exit(1);
  });
