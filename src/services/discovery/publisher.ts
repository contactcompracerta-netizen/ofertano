import { saveProduct } from "@/services/database/saveProduct";

import type {
  ProductImport,
} from "@/services/importers/core/types";

import type {
  DiscoveryCandidate,
  ProductDiscoveryResult,
} from "./core/types";

const PRIORIDADE_MARKETPLACE: Record<
  DiscoveryCandidate["marketplace"],
  number
> = {
  MERCADO_LIVRE: 0,
  MAGAZINE_LUIZA: 1,
  AMAZON: 2,
  SHOPEE: 3,
  ALIEXPRESS: 4,
};

const TERMOS_ACESSORIOS = [
  "capa",
  "capinha",
  "case",
  "pelicula",
  "vidro temperado",
  "cabo",
  "carregador",
  "adaptador",
  "fonte",
  "suporte",
  "base",
  "stand",
  "pedestal",
  "protetor",
  "peca de reposicao",
  "kit reparo",

  "pen drive",
  "pendrive",
  "memoria usb",
  "cartao de memoria",
  "cartao memoria",
  "micro sd",
  "microsd",

  "pulseira",
  "bracelete",
  "correia",

  "protetor de camera",
  "protetor de lente",
  "protetor de tela",

  "controle remoto",
  "controle universal",
  "soundbar",
  "hub usb",
  "dock",
];

function normalizarTextoFiltro(
  valor: string,
): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contemExpressaoFiltro(
  texto: string,
  expressao: string,
): boolean {
  const textoNormalizado =
    ` ${normalizarTextoFiltro(texto)} `;

  const termoNormalizado =
    ` ${normalizarTextoFiltro(expressao)} `;

  return textoNormalizado.includes(
    termoNormalizado,
  );
}

function possuiAcessorioNaoSolicitado(
  titulo: string,
  consulta: string,
): boolean {
  return TERMOS_ACESSORIOS.some(
    (termo) =>
      contemExpressaoFiltro(
        titulo,
        termo,
      ) &&
      !contemExpressaoFiltro(
        consulta,
        termo,
      ),
  );
}

export type DiscoveryPublishItem = {
  marketplace: DiscoveryCandidate["marketplace"];
  externalId: string;
  title: string;
  productId: string | null;
  success: boolean;
  error: string | null;
};

export type DiscoveryPublishResult = {
  query: string;

  received: number;
  publishable: number;

  published: number;
  failed: number;
  skipped: number;

  productIds: string[];

  items: DiscoveryPublishItem[];
};

function calcularDesconto(
  oldPrice: number | null,
  price: number,
): number | null {
  if (
    oldPrice === null ||
    !Number.isFinite(oldPrice) ||
    oldPrice <= price ||
    oldPrice <= 0 ||
    !Number.isFinite(price) ||
    price <= 0
  ) {
    return null;
  }

  const percentual =
    Math.round(
      ((oldPrice - price) / oldPrice) * 100,
    );

  if (
    percentual <= 0 ||
    percentual >= 100
  ) {
    return null;
  }

  return percentual;
}

function candidatoPublicavel(
  candidato: DiscoveryCandidate,
  consulta: string,
): boolean {
  return (
    candidato.status === "FOUND" &&
    Boolean(
      candidato.externalId.trim(),
    ) &&
    Boolean(
      candidato.sourceUrl.trim(),
    ) &&
    Boolean(
      candidato.title.trim(),
    ) &&
    Boolean(
      candidato.image?.trim(),
    ) &&
    candidato.price !== null &&
    Number.isFinite(
      candidato.price,
    ) &&
    candidato.price > 0 &&
    !possuiAcessorioNaoSolicitado(
      candidato.title,
      consulta,
    )
  );
}

function converterCandidato(
  candidato: DiscoveryCandidate,
): ProductImport {
  if (
    candidato.price === null ||
    !Number.isFinite(
      candidato.price,
    ) ||
    candidato.price <= 0
  ) {
    throw new Error(
      "Candidato sem preÃ§o vÃ¡lido.",
    );
  }

  const image =
    candidato.image?.trim();

  if (!image) {
    throw new Error(
      "Candidato sem imagem vÃ¡lida.",
    );
  }

  const oldPrice =
    candidato.oldPrice !== null &&
    Number.isFinite(
      candidato.oldPrice,
    ) &&
    candidato.oldPrice >
      candidato.price
      ? candidato.oldPrice
      : null;

  return {
    marketplace:
      candidato.marketplaceName,

    externalId:
      candidato.externalId.trim(),

    url:
      candidato.sourceUrl.trim(),

    affiliateLink:
      candidato.affiliateLink?.trim() ||
      null,

    title:
      candidato.title.trim(),

    description:
      null,

    brand:
      candidato.brand?.trim() ||
      null,

    category:
      candidato.category?.trim() ||
      null,

    image,

    images: [
      image,
    ],

    price:
      candidato.price,

    oldPrice,

    discount:
      calcularDesconto(
        oldPrice,
        candidato.price,
      ),

    installments:
      null,

    rating:
      null,

    reviews:
      null,

    sales:
      null,

    stock:
      null,

    seller:
      candidato.seller?.trim() ||
      null,

    attributes:
      {},
  };
}

