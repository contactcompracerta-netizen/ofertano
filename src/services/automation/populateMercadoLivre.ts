import prisma from "@/lib/prisma";
import { mercadoLivreFetch } from "@/lib/mercadolivre";

const LIMITE_PADRAO = 5;
const LIMITE_MAXIMO = 10;

type SiteCategory = {
  id?: string;
  name?: string;
};

type HighlightEntry = {
  id?: string;
  type?: "PRODUCT" | "ITEM" | "USER_PRODUCT";
};

type HighlightsResponse = {
  content?: HighlightEntry[];
};

type CatalogPicture = {
  url?: string;
  secure_url?: string;
};

type CatalogProduct = {
  id?: string;
  name?: string;
  family_name?: string;
  pictures?: CatalogPicture[];
};

type CatalogOffer = {
  item_id?: string;
  price?: number;
  original_price?: number | null;
  status?: string;
  category_id?: string;
  permalink?: string;
  thumbnail?: string;
  secure_thumbnail?: string;
};

type CatalogItemsResponse = {
  results?: CatalogOffer[];
};

type AutomaticCandidate = {
  externalId: string;
  sourceUrl: string;
  title: string;
  image: string | null;
  categoryId: string | null;
  categoryName: string | null;
  price: number;
  oldPrice: number | null;
  discount: number | null;
};

export type PopulateMercadoLivreResult = {
  success: boolean;
  requested: number;
  scanned: number;
  candidates: number;
  queued: number;
  ignored: number;
  errors: number;
};

const CATEGORIAS_PREFERIDAS = [
  "celulares",
  "eletronicos",
  "informatica",
  "eletrodomesticos",
  "casa",
  "beleza",
  "esportes",
  "ferramentas",
];

function normalizarTexto(
  valor: string,
): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizarLimite(
  valor: number,
): number {
  if (!Number.isFinite(valor)) {
    return LIMITE_PADRAO;
  }

  return Math.min(
    LIMITE_MAXIMO,
    Math.max(
      1,
      Math.trunc(valor),
    ),
  );
}

function calcularDesconto(
  oldPrice: number | null,
  price: number,
): number | null {
  if (
    oldPrice === null ||
    oldPrice <= price ||
    oldPrice <= 0
  ) {
    return null;
  }

  return Math.round(
    ((oldPrice - price) / oldPrice) * 100,
  );
}

function escolherOferta(
  ofertas: CatalogOffer[],
): CatalogOffer | null {
  const validas = ofertas.filter(
    (oferta) =>
      typeof oferta.item_id === "string" &&
      typeof oferta.price === "number" &&
      Number.isFinite(oferta.price) &&
      oferta.price > 0 &&
      oferta.status !== "inactive" &&
      oferta.status !== "closed",
  );

  if (validas.length === 0) {
    return null;
  }

  /*
   * Priorizamos produtos realmente em oferta.
   * Quando nÃ£o houver preÃ§o antigo vÃ¡lido,
   * ainda permitimos produto disponÃ­vel.
   */
  return validas.sort(
    (primeira, segunda) => {
      const descontoPrimeira =
        typeof primeira.original_price === "number" &&
        primeira.original_price > primeira.price!
          ? (primeira.original_price - primeira.price!) /
            primeira.original_price
          : 0;

      const descontoSegunda =
        typeof segunda.original_price === "number" &&
        segunda.original_price > segunda.price!
          ? (segunda.original_price - segunda.price!) /
            segunda.original_price
          : 0;

      if (
        descontoPrimeira !==
        descontoSegunda
      ) {
        return (
          descontoSegunda -
          descontoPrimeira
        );
      }

      return (
        primeira.price! -
        segunda.price!
      );
    },
  )[0];
}

function obterImagem(
  produto: CatalogProduct,
  oferta: CatalogOffer,
): string | null {
  const imagemCatalogo =
    produto.pictures?.find(
      (imagem) =>
        imagem.secure_url ||
        imagem.url,
    );

  return (
    imagemCatalogo?.secure_url ||
    imagemCatalogo?.url ||
    oferta.secure_thumbnail ||
    oferta.thumbnail ||
    null
  );
}

