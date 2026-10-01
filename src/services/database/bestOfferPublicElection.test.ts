import assert from "node:assert/strict";

import {
  isOfertaPublicavelNoMarketplace,
  listarMarketplacesComparaveis,
} from "@/services/publicVisibility/multiStoreVisibility";
import { derivarDicasPublicas } from "@/services/publicVisibility/publicDiscoveryHints";
import { sincronizarMelhorOfertaDoProduto } from "@/services/database/saveProduct";

/*
 * CATALOG LAUNCH — GUARDA CONTRA "MELHOR PREÇO" NÃO COMPRÁVEL.
 *
 * Bug real de produção: a oferta de CATÁLOGO do Mercado Livre
 * (`sourceUrl` terminando em `/p/MLB...`) era a mais barata de um produto
 * e ganhava `isBest`, copiando o preço para `Product.price`. Todo o
 * catálogo passava a anunciar "Melhor preço" num valor sem CTA possível
 * ("Link em revisão"), e o JSON-LD publicava `AggregateOffer.lowPrice`
 * com esse mesmo número.
 *
 * Este teste prende os DOIS lados da correção:
 *   1. a eleição da melhor oferta prefere oferta exibível;
 *   2. a lista de lojas do card é a MESMA da grade do produto.
 */

type Oferta = {
  id: string;
  productId: string;
  marketplace: string;
  externalId: string | null;
  sourceUrl: string | null;
  affiliateLink: string | null;
  available: boolean;
  status: string;
  matchStatus: string;
  active: boolean;
  isBest: boolean;
  price: number;
  oldPrice: number | null;
  installments: string | null;
  stock: number | null;
};

function oferta(
  id: string,
  marketplace: string,
  overrides: Partial<Oferta> = {},
): Oferta {
  return {
    id,
    productId: "produto-1",
    marketplace,
    externalId: null,
    sourceUrl: null,
    affiliateLink: null,
    available: true,
    status: "ACTIVE",
    matchStatus: "EXACT",
    active: true,
    isBest: false,
    price: 100,
    oldPrice: null,
    installments: null,
    stock: null,
    ...overrides,
  };
}

const CATALOGO_ML = oferta("ml-catalogo", "MERCADO_LIVRE", {
  externalId: "MLB39962085",
  sourceUrl:
    "https://www.mercadolivre.com.br/p/MLB39962085?pdp_filters=item_id%3AMLB123",
  price: 63,
  status: "PENDING_AFFILIATE",
});

const LISTING_ML = oferta("ml-listing", "MERCADO_LIVRE", {
  externalId: "MLB1234567890",
  sourceUrl: "https://produto.mercadolivre.com.br/MLB-1234567890-fone",
  affiliateLink: "https://mercadolivre.com/sec/abc123",
  price: 70,
});

function fakeTx(ofertas: Oferta[], produto: { autoCreated: boolean } = { autoCreated: true }) {
  const escritasBest: Array<{ id: string; isBest: boolean }> = [];
  const atualizacoesProduto: Array<Record<string, unknown>> = [];

  const tx = {
    marketplaceOffer: {
      findMany: async () => [...ofertas].sort((a, b) => a.price - b.price),
      updateMany: async (args: { data: { isBest: boolean } }) => {
        for (const item of ofertas) {
          if (item.isBest) {
            escritasBest.push({ id: item.id, isBest: args.data.isBest });
          }
        }
        return { count: 0 };
      },
      update: async (args: { where: { id: string }; data: { isBest: boolean } }) => {
        escritasBest.push({ id: args.where.id, isBest: args.data.isBest });
        return args;
      },
    },
    product: {
      findUnique: async () => produto,
      update: async (args: { data: Record<string, unknown> }) => {
        atualizacoesProduto.push(args.data);
        return args.data;
      },
    },
  };

  return {
    tx: tx as never,
    escritasBest,
    atualizacoesProduto,
  };
}

async function executarSincronizacao(ofertas: Oferta[]) {
  const { tx, escritasBest, atualizacoesProduto } = fakeTx(ofertas);
  await sincronizarMelhorOfertaDoProduto(tx, "produto-1");
  const vencedor = escritasBest.find((item) => item.isBest)?.id ?? null;
  const produto = atualizacoesProduto.at(-1) ?? null;
  return { vencedor, produto };
}