function ordenarParaPersistencia(
  candidatos: DiscoveryCandidate[],
): DiscoveryCandidate[] {
  return [...candidatos].sort(
    (
      primeiro,
      segundo,
    ) => {
      const prioridadePrimeiro =
        PRIORIDADE_MARKETPLACE[
          primeiro.marketplace
        ];

      const prioridadeSegundo =
        PRIORIDADE_MARKETPLACE[
          segundo.marketplace
        ];

      if (
        prioridadePrimeiro !==
        prioridadeSegundo
      ) {
        return (
          prioridadePrimeiro -
          prioridadeSegundo
        );
      }

      /*
       * Dentro do mesmo marketplace, processamos
       * primeiro os preÃ§os maiores.
       *
       * Se duas ofertas acabarem apontando para o
       * mesmo Product + marketplace, a mais barata
       * serÃ¡ persistida por Ãºltimo.
       */
      const precoPrimeiro =
        primeiro.price ??
        Number.POSITIVE_INFINITY;

      const precoSegundo =
        segundo.price ??
        Number.POSITIVE_INFINITY;

      return (
        precoSegundo -
        precoPrimeiro
      );
    },
  );
}

function removerDuplicados(
  candidatos: DiscoveryCandidate[],
): DiscoveryCandidate[] {
  const mapa =
    new Map<
      string,
      DiscoveryCandidate
    >();

  for (
    const candidato of candidatos
  ) {
    const chave = [
      candidato.marketplace,
      candidato.externalId
        .trim()
        .toLowerCase(),
    ].join(":");

    const atual =
      mapa.get(chave);

    if (!atual) {
      mapa.set(
        chave,
        candidato,
      );

      continue;
    }

    const atualTemLink =
      Boolean(
        atual.affiliateLink?.trim(),
      );

    const novoTemLink =
      Boolean(
        candidato.affiliateLink?.trim(),
      );

    if (
      novoTemLink &&
      !atualTemLink
    ) {
      mapa.set(
        chave,
        candidato,
      );

      continue;
    }

    if (
      candidato.price !== null &&
      (
        atual.price === null ||
        candidato.price <
          atual.price
      )
    ) {
      mapa.set(
        chave,
        candidato,
      );
    }
  }

  return Array.from(
    mapa.values(),
  );
}

export async function publicarResultadoDiscovery(
  resultado: ProductDiscoveryResult,
): Promise<DiscoveryPublishResult> {
  const recebidos =
    resultado.candidates;

  const unicos =
    removerDuplicados(
      recebidos,
    );

  const publicaveis =
    ordenarParaPersistencia(
      unicos.filter(
        (candidato) =>
          candidatoPublicavel(
            candidato,
            resultado.query,
          ),
      ),
    );

  const items:
    DiscoveryPublishItem[] =
      [];

  const productIds =
    new Set<string>();

  let published = 0;
  let failed = 0;

  for (
    const candidato of publicaveis
  ) {
    try {
      const productImport =
        converterCandidato(
          candidato,
        );

      /*
       * NÃ£o usamos targetProductId aqui.
       *
       * O saveProduct jÃ¡ possui a regra canÃ´nica
       * responsÃ¡vel por:
       * - localizar a oferta pelo marketplace/externalId;
       * - localizar Product por canonicalKey;
       * - comparar identidade/modelo/variante;
       * - criar ou atualizar MarketplaceOffer;
       * - registrar PriceHistory;
       * - sincronizar a melhor oferta EXACT.
       *
       * ForÃ§ar targetProductId neste estÃ¡gio poderia
       * agrupar produtos diferentes em buscas amplas
       * como "Smartwatch".
       */
      const saved =
        await saveProduct(
          productImport,
          candidato.affiliateLink?.trim() ||
            null,
          {
            discoverySource:
              "ON_DEMAND_SEARCH",

            autoCreated:
              true,

            sourceQuery:
              resultado.query,
          },
        );

      productIds.add(
        saved.id,
      );

      published += 1;

      items.push({
        marketplace:
          candidato.marketplace,

        externalId:
          candidato.externalId,

        title:
          candidato.title,

        productId:
          saved.id,

        success:
          true,

        error:
          null,
      });
    } catch (error) {
      failed += 1;

      items.push({
        marketplace:
          candidato.marketplace,

        externalId:
          candidato.externalId,

        title:
          candidato.title,

        productId:
          null,

        success:
          false,

        error:
          (
            error instanceof Error
              ? error.message
              : "Erro desconhecido ao publicar candidato."
          ).slice(
            0,
            1000,
          ),
      });
    }
  }

  return {
    query:
      resultado.query,

    received:
      recebidos.length,

    publishable:
      publicaveis.length,

    published,

    failed,

    skipped:
      recebidos.length -
      publicaveis.length,

    productIds:
      Array.from(
        productIds,
      ),

    items,
  };
}
