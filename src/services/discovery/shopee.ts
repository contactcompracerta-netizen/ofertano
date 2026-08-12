import {
  buscarOfertasShopeePorPalavraChave,
  type ShopeeAffiliateOffer,
} from "@/services/importers/shopee/api";

import type {
  DiscoveryCandidate,
  DiscoveryQuery,
  MarketplaceDiscoveryResult,
} from "./core/types";

const TERMOS_ACESSORIOS = [
  "capa",
  "capas",
  "capinha",
  "capinhas",
  "case",
  "cases",
  "pelicula",
  "peliculas",
  "vidro",
  "cabo",
  "cabos",
  "carregador",
  "carregadores",
  "fonte",
  "fontes",
  "adaptador",
  "adaptadores",
  "suporte",
  "suportes",
  "protetor",
  "protetores",
  "bumper",
  "skin",
  "adesivo",
  "adesivos",
  "fone",
  "fones",
  "headset",
  "earphone",
  "borracha",
  "vedacao",
  "anel",
  "pino",
  "peso",
  "regulador",
  "valvula",
  "gaxeta",
  "guarnicao",
  "reparo",
  "reposicao",
  "tampa",
  "alca",
  "antena",
  "flex",
];

const FAMILIAS_VARIANTE_ESTRITA = [
  "iphone",
  "galaxy",
  "redmi",
  "poco",
  "moto g",
  "moto e",
  "moto edge",
  "macbook",
  "ipad",
];

const QUALIFICADORES_MODELO = [
  "pro max",
  "pro",
  "max",
  "plus",
  "mini",
  "air",
  "ultra",
  "lite",
  "fe",
];

function limitarQuantidade(
  valor: number,
): number {
  if (!Number.isFinite(valor)) {
    return 5;
  }

  return Math.min(
    Math.max(
      Math.trunc(valor),
      1,
    ),
    20,
  );
}

function normalizarTexto(
  valor: string,
): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/([a-z])(\d)/g, "$1 $2")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function calcularRelevancia(
  titulo: string,
  consulta: string,
): number {
  const tituloNormalizado =
    normalizarTexto(titulo);

  const termos =
    Array.from(
      new Set(
        normalizarTexto(consulta)
          .split(" ")
          .filter(
            (termo) =>
              termo.length >= 2 ||
              /^\d+$/.test(termo),
          ),
      ),
    );

  if (termos.length === 0) {
    return 0;
  }

  const tokensTitulo =
    new Set(
      tituloNormalizado.split(" "),
    );

  const encontrados =
    termos.filter(
      (termo) =>
        tokensTitulo.has(termo),
    ).length;

  return (
    encontrados /
    termos.length
  );
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
    (termo) => {
      const termoNormalizado =
        normalizarTexto(termo);

      return (
        tituloNormalizado.includes(
          termoNormalizado,
        ) &&
        !consultaNormalizada.includes(
          termoNormalizado,
        )
      );
    },
  );
}
function usaFamiliaComVarianteEstrita(
  consulta: string,
): boolean {
  const normalizado =
    normalizarTexto(consulta);

  return FAMILIAS_VARIANTE_ESTRITA.some(
    (familia) =>
      normalizado.includes(
        familia,
      ),
  );
}

function extrairQualificadoresModelo(
  valor: string,
): Set<string> {
  const texto =
    ` ${normalizarTexto(valor)} `;

  const encontrados =
    new Set<string>();

  if (
    texto.includes(
      " pro max ",
    )
  ) {
    encontrados.add(
      "pro max",
    );
  } else {
    if (
      texto.includes(
        " pro ",
      )
    ) {
      encontrados.add(
        "pro",
      );
    }

    if (
      texto.includes(
        " max ",
      )
    ) {
      encontrados.add(
        "max",
      );
    }
  }

  for (
    const qualificador of
    QUALIFICADORES_MODELO
  ) {
    if (
      qualificador === "pro max" ||
      qualificador === "pro" ||
      qualificador === "max"
    ) {
      continue;
    }

    if (
      texto.includes(
        ` ${qualificador} `,
      )
    ) {
      encontrados.add(
        qualificador,
      );
    }
  }

  return encontrados;
}

