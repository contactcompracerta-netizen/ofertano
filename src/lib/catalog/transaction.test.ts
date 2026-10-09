/**
 * CATALOG_WAVE 1 - FASE N/K: unidade transacional + rollback.
 *
 * Falha na Offer depois da criação do Product => rollback total.
 * Nenhum órfão. NoWriteGateway recusa qualquer escrita.
 */
import { InMemoryCatalogGateway, NoWriteGateway } from "./transaction";

let passed = 0;
function ok(cond: boolean, label: string): void {
  if (!cond) {
    throw new Error(`FAIL: ${label}`);
  }
  passed += 1;
}
async function expectReject(p: Promise<unknown>, label: string): Promise<void> {
  try {
    await p;
  } catch {
    passed += 1;
    return;
  }
  throw new Error(`FAIL: ${label} deveria falhar`);
}

const productDraft = {
  name: "Mouse Gamer Logitech G305",
  brand: "Logitech",
  gtin: "4006381333931",
  store: "kabum",
  price: 249.9,
  currency: "BRL",
  imageUrl: "https://cdn.example-img.test/kabum/g305-1.jpg",
  source: "AWIN",
  merchant: "kabum",
  externalId: "KBM-1001",
};

const offerDraft = {
  productId: "",
  merchant: "kabum",
  externalId: "KBM-1001",
  price: 249.9,
  title: "Mouse Gamer Logitech G305",
  sourceUrl: "https://www.kabum.com.br/produto/1001/mouse-logitech-g305",
  affiliateUrl: "https://example-awin.test/cread.php?awinmid=1",
};

async function main(): Promise<void> {
  /* --- Sucesso: Product + Offer persistem -------------------------------- */
  const gw = new InMemoryCatalogGateway();
  const created = await gw.transaction(async (ops) => {
    const product = await ops.createProduct(productDraft);
    const offer = await ops.createOffer({ ...offerDraft, productId: product.id });
    return { productId: product.id, offerId: offer.id };
  });
  ok(gw.countProducts() === 1, "sucesso: 1 product");
  ok(gw.countOffers() === 1, "sucesso: 1 offer");
  ok(created.productId.startsWith("prod_"), "id de product gerado");
  ok(created.offerId.startsWith("off_"), "id de offer gerado");
  ok(gw.writeAttempts === 2, "2 tentativas de escrita");

  /* --- Rollback: falha na Offer após criar Product ------------------------ */
  const gw2 = new InMemoryCatalogGateway();
  gw2.failNextOfferCreation = true;
  await expectReject(
    gw2.transaction(async (ops) => {
      const product = await ops.createProduct(productDraft);
      await ops.createOffer({ ...offerDraft, productId: product.id });
      return undefined;
    }),
    "transação com offer falhando",
  );
  ok(gw2.countProducts() === 0, "ROLLBACK: product órfão NÃO persiste");
  ok(gw2.countOffers() === 0, "ROLLBACK: nenhuma offer persiste");

  /* Estado pré-falha intacta: nova transação funciona normalmente */
  const okAfter = await gw2.transaction(async (ops) => {
    const product = await ops.createProduct(productDraft);
    await ops.createOffer({ ...offerDraft, productId: product.id });
    return true;
  });
  ok(okAfter === true, "transação seguinte funciona");
  ok(
    gw2.countProducts() === 1 && gw2.countOffers() === 1,
    "estado consistente após recuperação",
  );

  /* --- Rollback em transação múltipla: falha na 2ª offer ------------------ */
  const gw3 = new InMemoryCatalogGateway();
  await expectReject(
    gw3.transaction(async (ops) => {
      const p1 = await ops.createProduct(productDraft);
      await ops.createOffer({ ...offerDraft, productId: p1.id });
      await ops.createProduct({ ...productDraft, externalId: "KBM-2002" });
      gw3.failNextOfferCreation = true;
      await ops.createOffer({ ...offerDraft, productId: "x" });
      return undefined;
    }),
    "segunda offer falha",
  );
  ok(gw3.countProducts() === 0, "ROLLBACK completo: 2º product também sai");
  ok(gw3.countOffers() === 0, "ROLLBACK completo: 1ª offer também sai");

  /* --- updateOffer inexistente => falha + rollback ------------------------ */
  const gw4 = new InMemoryCatalogGateway();
  await expectReject(
    gw4.transaction(async (ops) => {
      await ops.createProduct(productDraft);
      await ops.updateOffer("off_missing", { price: 199.9 });
      return undefined;
    }),
    "updateOffer de offer inexistente",
  );
  ok(gw4.countProducts() === 0, "ROLLBACK: product revertido quando update falha");

  /* --- updateOffer real altera preço -------------------------------------- */
  const gw5 = new InMemoryCatalogGateway();
  const ids = await gw5.transaction(async (ops) => {
    const p = await ops.createProduct(productDraft);
    const o = await ops.createOffer({ ...offerDraft, productId: p.id });
    return { pid: p.id, oid: o.id };
  });
  await gw5.transaction(async (ops) => {
    await ops.updateOffer(ids.oid, { price: 199.9 });
    return undefined;
  });
  const offer5 = gw5.snapshotOffers()[0];
  ok(offer5.price === 199.9, "updateOffer altera preço");

  /* --- NoWriteGateway recusa tudo ----------------------------------------- */
  const noWrite = new NoWriteGateway();
  await expectReject(
    noWrite.transaction(async (ops) => {
      await ops.createProduct(productDraft);
      return undefined;
    }),
    "NoWriteGateway",
  );

  console.log(`transaction.test.ts PASS (${passed} asserções)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