function selecionarCategorias(
  categorias: SiteCategory[],
): SiteCategory[] {
  const selecionadas: SiteCategory[] = [];

  for (
    const palavra of
      CATEGORIAS_PREFERIDAS
  ) {
    const encontrada =
      categorias.find((categoria) => {
        if (
          !categoria.id ||
          !categoria.name
        ) {
          return false;
        }

        return normalizarTexto(
          categoria.name,
        ).includes(palavra);
      });

    if (
      encontrada &&
      !selecionadas.some(
        (item) =>
          item.id === encontrada.id,
      )
    ) {
      selecionadas.push(
        encontrada,
      );
    }
  }

  /*
   * Se algum nome mudar no Mercado Livre,
   * ainda usamos algumas categorias vÃ¡lidas
   * como fallback.
   */
  if (selecionadas.length < 4) {
    for (const categoria of categorias) {
      if (
        !categoria.id ||
        !categoria.name
      ) {
        continue;
      }

      if (
        selecionadas.some(
          (item) =>
            item.id === categoria.id,
        )
      ) {
        continue;
      }

      selecionadas.push(
        categoria,
      );

      if (
        selecionadas.length >= 8
      ) {
        break;
      }
    }
  }

  return selecionadas.slice(
    0,
    8,
  );
}

async function resolverProduto(
  productId: string,
  categoryName: string | null,
): Promise<AutomaticCandidate | null> {
  try {
    const [
      produto,
      respostaOfertas,
    ] = await Promise.all([
      mercadoLivreFetch(
        `/products/${productId}`,
      ) as Promise<CatalogProduct>,

      mercadoLivreFetch(
        `/products/${productId}/items`,
      ) as Promise<CatalogItemsResponse>,
    ]);

    const title =
      produto.name?.trim() ||
      produto.family_name?.trim();

    if (!title) {
      return null;
    }

    const oferta =
      escolherOferta(
        respostaOfertas.results ?? [],
      );

    if (!oferta) {
      return null;
    }

    const externalId =
      productId.trim();

    const sourceUrl =
      `https://www.mercadolivre.com.br/p/${productId}`;

    const price =
      oferta.price;

    if (
      !externalId ||
      typeof price !== "number" ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      return null;
    }

    const oldPrice =
      typeof oferta.original_price === "number" &&
      Number.isFinite(
        oferta.original_price,
      ) &&
      oferta.original_price > price
        ? oferta.original_price
        : null;

    return {
      externalId,
      sourceUrl,
      title,

      image: obterImagem(
        produto,
        oferta,
      ),

      categoryId:
        oferta.category_id?.trim() ||
        null,

      categoryName,

      price,
      oldPrice,

      discount:
        calcularDesconto(
          oldPrice,
          price,
        ),
    };
  } catch (error) {
    console.error(
      `Falha ao preparar produto automÃ¡tico ${productId}:`,
      error,
    );

    return null;
  }
}

