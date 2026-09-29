/**
 * CANÁRIO DO GERADOR ML — dry-run, uma oferta, sem escrita no banco.
 *
 * Existe para separar três coisas que uma lista vazia não distingue:
 *   CHROME_NOT_RUNNING  → infraestrutura ausente
 *   AUTH_REQUIRED       → Chrome ok, mas sem sessão de afiliado
 *   SUCCESS             → link gerado e validado contra o MLB esperado
 *
 * Nunca grava. O worker com dryRun=true gera e valida, mas não aplica.
 */
import prismaMod from "../lib/prisma";
import { generateMercadoLivreAffiliateLink } from "../services/affiliates/mercadolivre/generator";
import { createPrismaMercadoLivrePendingStore } from "../services/affiliates/mercadolivre/pending";
import { confirmarAffiliateLinkMercadoLivre } from "../lib/affiliates/publicPurchase";

const prisma = ((prismaMod as any)?.default ?? prismaMod) as any;

async function main() {
  const store = createPrismaMercadoLivrePendingStore(prisma);
  const pending = await store.listPendingMercadoLivreOffers(1);
  console.log(`FILA=${pending.length}`);

  if (pending.length === 0) {
    console.log("NADA_A_FAZER");
    await prisma.$disconnect();
    return;
  }

  const item = pending[0];
  console.log(`OFERTA=${item.offerId} MLB=${item.externalId}`);
  console.log(`ORIGEM=${item.sourceUrl}`);
  console.log("---");

  const outcome = await generateMercadoLivreAffiliateLink({
    sourceUrl: item.sourceUrl!,
    expectedItemId: item.externalId,
    log: (m: string) => console.log(`  [gen] ${m}`),
  });

  console.log("---");
  console.log(`STATUS=${outcome.status}`);
  if (outcome.status !== "SUCCESS") {
    console.log(`MOTIVO=${"reason" in outcome ? outcome.reason : ""}`);
  } else {
    // Redigido: o link carrega token de afiliado. Só forma e validação.
    const u = new URL(outcome.affiliateUrl);
    console.log(`HOST=${u.hostname}`);
    console.log(
      `MELI_LA=${u.hostname === "meli.la" || u.hostname.endsWith(".meli.la")}`,
    );
    console.log(
      `PASSA_VALIDACAO_PRODUCAO=${Boolean(
        confirmarAffiliateLinkMercadoLivre({
          affiliateLink: outcome.affiliateUrl,
          sourceUrl: item.sourceUrl,
        }),
      )}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FALHOU:", e instanceof Error ? e.message : e);
  process.exit(1);
});