function conjuntosIguais(
  primeiro: Set<string>,
  segundo: Set<string>,
): boolean {
  if (
    primeiro.size !==
    segundo.size
  ) {
    return false;
  }

  for (
    const valor of primeiro
  ) {
    if (
      !segundo.has(valor)
    ) {
      return false;
    }
  }

  return true;
}

function varianteCompativel(
  titulo: string,
  consulta: string,
): boolean {
  if (
    !usaFamiliaComVarianteEstrita(
      consulta,
    )
  ) {
    return true;
  }

  const referencia =
    extrairQualificadoresModelo(
      consulta,
    );

  const candidato =
    extrairQualificadoresModelo(
      titulo,
    );

  return conjuntosIguais(
    referencia,
    candidato,
  );
}

function extrairCapacidades(
  valor: string,
): Set<string> {
  const normalizado =
    normalizarTexto(valor);

  const encontrados =
    new Set<string>();

  const regex =
    /\b(\d+(?:[.,]\d+)?)\s*(gb|tb)\b/gi;

  for (
    const match of normalizado.matchAll(
      regex,
    )
  ) {
    const numero =
      match[1]
        ?.replace(",", ".")
        .trim();

    const unidade =
      match[2]
        ?.toLowerCase()
        .trim();

    if (
      numero &&
      unidade
    ) {
      encontrados.add(
        `${numero}${unidade}`,
      );
    }
  }

  return encontrados;
}

function capacidadeCompativel(
  titulo: string,
  consulta: string,
): boolean {
  const referencia =
    extrairCapacidades(
      consulta,
    );

  if (
    referencia.size === 0
  ) {
    return true;
  }

  const candidato =
    extrairCapacidades(
      titulo,
    );

  if (
    candidato.size === 0
  ) {
    return false;
  }

  if (
    candidato.size !==
    referencia.size
  ) {
    return false;
  }

  return conjuntosIguais(
    referencia,
    candidato,
  );
}
function converterPreco(
  valor:
    | string
    | number
    | null
    | undefined,
): number | null {
  if (
    typeof valor === "number" &&
    Number.isFinite(valor) &&
    valor > 0
  ) {
    return valor;
  }

  if (
    typeof valor !== "string"
  ) {
    return null;
  }

  let texto =
    valor
      .trim()
      .replace(/[^\d,.-]/g, "");

  if (!texto) {
    return null;
  }

  const ultimaVirgula =
    texto.lastIndexOf(",");

  const ultimoPonto =
    texto.lastIndexOf(".");

  if (
    ultimaVirgula >= 0 &&
    ultimoPonto >= 0
  ) {
    if (
      ultimaVirgula >
      ultimoPonto
    ) {
      texto =
        texto
          .replace(/\./g, "")
          .replace(",", ".");
    } else {
      texto =
        texto.replace(/,/g, "");
    }
  } else if (
    ultimaVirgula >= 0
  ) {
    texto =
      texto.replace(",", ".");
  }

  const numero =
    Number(texto);

  if (
    !Number.isFinite(numero) ||
    numero <= 0
  ) {
    return null;
  }

  return numero;
}

function ofertaValida(
  oferta: ShopeeAffiliateOffer,
): boolean {
  return Boolean(
    Number.isFinite(
      Number(oferta.itemId),
    ) &&
    Number(oferta.itemId) > 0 &&
    Number.isFinite(
      Number(oferta.shopId),
    ) &&
    Number(oferta.shopId) > 0 &&
    oferta.productName?.trim() &&
    oferta.offerLink?.trim() &&
    converterPreco(
      oferta.price,
    ),
  );
}