export async function populateMercadoLivre(
  requestedLimit = LIMITE_PADRAO,
): Promise<PopulateMercadoLivreResult> {
  const limit =
    normalizarLimite(
      requestedLimit,
    );

  const categorias =
    (await mercadoLivreFetch(
      "/sites/MLB/categories",
    )) as SiteCategory[];

  const categoriasSelecionadas =
    selecionarCategorias(
      categorias,
    );

  const catalogProductIds =
    new Map<
      string,
      string | null
    >();

  for (
    const categoria of
      categoriasSelecionadas
  ) {
    if (!categoria.id) {
      continue;
    }

    try {
      const highlights =
        (await mercadoLivreFetch(
          `/highlights/MLB/category/${categoria.id}`,
        )) as HighlightsResponse;

      for (
        const item of
          highlights.content ?? []
      ) {
        if (
          item.type !== "PRODUCT" ||
          typeof item.id !== "string"
        ) {
          continue;
        }

        if (
          !catalogProductIds.has(
            item.id,
          )
        ) {
          catalogProductIds.set(
            item.id,
            categoria.name?.trim() ||
              null,
          );
        }
      }
    } catch (error) {
      console.error(
        `Falha ao consultar highlights da categoria ${categoria.id}:`,
        error,
      );
    }
  }

  const candidatos:
    AutomaticCandidate[] = [];

  let scanned = 0;
  let errors = 0;

  const entradas =
    Array.from(
      catalogProductIds.entries(),
    );

  for (
    let index = 0;
    index < entradas.length &&
    candidatos.length <
      limit * 3;
    index += 4
  ) {
    const lote =
      entradas.slice(
        index,
        index + 4,
      );

    scanned +=
      lote.length;

    const resultados =
      await Promise.all(
        lote.map(
          async ([
            productId,
            categoryName,
          ]) => {
            try {
              return await resolverProduto(
                productId,
                categoryName,
              );
            } catch {
              errors += 1;
              return null;
            }
          },
        ),
      );

    for (
      const resultado of
        resultados
    ) {
      if (resultado) {
        candidatos.push(
          resultado,
        );
      }
    }
  }

  /*
   * Produtos com desconto ficam primeiro.
   */
  candidatos.sort(
    (primeiro, segundo) => {
      const descontoPrimeiro =
        primeiro.discount ?? 0;

      const descontoSegundo =
        segundo.discount ?? 0;

      if (
        descontoPrimeiro !==
        descontoSegundo
      ) {
        return (
          descontoSegundo -
          descontoPrimeiro
        );
      }

      return (
        primeiro.price -
        segundo.price
      );
    },
  );

  let queued = 0;
  let ignored = 0;

  for (
    const candidato of
      candidatos
  ) {
    if (queued >= limit) {
      break;
    }

    try {
      const ofertaExistente =
        await prisma.marketplaceOffer.findUnique({
          where: {
            marketplace_externalId: {
              marketplace:
                "MERCADO_LIVRE",
              externalId:
                candidato.externalId,
            },
          },
          select: {
            id: true,
          },
        });

      if (ofertaExistente) {
        ignored += 1;
        continue;
      }

      const oportunidadeExistente =
        await prisma.productOpportunity.findUnique({
          where: {
            marketplace_externalId: {
              marketplace:
                "MERCADO_LIVRE",
              externalId:
                candidato.externalId,
            },
          },
          select: {
            id: true,
            status: true,
          },
        });

      if (oportunidadeExistente) {
        ignored += 1;
        continue;
      }

      const filaExistente =
        await prisma.importQueue.findUnique({
          where: {
            url:
              candidato.sourceUrl,
          },
          select: {
            id: true,
          },
        });

      if (filaExistente) {
        ignored += 1;
        continue;
      }

      await prisma.$transaction(
        async (tx) => {
          const oportunidade =
            await tx.productOpportunity.create({
              data: {
                marketplace:
                  "MERCADO_LIVRE",

                externalId:
                  candidato.externalId,

                sourceType:
                  "PRODUCT",

                sourceUrl:
                  candidato.sourceUrl,

                title:
                  candidato.title,

                image:
                  candidato.image,

                categoryId:
                  candidato.categoryId,

                categoryName:
                  candidato.categoryName,

                price:
                  candidato.price,

                oldPrice:
                  candidato.oldPrice,

                discount:
                  candidato.discount,

                affiliateLink:
                  null,

                status:
                  "QUEUED",

                matchStatus:
                  "HIGH",

                reviewReason:
                  "ImportaÃ§Ã£o automÃ¡tica. Aguardando validaÃ§Ã£o e link individual de afiliado.",

                queuedAt:
                  new Date(),
              },
            });

          await tx.importQueue.create({
            data: {
              url:
                candidato.sourceUrl,

              marketplace:
                "MERCADO_LIVRE",

              status:
                "PENDING",

              affiliateLink:
                null,

              opportunityId:
                oportunidade.id,
            },
          });
        },
      );

      queued += 1;
    } catch (error) {
      errors += 1;

      console.error(
        `Falha ao adicionar ${candidato.externalId} Ã  fila automÃ¡tica:`,
        error,
      );
    }
  }

  return {
    success: true,
    requested: limit,
    scanned,
    candidates:
      candidatos.length,
    queued,
    ignored,
    errors,
  };
}


