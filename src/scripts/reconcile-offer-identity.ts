/**
 * RECONCILIADOR DE IDENTIDADE DE OFERTA (variante conflitante).
 *
 * ============================================================================
 * O QUE ELE FAZ
 * ============================================================================
 * Reavalia, pela política CENTRAL de identidade, as ofertas EXACT de produtos
 * PÚBLICOS. Quando o Exact Matcher atual diz que a oferta NÃO é EXACT por
 * conflito de VARIANTE (ex.: produto "Cinza" com oferta "Azul" — Catalog
 * Release 01), a oferta é rebaixada pelo caminho canônico
 * (`rejeitarOfertaExistenteReavaliada`), que também ressincroniza a melhor
 * oferta do produto.
 *
 * O caso real: `4ef6e39a…` (Mouse Logitech M170 Cinza) comparava uma oferta
 * "Azul - 910-004800" do Magazine Luiza. O `canonicalKey` ignora cor de
 * propósito (índice de busca), mas o Exact Matcher é a AUTORIZAÇÃO de merge e
 * trata cor explícita diferente como não-EXACT desde o Catalog Release 01. A
 * oferta EXACT persistida é legada e contradiz a política vigente.
 *
 * ============================================================================
 * O QUE ELE NÃO FAZ
 * ============================================================================
 * - NÃO reimplementa o matcher: usa `resolverIdentidadeProduto` +
 *   `avaliarIdentidadesExatas` (política central).
 * - NÃO faz UPDATE manual: usa `rejeitarOfertaExistenteReavaliada`, a mesma
 *   função do pipeline de comparação, que só toca
 *   matchStatus/matchScore/reviewReason/isBest/reviewedAt.
 * - NÃO apaga nada: Product, MarketplaceOffer e PriceHistory permanecem.
 * - NÃO avalia produto sem marca+modelo, nem oferta sem modelo, nem título
 *   vazio: nesses casos falta evidência e a oferta é preservada (fail-safe).
 * - NÃO sai de conflito de VARIANTE: outros motivos de não-EXACT são apenas
 *   reportados, nunca aplicados por este script.
 * - DEFAULT é DRY-RUN. `--apply` exige `--product-id` (nada de lote cego).
 *
 * USO
 *   npx tsx --env-file=.env.local src/scripts/reconcile-offer-identity.ts \
 *     --product-id=<uuid>
 *   npx tsx --env-file=.env.local src/scripts/reconcile-offer-identity.ts \
 *     --apply --product-id=<uuid>
 */

import type { Marketplace } from "@prisma/client";

import prisma from "../lib/prisma";
import { rejeitarOfertaExistenteReavaliada } from "../services/comparison/manualComparison";
import { sincronizarMelhorOfertaDoProduto } from "../services/database/saveProduct";
import { avaliarIdentidadesExatas } from "../services/identity/exactMatcher";
import { resolverIdentidadeProduto } from "../services/identity/resolver";

type Args = {
  aplicar: boolean;
  productId?: string;
  limite: number;
};

export function parseOfferIdentityArgs(argv: string[]): Args {
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

  if (aplicar && !productId) {
    throw new Error("--apply exige --product-id (nada de escrita em lote)");
  }

  return { aplicar, productId, limite };
}

const identidadeDoProduto = (produto: {
  name: string;
  canonicalName: string | null;
  brand: string | null;
}) =>
  resolverIdentidadeProduto({
    title: produto.canonicalName?.trim() || produto.name,
    brand: produto.brand,
    attributes: {},
  });

const identidadeDaOferta = (titulo: string | null) =>
  resolverIdentidadeProduto({
    title: (titulo ?? "").trim(),
    brand: null,
    attributes: {},
  });

