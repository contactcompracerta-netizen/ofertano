import type { Marketplace, Prisma } from "@prisma/client";

/*
 * ESCRITA DE OFERTA COM IDADE DE LISTING (LISTING-FIRST)
 * ======================================================
 *
 * Por que este módulo existe
 * --------------------------
 * A unicidade de `MarketplaceOffer` NÃO é global, e isso é deliberado:
 *
 *   MERCADO_LIVRE .... N anúncios por Product (um Product agrega várias
 *                      listings do mesmo catálogo de produto).
 *   DEMAIS ........... 1 oferta por Product+Marketplace, garantida pelo
 *                      índice PARCIAL do banco
 *                      `MarketplaceOffer_non_ml_product_marketplace_key`
 *                      (`WHERE marketplace <> 'MERCADO_LIVRE'`).
 *
 * O Prisma NÃO consegue expressar índice único parcial. Até esta fase o
 * schema declarava `@@unique([productId, marketplace])`, o que fazia o
 * cliente emitir `ON CONFLICT ("productId","marketplace")` SEM predicado.
 * O Postgres recusa essa inferência com 42P10 (`there is no unique or
 * exclusion constraint matching the ON CONFLICT specification`), e TODA
 * escrita de oferta não-ML quebrava.
 *
 * Duas identidades, dois writer
 * ----------------------------
 * ML  -> `upsert` por `marketplace_externalId`. A identidade da oferta é o
 *        anúncio. Dois anúncios do mesmo Product são DUAS linhas, e é
 *        exatamente isso que o índice parcial permite.
 *
 * não-ML -> `findFirst(productId, marketplace)`; se achou, `update` por `id`;
 *        se não, `create`. Sem compound unique no Prisma, e sem depender da
 *        inferência de `ON CONFLICT`.
 *
 * Corrida de criação
 * ------------------
 * O `findFirst` seguido de `create` tem janela de corrida. Quem perder toma
 * P2002 do índice parcial — que é a ÚLTIMA garantia, a do próprio banco.
 *
 * Detalhe que importa: depois de um erro o Postgres ABORTA a transação, então
 * a releitura NÃO pode acontecer dentro da mesma transação (foi verificado
 * empiricamente). Por isso o retry é de TRANSAÇÃO INTEIRA, uma vez, em
 * `withUniqueRaceRetry`. Na segunda volta o `findFirst` enxerga a linha que
 * o outro writer acabou de gravar e cai no ramo de `update`.
 */

/** Superfície mínima do Prisma usada aqui — serve `prisma` e `tx`. */
export type OfertaDb = Pick<Prisma.TransactionClient, "marketplaceOffer">;

export type OfertaListingAwareInput<TSelect extends Prisma.MarketplaceOfferSelect> = {
  /** Cliente ou transação. */
  db: OfertaDb;

  productId: string;
  marketplace: Marketplace;

  /**
   * Identidade do anúncio. Para MERCADO_LIVRE é obrigatório e É o
   * `externalId` gravado. Para os demais marketplaces pode ser `null`.
   */
  externalId: string | null;

  /** Campos gravados quando a oferta já existe. */
  update: Omit<Prisma.MarketplaceOfferUncheckedUpdateInput, "id" | "productId" | "marketplace">;

  /** Campos gravados quando a oferta ainda não existe. */
  create: Omit<Prisma.MarketplaceOfferUncheckedCreateInput, "productId" | "marketplace">;

  select?: TSelect;
};

export type OfertaListingAwareResult<T> = T;

/** `true` quando o erro é violação de unicidade (P2002) do Prisma. */
export function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const code = (error as { code?: unknown }).code;

  return code === "P2002";
}

/**
 * Reexecuta a unidade de trabalho UMA vez quando o erro for P2002.
 *
 * Não é mascaramento: o segundo attempt refaz a leitura e, se a linha
 * existir, atualiza em vez de duplicar. Se ainda assim colidir, o erro
 * original sobe — nenhum loop infinito, nenhuma escrita silenciosa.
 */
export async function withUniqueRaceRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) {
      throw error;
    }

    return await run();
  }
}

/**
 * Lê a oferta existente respeitando a identidade correta do marketplace.
 *
 * ML: por anúncio. Devolve `null` quando o Product ainda não tem aquela
 * listing — e isso é o certo, não um erro.
 *
 * não-ML: por (productId, marketplace), com ordenação determinística para
 * que múltiplas linhas legadas não tornem o resultado instável entre
 * chamadas.
 */
export async function findOfertaListingAware<
  TSelect extends Prisma.MarketplaceOfferSelect,
