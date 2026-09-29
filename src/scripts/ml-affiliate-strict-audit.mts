/**
 * AUDITORIA DE ALVO EXATO — Mercado Livre. READ ONLY, sem escrita.
 *
 * Para cada oferta ML elegível, responde:
 *   - o que a oferta pretende monetizar (o anúncio, via externalId)
 *   - o que a sourceUrl realmente entrega (catálogo ou anúncio)
 *   - se um link de afiliado derivado da sourceUrl passaria na validação
 *     ESTRITA — a resposta honesta é "não" para o caso de catálogo, e é isso
 *     que justifica a hidratação via getItem.
 *
 * Não gera link, não autentica, não grava. Serve para medir o tamanho do
 * problema antes do backfill, não para substituí-lo.
 */
import prismaMod from "../lib/prisma";
import { canonicalizarMlb } from "../services/affiliates/mercadolivre/itemHydration";
import {
  extractCatalogMlId,
  validateExactOfferTarget,
} from "../services/affiliates/mercadolivre/strictTarget";
import { resolveTargetMeta } from "../services/affiliates/mercadolivre/generator";

const prisma = ((prismaMod as any)?.default ?? prismaMod) as any;

async function main() {
  const rows: Array<{
    id: string;
    externalId: string | null;
    sourceUrl: string | null;
  }> = await prisma.marketplaceOffer.findMany({
    where: {
      marketplace: "MERCADO_LIVRE",
      active: true,
      available: true,
      status: { notIn: ["UNAVAILABLE", "ERROR"] },
    },
    select: { id: true, externalId: true, sourceUrl: true },
    orderBy: { createdAt: "asc" },
  });

  let comExternalId = 0;
  let semExternalId = 0;
  let sourceUrlCatalogo = 0;
  let sourceUrlAnuncio = 0;
  let divergente = 0;
  // A sourceUrl, se fosse usada como destino, passaria na validação estrita?
  let passariaEstrito = 0;
  let falhariaEstrito = 0;
  const semProvaDeAnuncio: string[] = [];

  for (const r of rows) {
    if (!r.externalId) {
      semExternalId += 1;
      continue;
    }
    comExternalId += 1;

    const esperado = canonicalizarMlb(r.externalId);
    const meta = r.sourceUrl ? resolveTargetMeta(r.sourceUrl) : { catalogId: null, itemId: null };
    const catalogo = r.sourceUrl ? extractCatalogMlId(r.sourceUrl) : null;

    if (catalogo) sourceUrlCatalogo += 1;
    else if (meta.itemId) sourceUrlAnuncio += 1;

    if (catalogo && catalogo !== esperado) divergente += 1;

    if (r.sourceUrl) {
      const v = validateExactOfferTarget(r.sourceUrl, esperado);
      if (v.ok) passariaEstrito += 1;
      else {
        falhariaEstrito += 1;
        semProvaDeAnuncio.push(esperado);
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        gerado_em: new Date().toISOString(),

        ML_PENDING: rows.length,
        ML_COM_EXTERNAL_ID: comExternalId,
        ML_SEM_EXTERNAL_ID: semExternalId,

        ML_SOURCE_URL_CATALOGO: sourceUrlCatalogo,
        ML_SOURCE_URL_ANUNCIO: sourceUrlAnuncio,
        ML_EXTERNAL_ID_CATALOG_ID_DIVERGENT: divergente,

        // O número que decide a entrada do Link Builder: sem isto, 100% das
        // ofertas alimentariam o gerador com página de catálogo.
        ML_SOURCE_URL_PASSARIA_VALIDACAO_ESTRITA: passariaEstrito,
        ML_SOURCE_URL_FALHARIA_VALIDACAO_ESTRITA: falhariaEstrito,

        EXACT_ITEM_HYDRATION_REQUIRED: rows.length - semExternalId,
        EXACT_ITEM_HYDRATION_IMPOSSIVEL_SEM_EXTERNAL_ID: semExternalId,

        NOTA:
          "A sourceUrl nunca é usada como link de afiliado. Este bloco mede " +
          "se ela serviria de DESTINO, para dimensionar o quanto a hidratação " +
          "via getItem é necessária.",
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("FALHOU:", e instanceof Error ? e.message : e);
  process.exit(1);
});