export async function listarConflitosDeVariante(
  productId: string | undefined,
  limite: number,
) {
  const produtos = await prisma.product.findMany({
    where: {
      active: true,
      publicationStatus: { in: ["LIVE_PARTIAL", "LIVE_COMPLETE"] },
      ...(productId ? { id: productId } : {}),
    },
    select: {
      id: true,
      name: true,
      canonicalName: true,
      brand: true,
      color: true,
      offers: {
        where: { active: true, matchStatus: "EXACT" },
        select: {
          id: true,
          marketplace: true,
          externalId: true,
          title: true,
          price: true,
          matchStatus: true,
        },
      },
    },
    take: limite,
  });

  const conflitos: Array<{
    productId: string;
    offerId: string;
    marketplace: Marketplace;
    externalId: string | null;
    titulo: string;
    motivo: string;
    preco: number;
  }> = [];

  for (const produto of produtos) {
    const identidadeProduto = identidadeDoProduto(produto);

    /*
     * Fail-safe: sem marca E modelo do lado do produto, não há evidência para
     * rejeitar nada. A oferta é preservada.
     */
    if (!identidadeProduto.brand || !identidadeProduto.model) {
      continue;
    }

    for (const oferta of produto.offers) {
      const titulo = (oferta.title ?? "").trim();

      if (!titulo) {
        continue;
      }

      const identidadeOferta = identidadeDaOferta(titulo);

      if (!identidadeOferta.model) {
        continue;
      }

      const veredito = avaliarIdentidadesExatas(
        identidadeProduto,
        identidadeOferta,
      );

      if (veredito.exact || !/variante/i.test(veredito.reason)) {
        continue;
      }

      conflitos.push({
        productId: produto.id,
        offerId: oferta.id,
        marketplace: oferta.marketplace as Marketplace,
        externalId: oferta.externalId,
        titulo,
        motivo: veredito.reason,
        preco: oferta.price,
      });
    }
  }

  return conflitos;
}

async function main() {
  const args = parseOfferIdentityArgs(process.argv.slice(2));

  console.log(
    `OFFER_IDENTITY_RECONCILE_MODE=${args.aplicar ? "APPLY" : "DRY_RUN"}`,
  );

  const conflitos = await listarConflitosDeVariante(
    args.productId,
    args.limite,
  );

  console.log(`VARIANT_CONFLICTS=${conflitos.length}`);

  for (const conflito of conflitos) {
    console.log(
      [
        "CONFLICT",
        conflito.productId,
        conflito.marketplace,
        conflito.externalId ?? "<null>",
        `price=${conflito.preco}`,
        `title=${JSON.stringify(conflito.titulo)}`,
        `reason=${JSON.stringify(conflito.motivo)}`,
      ].join(" "),
    );
  }

  if (!args.aplicar) {
    console.log("WRITES=0 (dry-run)");
    return;
  }

  let rejeitadas = 0;

  for (const conflito of conflitos) {
    const aplicado = await rejeitarOfertaExistenteReavaliada(
      prisma,
      conflito.productId,
      conflito.marketplace,
      conflito.externalId,
      conflito.motivo,
      {
        suppressProductSync: false,
        sincronizarMelhorOferta: sincronizarMelhorOfertaDoProduto,
      },
    );

    if (aplicado) {
      rejeitadas += 1;
    }

    const depois = await prisma.product.findUnique({
      where: { id: conflito.productId },
      select: {
        price: true,
        store: true,
        active: true,
        publicationStatus: true,
        offers: {
          select: { id: true, matchStatus: true, isBest: true, price: true },
        },
      },
    });

    console.log(
      [
        "REJECTED",
        conflito.offerId,
        `applied=${aplicado}`,
        `price=${depois?.price}`,
        `store=${JSON.stringify(depois?.store)}`,
        `publicationStatus=${depois?.publicationStatus}`,
        `active=${depois?.active}`,
      ].join(" "),
    );
  }

  console.log(`OFFERS_REJECTED=${rejeitadas}`);
}

const ehEntrypoint =
  process.argv[1]?.includes("reconcile-offer-identity") ?? false;

if (ehEntrypoint) {
  void main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
