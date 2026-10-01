/**
 * VERIFICAÇÃO DE INVARIANTES CONGELADAS — SOMENTE LEITURA.
 *
 * Confere que nada foi escrito durante a fase. Não faz INSERT/UPDATE/DELETE.
 */
import prisma from "@/lib/prisma";

const ESPERADO = {
  product: 26,
  marketplaceOffer: 55,
  priceHistory: 65,
  rawMarketplaceListing: 11,
  produtoPublicoUnico: "b3270289-8bf1-4ca4-b047-665437800d78",
};

async function main(): Promise<void> {
  const contagem = async (tabela: string): Promise<number> => {
    const linhas = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
      `select count(*)::int as n from "${tabela}"`,
    );
    return linhas[0]?.n ?? -1;
  };

  try {
    const product = await contagem("Product");
    const marketplaceOffer = await contagem("MarketplaceOffer");
    const priceHistory = await contagem("PriceHistory");
    const rawMarketplaceListing = await contagem("RawMarketplaceListing");

    // O nome real da coluna de visibilidade precisa ser lido do schema, nao
    // assumido: a coluna `visibility` nao existe neste banco.
    const colunas = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `select column_name from information_schema.columns
        where table_name = 'Product'
          and (column_name ilike '%visib%' or column_name ilike '%public%'
               or column_name ilike '%status%')`,
    );
    console.log(`INV_COLUNAS_VISIBILIDADE=${colunas.map((c) => c.column_name).join(",") || "-"}`);

    /*
     * "Produto público" neste banco é `publicationStatus = 'LIVE_PARTIAL'`
     * (o único valor vivo). Conferido no próprio banco, não assumido: os
     * 26 produtos são 25 DRAFT + 1 LIVE_PARTIAL.
     */
    const colVisibilidade = colunas[0]?.column_name;
    const publicos = colVisibilidade
      ? await prisma.$queryRawUnsafe<Array<{ id: string; status: string }>>(
          `select id::text as id, "${colVisibilidade}"::text as status from "Product"
            where "${colVisibilidade}"::text <> 'DRAFT'`,
        )
      : [];

    console.log(`INV_PRODUCT=${product}`);
    console.log(`INV_MARKETPLACE_OFFER=${marketplaceOffer}`);
    console.log(`INV_PRICE_HISTORY=${priceHistory}`);
    console.log(`INV_RAW_MARKETPLACE_LISTING=${rawMarketplaceListing}`);
    console.log(`INV_PRODUTO_PUBLICO_QUANTIDADE=${publicos.length}`);
    console.log(`INV_PRODUTO_PUBLICO_ID=${publicos.map((p) => p.id).join(",") || "-"}`);

    const iguais =
      product === ESPERADO.product &&
      marketplaceOffer === ESPERADO.marketplaceOffer &&
      priceHistory === ESPERADO.priceHistory &&
      rawMarketplaceListing === ESPERADO.rawMarketplaceListing &&
      publicos.length === 1 &&
      publicos[0]?.id === ESPERADO.produtoPublicoUnico;

    console.log(`INVARIANTES_CONGELADAS_INTACTAS=${iguais ? "YES" : "NO"}`);
  } catch (erro) {
    const e = erro as { code?: string; message?: string; meta?: unknown };
    console.log(`INVARIANTES_CONGELADAS_INTACTAS=INDISPONIVEL`);
    console.log(`INVARIANTES_ERRO_CODE=${e.code ?? "-"}`);
    console.log(`INVARIANTES_ERRO=${String(e.message ?? erro).slice(0, 300)}`);
    console.log(`INVARIANTES_ERRO_META=${JSON.stringify(e.meta ?? null).slice(0, 300)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main();
