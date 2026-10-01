/**
 * RECONCILIADOR DA MELHOR OFERTA (`isBest` / `Product.price`).
 *
 * ============================================================================
 * O QUE ELE FAZ
 * ============================================================================
 * Encontra `Product` cuja oferta marcada `isBest=true` é REJEITADA pela
 * política pública (`isOfertaPublicavelNoMarketplace`), embora exista ao
 * menos uma oferta publicável no produto. Foi esse estado que fez o site
 * anunciar "Melhor preço" num valor sem CTA (oferta ML de CATÁLOGO, `/p/`).
 *
 * ============================================================================
 * O QUE ELE NÃO FAZ
 * ============================================================================
 * - NÃO reimplementa a regra. A correção chama a função CANÔNICA
 *   `sincronizarMelhorOfertaDoProduto` (src/services/database/saveProduct.ts),
 *   a MESMA usada no caminho de escrita normal (import, monitor, revisão).
 *   Este arquivo apenas SELECIONA o alvo e reporta antes/depois; não há
 *   `UPDATE` manual de `isBest` nem de `price`.
 * - NÃO apaga nada: nenhum Product, MarketplaceOffer ou PriceHistory.
 * - NÃO muda `marketplace`/`externalId`/`productId` de nenhuma oferta.
 * - DEFAULT é DRY-RUN. Sem `--apply`, o número de escritas é ZERO por
 *   construção (o caminho de escrita só é alcançado dentro de `if (aplicar)`).
 * - `--apply` exige `--product-id`: nada de bulk cego.
 *
 * USO
 *   npx tsx --env-file=.env.local src/scripts/reconcile-best-offer.ts
 *   npx tsx --env-file=.env.local src/scripts/reconcile-best-offer.ts \
 *     --apply --product-id=<uuid>
 */

import prisma from "../lib/prisma";
import { sincronizarMelhorOfertaDoProduto } from "../services/database/saveProduct";
import { isOfertaPublicavelNoMarketplace } from "../services/publicVisibility/multiStoreVisibility";

type Args = {
  aplicar: boolean;
  productId?: string;
  limite: number;
};

export function parseBestOfferArgs(argv: string[]): Args {
  const valor = (nome: string) => {
    const prefixo = `--${nome}=`;
    const bruto = argv.find((arg) => arg.startsWith(prefixo));
    return bruto ? bruto.slice(prefixo.length) : undefined;
  };

  const limiteBruto = valor("limit");
  const limite = limiteBruto === undefined ? 1 : Number(limiteBruto);

  if (!Number.isInteger(limite) || limite < 1) {
    throw new Error(`--limit invalido: ${limiteBruto}`);
  }

  const aplicar = argv.includes("--apply");
  const productId = valor("product-id")?.trim() || undefined;

  if (aplicar && !productId && limiteBruto === undefined) {
    throw new Error(
      "--apply sem --product-id exige --limit explicito (nada de bulk cego)",
    );
  }

  return { aplicar, productId, limite };
}

const SELECT_OFERTAS = {
  id: true,
  marketplace: true,
  externalId: true,
  sourceUrl: true,
  price: true,
  isBest: true,
  active: true,
  available: true,
  status: true,
  matchStatus: true,
} as const;

export async function listarProdutosAlvo(
  productId: string | undefined,
  limite: number,
) {
  const produtos = await prisma.product.findMany({
    where: productId ? { id: productId } : {},
    select: {
      id: true,
      name: true,
      price: true,
      store: true,
      active: true,
      publicationStatus: true,
      offers: {
        where: { active: true, matchStatus: "EXACT" },
        select: SELECT_OFERTAS,
      },
    },
    take: productId ? 1 : limite * 50,
  });

  return produtos
    .map((produto) => {
      const best = produto.offers.find((oferta) => oferta.isBest) ?? null;
      const publicaveis = produto.offers.filter(isOfertaPublicavelNoMarketplace);

      if (!best || isOfertaPublicavelNoMarketplace(best)) {
        return null;
      }

      if (publicaveis.length === 0) {
        return null;
      }

      const melhorPublicavel = publicaveis
        .slice()
        .sort((a, b) => a.price - b.price)[0];

      return {
        produto,
        best,
        melhorPublicavel,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, limite);
}

async function main() {
  const args = parseBestOfferArgs(process.argv.slice(2));

  console.log(`BEST_OFFER_RECONCILE_MODE=${args.aplicar ? "APPLY" : "DRY_RUN"}`);

  const alvos = await listarProdutosAlvo(args.productId, args.limite);

  console.log(`TARGETS=${alvos.length}`);

  for (const alvo of alvos) {
    console.log(
      [
        "TARGET",
        alvo.produto.id,
        `name=${JSON.stringify(alvo.produto.name)}`,
        `currentBest=${alvo.best.marketplace}:${alvo.best.price}`,
        `sourceUrl=${JSON.stringify(alvo.best.sourceUrl)}`,
        `expectedBest=${alvo.melhorPublicavel.marketplace}:${alvo.melhorPublicavel.price}`,
        `productPrice=${alvo.produto.price}`,
      ].join(" "),
    );
  }

  if (!args.aplicar) {
    console.log("WRITES=0 (dry-run)");
    return;
  }

  let escritas = 0;

  for (const alvo of alvos) {
    await prisma.$transaction(async (tx) => {
      await sincronizarMelhorOfertaDoProduto(tx, alvo.produto.id);
    });

    const depois = await prisma.product.findUnique({
      where: { id: alvo.produto.id },
      select: {
        price: true,
        store: true,
        active: true,
        publicationStatus: true,
        offers: { select: { id: true, isBest: true, price: true } },
      },
    });

    const bestDepois =
      depois?.offers.find((oferta) => oferta.isBest)?.id ?? null;

    console.log(
      [
        "APPLIED",
        alvo.produto.id,
        `price=${depois?.price}`,
        `store=${JSON.stringify(depois?.store)}`,
        `publicationStatus=${depois?.publicationStatus}`,
        `active=${depois?.active}`,
        `bestOfferId=${bestDepois}`,
      ].join(" "),
    );

    if (bestDepois !== alvo.best.id) {
      escritas += 1;
    }
  }

  console.log(`BEST_OFFER_CHANGED=${escritas}`);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
