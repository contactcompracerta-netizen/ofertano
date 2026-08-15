import type { Prisma } from "@prisma/client";

import prisma from "@/lib/prisma";
import { descobrirProdutos } from "@/services/discovery";
import { publicarResultadoDiscovery } from "@/services/discovery/publisher";

const TERMOS_ACESSORIOS = [
  "capa",
  "capinha",
  "case",
  "pelicula",
  "pelicula de vidro",
  "vidro temperado",
  "cabo",
  "carregador",
  "adaptador",
  "fonte",
  "suporte",
  "base",
  "bases",
  "stand",
  "stands",
  "pedestal",
  "pedestais",
  "protetor",
  "borracha",
  "anel de vedacao",
  "pino",
  "peso regulador",
  "regulador",
  "valvula",
  "gaxeta",
  "guarnicao",
  "peca de reposicao",
  "kit reparo",
  "flex antena",

  /*
   * Armazenamento e acessórios eletrônicos.
   *
   * Importante para evitar resultados como
   * "Pen Drive 128GB para iPhone" em uma busca
   * por "iPhone 15 128GB".
   */
  "pen drive",
  "pendrive",
  "memoria usb",
  "cartao de memoria",
  "cartao memoria",
  "micro sd",
  "microsd",

  /*
   * Smartwatch / relógios.
   */
  "pulseira",
  "bracelete",
  "correia",

  /*
   * Celulares / câmeras.
   */
  "protetor de camera",
  "protetor de lente",
  "lente para camera",
];