export async function buscarShopee(
  request: DiscoveryQuery,
): Promise<MarketplaceDiscoveryResult> {
  const query =
    request.query.trim();

  const limit =
    limitarQuantidade(
      request.limit,
    );

  if (!query) {
    return {
      marketplace:
        "SHOPEE",

      query,

      success:
        false,

      candidates:
        [],

      scanned:
        0,

      error:
        "Consulta vazia.",
    };
  }

  try {
    const searchLimit =
      Math.min(
        Math.max(
          limit * 10,
          30,
        ),
        50,
      );

    const ofertas =
      await buscarOfertasShopeePorPalavraChave(
        query,
        searchLimit,
      );

    const encontrados: Array<{
      candidate:
        DiscoveryCandidate;
      relevance:
        number;
      sales:
        number;
    }> = [];

    const ids =
      new Set<string>();

    for (
      const oferta of ofertas
    ) {
      if (
        !ofertaValida(
          oferta,
        )
      ) {
        continue;
      }

      const titulo =
        oferta.productName.trim();

      const relevancia =
        calcularRelevancia(
          titulo,
          query,
        );

      /*
       * Busca refinada precisa de correspondência
       * forte com o produto de referência.
       */
      if (
        relevancia < 0.8
      ) {
        continue;
      }

      if (
        possuiAcessorioNaoSolicitado(
          titulo,
          query,
        )
      ) {
        continue;
      }

      if (
        !varianteCompativel(
          titulo,
          query,
        )
      ) {
        continue;
      }

      if (
        !capacidadeCompativel(
          titulo,
          query,
        )
      ) {
        continue;
      }

      const externalId =
        `${oferta.shopId}.${oferta.itemId}`;

      if (
        ids.has(externalId)
      ) {
        continue;
      }

      ids.add(
        externalId,
      );

      const preco =
        converterPreco(
          oferta.price,
        );

      if (!preco) {
        continue;
      }

      const categoria =
        Array.isArray(
          oferta.productCatIds,
        ) &&
        oferta.productCatIds.length > 0
          ? String(
              oferta.productCatIds[
                oferta.productCatIds.length -
                  1
              ],
            )
          : null;

      encontrados.push({
        relevance:
          relevancia,

        sales:
          Number.isFinite(
            Number(
              oferta.sales,
            ),
          )
            ? Number(
                oferta.sales,
              )
            : 0,

        candidate: {
          marketplace:
            "SHOPEE",

          marketplaceName:
            "Shopee",

          externalId,

          sourceUrl:
            oferta.productLink
              ?.trim() ||
            oferta.offerLink.trim(),

          affiliateLink:
            oferta.offerLink.trim(),

          title:
            titulo,

          image:
            oferta.imageUrl
              ?.trim() ||
            null,

          price:
            preco,

          oldPrice:
            null,

          category:
            categoria,

          brand:
            null,

          seller:
            oferta.shopName
              ?.trim() ||
            null,

          status:
            "FOUND",

          error:
            null,
        },
      });
    }

    const candidatos =
      encontrados
        .sort(
          (a, b) => {
            if (
              b.relevance !==
              a.relevance
            ) {
              return (
                b.relevance -
                a.relevance
              );
            }

            if (
              b.sales !==
              a.sales
            ) {
              return (
                b.sales -
                a.sales
              );
            }

            return (
              (a.candidate
                .price ??
                Number.POSITIVE_INFINITY) -
              (b.candidate
                .price ??
                Number.POSITIVE_INFINITY)
            );
          },
        )
        .slice(
          0,
          limit,
        )
        .map(
          (resultado) =>
            resultado.candidate,
        );

    return {
      marketplace:
        "SHOPEE",

      query,

      success:
        true,

      candidates:
        candidatos,

      scanned:
        ofertas.length,

      error:
        null,
    };
  } catch (error) {
    const mensagem =
      error instanceof Error
        ? error.message
        : "Erro desconhecido.";

    return {
      marketplace:
        "SHOPEE",

      query,

      success:
        false,

      candidates:
        [],

      scanned:
        0,

      error:
        mensagem.slice(
          0,
          1000,
        ),
    };
  }
}