async function main() {
  // 1. OFERTA_ML_DE_CATALOGO_NAO_VENCE_A_ELEICAO
  {
    const ofertas = [CATALOGO_ML, oferta("shopee", "SHOPEE", { price: 105 })];

    assert.equal(
      isOfertaPublicavelNoMarketplace(CATALOGO_ML),
      false,
      "oferta /p/ do Mercado Livre nao e publicavel",
    );

    const { vencedor, produto } = await executarSincronizacao(ofertas);

    assert.equal(
      vencedor,
      "shopee",
      "isBest tem de ir para a oferta exibivel, nunca para a de catalogo",
    );
    assert.equal(
      produto?.price,
      105,
      "Product.price nao pode copiar o preco de uma oferta sem CTA possivel",
    );
  }

  // 2. MELHOR_OFERTA_AINDA_E_A_MAIS_BARATA_EXIBIVEL
  {
    const ofertas = [
      CATALOGO_ML,
      oferta("shopee", "SHOPEE", { price: 120 }),
      oferta("magalu", "MAGAZINE_LUIZA", { price: 105 }),
    ];

    const { vencedor, produto } = await executarSincronizacao(ofertas);

    assert.equal(vencedor, "magalu", "a mais barata ENTRE AS EXIBIVEIS vence");
    assert.equal(produto?.price, 105, "preco do produto = mais barato exibivel");
  }

  // 3. LISTING_ML_VALIDO_CONTINUA_PODENDO_VENCER
  {
    assert.equal(
      isOfertaPublicavelNoMarketplace(LISTING_ML),
      true,
      "anuncio ML provado por MLB + URL produto.mercadolivre.com.br e publicavel",
    );

    const ofertas = [
      LISTING_ML,
      oferta("shopee", "SHOPEE", { price: 105 }),
    ];

    const { vencedor, produto } = await executarSincronizacao(ofertas);

    assert.equal(vencedor, "ml-listing", "Listing-First valido nao e punido");
    assert.equal(produto?.price, 70, "preco do anuncio ML valido vence");
  }

  // 4. FALLBACK: SEM OFERTA EXIBIVEL, O COMPORTAMENTO HISTORICO E PRESERVADO
  //    (um dado pendente do importador nao pode apagar o preco de 25 ofertas)
  {
    const mlSemIdentidade = oferta("ml-v0", "MERCADO_LIVRE", {
      externalId: "58215116714",
      sourceUrl: null,
      price: 13.99,
      status: "PENDING_AFFILIATE",
    });

    assert.equal(
      isOfertaPublicavelNoMarketplace(mlSemIdentidade),
      false,
      "sem sourceUrl a identidade nao esta provada",
    );

    const { vencedor, produto } = await executarSincronizacao([mlSemIdentidade]);

    assert.equal(vencedor, "ml-v0", "sem alternativa, o preco nao e descartado");
    assert.equal(produto?.price, 13.99, "preco historico preservado");
  }

  // 5. LISTA_DE_LOJAS_DO_CARD_IGUAL_A_DA_GRADE
  {
    const lojas = listarMarketplacesComparaveis([
      CATALOGO_ML,
      oferta("shopee", "SHOPEE", { price: 105 }),
      oferta("magalu", "MAGAZINE_LUIZA", { price: 107.91 }),
    ]);

    assert.deepEqual(
      lojas.slice().sort(),
      ["MAGAZINE_LUIZA", "SHOPEE"],
      "o card nao pode contar a oferta de catalogo como loja",
    );
    assert.equal(lojas.length, 2, "card e grade mostram as MESMAS 2 lojas");
  }

  // 6. NON_MARKETPLACE_NAO_E_AFETADO
  {
    assert.equal(
      isOfertaPublicavelNoMarketplace(oferta("amazon", "AMAZON")),
      true,
      "a regra de identidade e exclusiva do Mercado Livre",
    );
    assert.deepEqual(
      listarMarketplacesComparaveis([
        oferta("a", "AMAZON"),
        oferta("b", "SHOPEE"),
        oferta("c", "ALIEXPRESS"),
      ]).sort(),
      ["ALIEXPRESS", "AMAZON", "SHOPEE"],
      "todos os marketplaces nao-ML continuam contando",
    );
  }

  // 7. ESTADO_VAZIO_DA_BUSCA_NAO_INVENTA_DICA
  {
    const vazio = derivarDicasPublicas([]);
    assert.deepEqual(vazio, { categorias: [], buscas: [] }, "sem catalogo nao ha dica");

    const dicas = derivarDicasPublicas([
      { category: "Fones de Ouvido", brand: "Xiaomi" },
      { category: "Fones de Ouvido", brand: "Logitech" },
      { category: "Fones de Ouvido", brand: null },
      { category: null, brand: null },
      { category: "  ", brand: "N/A" },
      { category: "Informática > Mouse sem Fio", brand: "Logitech" },
    ]);

    assert.deepEqual(
      dicas.categorias.map((item) => item.nome),
      ["Fones de Ouvido", "Informática > Mouse sem Fio"],
      "categorias reais, ordenadas por quantidade",
    );
    assert.equal(dicas.categorias[0]?.quantidade, 3, "quantidade real da categoria");
    assert.deepEqual(
      dicas.buscas.map((item) => item.termo).sort(),
      ["Logitech", "Xiaomi"],
      "marca placeholder (N/A) e espaco em branco nao viram sugestao",
    );
    assert.ok(
      dicas.categorias.every((item) => item.nome.trim().length > 0),
      "nenhuma dica vazia",
    );
  }

  // 8. LIMITE_DAS_DICAS
  {
    const produtos = Array.from({ length: 30 }, (_, index) => ({
      category: `Categoria ${index}`,
      brand: `Marca ${index}`,
    }));
    const dicas = derivarDicasPublicas(produtos, 4);

    assert.equal(dicas.categorias.length, 4, "limite de categorias respeitado");
    assert.equal(dicas.buscas.length, 4, "limite de buscas respeitado");
  }

  console.log("bestOfferPublicElection.test.ts OK");

}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