function normalizarTexto(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarBusca(valor: string): string {
  return valor
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function contemExpressao(
  textoNormalizado: string,
  expressao: string,
): boolean {
  const texto = ` ${textoNormalizado} `;

  const termo =
    ` ${normalizarTexto(expressao)} `;

  return texto.includes(termo);
}

function possuiAcessorioNaoSolicitado(
  titulo: string,
  consulta: string,
): boolean {
  const tituloNormalizado =
    normalizarTexto(titulo);

  const consultaNormalizada =
    normalizarTexto(consulta);

  return TERMOS_ACESSORIOS.some(
    (termo) =>
      contemExpressao(
        tituloNormalizado,
        termo,
      ) &&
      !contemExpressao(
        consultaNormalizada,
        termo,
      ),
  );
}

function variantesDoTermo(
  termo: string,
): string[] {
  const limpo = termo.trim();

  if (!limpo) {
    return [];
  }

  /*
   * Permite que:
   *
   * 128GB
   *
   * encontre também:
   *
   * 128 GB
   */
  const capacidade = limpo.match(
    /^(\d+(?:[.,]\d+)?)\s*(tb|gb|mb)$/i,
  );

  if (capacidade) {
    const numero = capacidade[1];

    const unidade =
      capacidade[2].toUpperCase();

    return Array.from(
      new Set([
        `${numero}${unidade}`,
        `${numero} ${unidade}`,
      ]),
    );
  }

  return [limpo];
}

function criarFiltroTexto(
  valor: string,
): Prisma.ProductWhereInput[] {
  return [
    {
      name: {
        contains: valor,
        mode: "insensitive",
      },
    },

    {
      canonicalName: {
        contains: valor,
        mode: "insensitive",
      },
    },

    {
      brand: {
        contains: valor,
        mode: "insensitive",
      },
    },

    {
      modelNumber: {
        contains: valor,
        mode: "insensitive",
      },
    },

    {
      category: {
        contains: valor,
        mode: "insensitive",
      },
    },
  ];
}

function criarFiltroCatalogo(
  busca: string,
): Prisma.ProductWhereInput {
  const termos = busca
    .split(/\s+/)
    .map((termo) => termo.trim())
    .filter(Boolean);

  /*
   * Para cada palavra da consulta exigimos
   * correspondência em algum campo relevante.
   *
   * Exemplo:
   *
   * Galaxy S24 256GB
   *
   * não deve se comportar como uma simples
   * busca por qualquer uma dessas palavras.
   */
  const buscaPorTermos: Prisma.ProductWhereInput =
    {
      AND: termos.map((termo) => {
        const variantes =
          variantesDoTermo(termo);

        return {
          OR: variantes.flatMap(
            (variante) =>
              criarFiltroTexto(variante),
          ),
        };
      }),
    };

  return {
    active: true,

    price: {
      gt: 0,
    },

    image: {
      not: "",
    },

    OR: [
      ...criarFiltroTexto(busca),
      buscaPorTermos,
    ],
  };
}

async function buscarNoCatalogo(
  busca: string,
) {
  /*
   * Buscamos uma quantidade maior antes do
   * filtro final porque alguns registros podem
   * ser acessórios não solicitados.
   */
  const candidatos =
    await prisma.product.findMany({
      where: criarFiltroCatalogo(busca),

      orderBy: [
        {
          updatedAt: "desc",
        },
        {
          price: "asc",
        },
      ],

      take: 120,
    });

  /*
   * Segunda camada de segurança.
   *
   * O banco pode encontrar:
   *
   * "Pen Drive 128GB para iPhone"
   *
   * para:
   *
   * "iPhone 15 128GB"
   *
   * porque as palavras existem no título.
   *
   * Aqui rejeitamos o acessório quando ele
   * não foi explicitamente pedido.
   */
  return candidatos
    .filter(
      (produto) =>
        !possuiAcessorioNaoSolicitado(
          [
            produto.name,
            produto.canonicalName || "",
          ]
            .filter(Boolean)
            .join(" "),
          busca,
        ),
    )
    .slice(0, 40);
}

export type SearchCatalogOrDiscoverResult = {
  query: string;

  source:
    | "CATALOG"
    | "DISCOVERY"
    | "NOT_FOUND";

  products: Awaited<
    ReturnType<typeof buscarNoCatalogo>
  >;

  discovery?: Awaited<
    ReturnType<typeof descobrirProdutos>
  >;

  publication?: Awaited<
    ReturnType<
      typeof publicarResultadoDiscovery
    >
  >;
};

export async function searchCatalogOrDiscover(
  query: string,
  discoveryLimit = 5,
): Promise<SearchCatalogOrDiscoverResult> {
  const busca =
    normalizarBusca(query);

  if (busca.length < 2) {
    return {
      query: busca,
      source: "NOT_FOUND",
      products: [],
    };
  }

  /*
   * 1. Consulta primeiro o catálogo.
   */
  const produtosExistentes =
    await buscarNoCatalogo(busca);

  if (produtosExistentes.length > 0) {
    return {
      query: busca,
      source: "CATALOG",
      products: produtosExistentes,
    };
  }

  /*
   * 2. Nenhum produto válido no catálogo.
   *
   * Executa o Discovery nos marketplaces.
   */
  const discovery =
    await descobrirProdutos(
      busca,
      discoveryLimit,
    );

  /*
   * 3. Publica e faz o agrupamento canônico.
   */
  const publication =
    await publicarResultadoDiscovery(
      discovery,
    );

  const productIds = Array.from(
    new Set(
      publication.productIds.filter(
        (id): id is string =>
          typeof id === "string" &&
          id.trim().length > 0,
      ),
    ),
  );

  /*
   * 4. Se o Publisher informar os produtos
   * criados ou atualizados, buscamos pelos IDs.
   */
  if (productIds.length > 0) {
    const produtosPublicados =
      await prisma.product.findMany({
        where: {
          id: {
            in: productIds,
          },

          active: true,

          price: {
            gt: 0,
          },

          image: {
            not: "",
          },
        },

        orderBy: [
          {
            price: "asc",
          },
          {
            updatedAt: "desc",
          },
        ],
      });

    const produtosValidos =
      produtosPublicados.filter(
        (produto) =>
          !possuiAcessorioNaoSolicitado(
            [
              produto.name,
              produto.canonicalName || "",
            ]
              .filter(Boolean)
              .join(" "),
            busca,
          ),
      );

    if (produtosValidos.length > 0) {
      return {
        query: busca,
        source: "DISCOVERY",
        products: produtosValidos,
        discovery,
        publication,
      };
    }
  }

  /*
   * 5. Última verificação.
   *
   * O saveProduct pode ter associado uma oferta
   * descoberta a um produto já existente.
   */
  const produtosDepoisDoDiscovery =
    await buscarNoCatalogo(busca);

  if (
    produtosDepoisDoDiscovery.length > 0
  ) {
    return {
      query: busca,
      source: "DISCOVERY",
      products:
        produtosDepoisDoDiscovery,
      discovery,
      publication,
    };
  }

  return {
    query: busca,
    source: "NOT_FOUND",
    products: [],
    discovery,
    publication,
  };
}