>(input: {
  db: OfertaDb;
  productId: string;
  marketplace: Marketplace;
  externalId: string | null;
  select: TSelect;
}): Promise<Prisma.MarketplaceOfferGetPayload<{ select: TSelect }> | null> {
  const { db, productId, marketplace, externalId, select } = input;

  if (marketplace === "MERCADO_LIVRE" && externalId) {
    return db.marketplaceOffer.findUnique({
      where: {
        marketplace_externalId: {
          marketplace,
          externalId,
        },
      },
      select,
    });
  }

  if (marketplace === "MERCADO_LIVRE") {
    /*
     * ML sem `externalId` é impossível por contrato (o gate de writer exige
     * item_id). Se chegar aqui, não há oferta a escolher: escolher "a
     * primeira" seria inventar qual anúncio o Product representa.
     */
    return null;
  }

  const rows = await db.marketplaceOffer.findMany({
    where: {
      productId,
      marketplace,
    },
    select,
    orderBy: {
      createdAt: "asc",
    },
    take: 1,
  });

  return rows[0] ?? null;
}

/**
 * Mesmo contrato de `findOfertaListingAware`, mas devolvendo TODAS as ofertas
 * de um Product no marketplace.
 *
 * Necesário porque MERCADO_LIVRE admite várias listings por Product: quem
 * precisa avaliar todas (o monitor de preço, por exemplo) não pode parar na
 * primeira. Fora do ML o índice parcial garante no máximo uma.
 */
export async function listOfertasListingAware<
  TSelect extends Prisma.MarketplaceOfferSelect,
>(input: {
  db: OfertaDb;
  productId: string;
  marketplace: Marketplace;
  select: TSelect;
}): Promise<Prisma.MarketplaceOfferGetPayload<{ select: TSelect }>[]> {
  const { db, productId, marketplace, select } = input;

  return db.marketplaceOffer.findMany({
    where: {
      productId,
      marketplace,
    },
    select,
    orderBy: {
      createdAt: "asc",
    },
  });
}

/**
 * Grava a oferta respeitando a identidade correta do marketplace.
 *
 * ML: `upsert` por `marketplace_externalId`. Passa pela constraint real do
 * banco (`@@unique([marketplace, externalId])`), então duas execuções
 * concorrentes para o MESMO anúncio convergem para a mesma linha.
 *
 * não-ML: `findFirst` -> `update` por `id`, ou `create`. Em P2002 o erro
 * sobe para `withUniqueRaceRetry`, que repete a transação.
 */
export async function upsertOfertaListingAware<
  TSelect extends Prisma.MarketplaceOfferSelect = Prisma.MarketplaceOfferSelect,
>(
  input: OfertaListingAwareInput<TSelect>,
): Promise<Prisma.MarketplaceOfferGetPayload<{ select: TSelect }>> {
  const { db, productId, marketplace, externalId, update, create, select } = input;

  /*
   * O `select` chega como `TSelect` genérico, e o Prisma não consegue
   * propagar esse tipo através de `upsert`/`update`/`create` (cada um tem a
   * própria sobrecarga). O cast é puramente de widened→narrowed no ponto de
   * retorno: o runtime envia exatamente o `select` recebido.
   */
  type Row = Prisma.MarketplaceOfferGetPayload<{ select: TSelect }>;
  const asRow = (value: unknown): Row => value as Row;

  if (marketplace === "MERCADO_LIVRE") {
    if (!externalId) {
      throw new Error(
        "[LISTING_FIRST] oferta Mercado Livre exige externalId (item_id) para gravar.",
      );
    }

    return asRow(
      await db.marketplaceOffer.upsert({
        where: {
          marketplace_externalId: {
            marketplace,
            externalId,
          },
        },
        update,
        create: {
          ...create,
          productId,
          marketplace,
          externalId,
        },
        select,
      }),
    );
  }

  const existing = await findOfertaListingAware({
    db,
    productId,
    marketplace,
    externalId,
    select: { id: true },
  });

  if (existing) {
    return asRow(
      await db.marketplaceOffer.update({
        where: { id: existing.id },
        data: update,
        select,
      }),
    );
  }

  /*
   * Corrida real: outra transação pode ter criado a linha entre o `findFirst`
   * e o `create`. O índice parcial do banco recusa com P2002, e o erro sobe
   * intacto — não engolimos nem mascaramos. Quem chamou deve envolver a
   * unidade de trabalho em `withUniqueRaceRetry`, que repete a transação
   * inteira uma vez; na segunda volta o `findFirst` enxerga a linha vencedora.
   */
  return asRow(
    await db.marketplaceOffer.create({
      data: {
        ...create,
        productId,
        marketplace,
      },
      select,
    }),
  );
}