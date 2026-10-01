/**
 * PIPELINE SHADOW — EXPANSÃO DE SEEDS MERCADO LIVRE (FASE 2 / §3 e §4).
 *
 * DIAGNÓSTICO DA FONTE (medido neste ambiente, não suposto)
 * -------------------------------------------------------
 *   `/sites/MLB/search`          403 SEMPRE (autenticado E público)
 *   `/sites/MLB/search?seller_id` 403
 *   `/sites/MLB/search?category=`  403
 *   `/items/{id}`                403/404 (exige token de vendedor)
 *   `/products/search?q=`        200
 *   `/products/{id}/items`       200 (quando o catalogo tem itens)
 *   `/users/me`                  200  => o token está VIVO
 *   `/products/search` paging.total = 10000 na maioria das consultas
 *
 * CONCLUSÃO: o token funciona; o recurso `/sites/MLB/search` é que está
 * bloqueado para esta aplicação. Não é erro de código, não é quota, não é
 * credencial morta. Contornar com scraping seria inseguro e forbidden pela
 * missão; inventar dado seria pior. Usa-se o caminho de CATÁLOGO, que é
 * exatamente o caminho LISTING-FIRST que o runtime já usa em produção
 * (`buscarItensDeCatalogo`).
 *
 * YIELD MEDIDO: ~6% dos produtos de catálogo devolvem itens. Logo, para N
 * seeds reais é preciso sondar ~N/0,06 produtos de catálogo. Este script
 * reporta o custo real em requests, porque "25 listings" e "200 listings"
 * não custam o mesmo.
 *
 * SOMENTE LEITURA. Nenhum write no banco. Nenhuma publicação.
 *
 * Uso:
 *   npx tsx --env-file=.env.local src/scripts/xm-probe-ml-seeds.ts <alvo>
 */
import { writeFileSync } from "node:fs";

import { buscarItensDeCatalogo } from "@/services/mercadoLivre/catalogItems";
import { mercadoLivreFetch } from "@/lib/mercadolivre";

type CatalogoSearchItem = {
  id?: string;
  name?: string;
  attributes?: Array<{ id?: string; name?: string; value_name?: string }>;
};

type CatalogoItemMl = {
  item_id?: string | null;
  price?: number | null;
  original_price?: number | null;
  currency_id?: string | null;
  seller_id?: number | string | null;
  condition?: string | null;
};

export type SeedMlV1 = {
  /** item_id REAL do anúncio. É a identidade da oferta, nunca o catalogProductId. */
  itemId: string;
  title: string;
  price: number;
  sellerId: string | null;
  catalogProductId: string | null;
  categoryId: string;
  seedQuery: string;
  gtin: string | null;
  brand: string | null;
};

/**
 * As 9 categorias exigidas pela missão (§4), com consultas por categoria
 * para que o benchmark não fique dominado por uma só.
 */
export const CATEGORIAS_FASE2: Array<{ id: string; queries: string[] }> = [
  {
    id: "celulares",
    queries: [
      "smartphone samsung galaxy a55",
      "smartphone xiaomi redmi note 13",
      "iphone 13 128gb",
      "motorola edge 40 pro",
      "smartphone xiaomi poco",
    ],
  },
  {
    id: "tvs",
    queries: [
      "smart tv 50 polegadas samsung",
      "televisor 4k lg crystal",
      "tv xiaomi crystal",
      "televisor samsung 55 Crystal UHD",
    ],
  },
  {
    id: "notebooks",
    queries: [
      "notebook acer aspire 5",
      "notebook samsung galaxy book3",
      "notebook lenovo ideapad 1",
      "notebook hp 15s",
    ],
  },
  {
    id: "informatica",
    queries: [
      "ssd 1tb samsung 870 evo",
      "memoria ram 16gb ddr4",
      "teclado mecanico redragon",
      "mouse logitech m170",
      "monitor lg 24 polegadas",
      "cabo hdmi 2.0",
    ],
  },
  {
    id: "audio",
    queries: [
      "fone de ouvido bluetooth tws",
      "fone xiaomi redmi buds 6",
      "caixa de som jbl flip",
      "headphone sony wh1000xm4",
    ],
  },
  {
    id: "eletrodomesticos",
    queries: [
      "batedeira electrolux",
      "micro-ondas electrolux 20l",
      "lavadora de roupas consul",
      "liquidificador monobloca",
    ],
  },
  {
    id: "ferramentas",
    queries: [
      "furadeira de impacto bosch",
      "parafusadeira a bateria bosch",
      "multimetro digital",
      "jogo de chaves",
    ],
  },
  {
    id: "games",
    queries: [
      "controle ps5 dualsense",
      "cadeira gamer",
      "headset gamer 7.1",
      "monitor gamer 144hz",
    ],
  },
  {
    id: "casa",
    queries: ["airfryer", "panela de pressao eletrica", "ventilador de mesa"],
  },
];

async function buscarCatalogo(
  query: string,
  offset: number,
): Promise<CatalogoSearchItem[]> {
  const params = new URLSearchParams({
    q: query,
    site_id: "MLB",
    limit: "50",
    offset: String(offset),
  });

  try {
    const data = (await mercadoLivreFetch(
      `/products/search?${params.toString()}`,
    )) as { results?: CatalogoSearchItem[] };

    return data.results ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[seed] products/search falhou "${query}": ${message.slice(0, 140)}`);
    return [];
  }
}

function atributoDe(item: CatalogoSearchItem, id: RegExp): string | null {
  const achado = (item.attributes ?? []).find((a) => id.test(a.id ?? ""));
  const bruto = achado?.value_name?.trim();
  return bruto && bruto !== "Sim" && bruto !== "Não" ? bruto : null;
}

function normalizarItemId(valor: unknown): string | null {
  const itemId = String(valor ?? "")
    .replace(/-/g, "")
    .toUpperCase();
  return /^MLB\d+$/.test(itemId) ? itemId : null;
}

async function main() {
  const alvo = Number(process.argv[2] ?? "250");
  const arquivoSaida = process.argv[3];

  const porCategoria: Record<string, number> = {};
  const catalogoVisto = new Set<string>();
  const itemVisto = new Set<string>();
  const seeds: SeedMlV1[] = [];

  let requests = 0;
  let requestsSearch = 0;
  let requestsItems = 0;
  let catalogoSondado = 0;
  let catalogoComItens = 0;

  console.log(`[seed] alvo=${alvo}`);

  /*
   * Rodízio por CATEGORIA, não exaustão por categoria.
   *
   * A primeira versão deste script percorria as categorias em ordem e parava
   * ao atingir o alvo: com `celulares` primeiro, as 300 seeds saíram TODAS de
   * celulares. Isso viola o §4 da missão (evitar benchmark dominado por uma
   * categoria) e, mais grave, tornaria qualquer métrica de recall otimista
   * demais para a categoria mais fácil. Aqui cada categoria tem cota e o
   * rodízio alterna entre elas, então uma categoria morta (yield 0) apenas
   * custa tempo, nunca desvia a amostra inteira.
   */
  const categoriasAtivas = CATEGORIAS_FASE2.map((categoria) => ({
    ...categoria,
    cota: Math.max(1, Math.floor(alvo / CATEGORIAS_FASE2.length)),
    colhidas: 0,
  }));

  const estaCheia = (categoria: (typeof categoriasAtivas)[number]) =>
    categoria.colhidas >= categoria.cota;

  let rodadas = 0;
  const MAX_RODADAS = 12;

  while (seeds.length < alvo && rodadas < MAX_RODADAS) {
    rodadas += 1;
    let progressoNaRodada = 0;

    for (const categoria of categoriasAtivas) {
      if (seeds.length >= alvo) break;
      if (estaCheia(categoria)) continue;

      for (const query of categoria.queries) {
        if (seeds.length >= alvo) break;
        if (estaCheia(categoria)) break;

        /*
         * `/products/search` pagina por offset. As primeiras páginas devolvem
         * produtos de catálogo antigos (pré-compactação), que já não têm
         * anúncios. Paginar adiante acha catálogo ativo.
         */
        for (const offset of [0, 50, 100, 150, 200, 250, 300, 350, 400, 450]) {
          if (seeds.length >= alvo) break;
          if (estaCheia(categoria)) break;

          const catalogo = await buscarCatalogo(query, offset);
          requests += 1;
          requestsSearch += 1;

          if (catalogo.length === 0) break;

          let aceitos = 0;

          for (const produto of catalogo) {
            if (seeds.length >= alvo) break;
            if (estaCheia(categoria)) break;

            const catalogProductId = String(produto.id ?? "").toUpperCase();
            if (!/^MLB\d{6,}$/.test(catalogProductId)) continue;
            if (catalogoVisto.has(catalogProductId)) continue;
            catalogoVisto.add(catalogProductId);
            catalogoSondado += 1;

            const titulo = produto.name?.trim();
            if (!titulo) continue;

            let itens: CatalogoItemMl[] = [];
            try {
              const resposta = await buscarItensDeCatalogo(catalogProductId);
              itens = (resposta.results ?? []) as CatalogoItemMl[];
            } catch {
              /*
               * Catálogo sem anúncios responde 404 "No winners found". É um
               * resultado normal do `/products/search` (a maioria dos produtos
               * velhos já não tem oferta), não um erro de código. Nada de
               * retry e nada de fallback para scraping aqui.
               */
              itens = [];
            }
            requests += 1;
            requestsItems += 1;

            if (itens.length === 0) continue;
            catalogoComItens += 1;

            for (const item of itens) {
              if (seeds.length >= alvo) break;
              if (estaCheia(categoria)) break;

              const itemId = normalizarItemId(item.item_id);
              if (!itemId || itemVisto.has(itemId)) continue;

              const preco = typeof item.price === "number" ? item.price : null;
              if (preco === null || !(preco > 0)) continue;

              itemVisto.add(itemId);
              aceitos += 1;
              categoria.colhidas += 1;
              seeds.push({
                itemId,
                title: titulo,
                price: preco,
                sellerId:
                  item.seller_id != null && String(item.seller_id).trim() !== ""
                    ? String(item.seller_id)
                    : null,
                catalogProductId,
                categoryId: categoria.id,
                seedQuery: query,
                gtin: atributoDe(produto, /^GTIN$/i),
                brand: atributoDe(produto, /^BRAND$/i),
              });
            }
          }

          porCategoria[categoria.id] = categoria.colhidas;

          if (aceitos > 0) {
            progressoNaRodada += aceitos;
            console.log(
              `[seed] ${categoria.id} "${query}" off=${offset} catalogo=${catalogo.length} novos=${aceitos} (${categoria.colhidas}/${categoria.cota}) total=${seeds.length}`,
            );
          }

          if (aceitos === 0 && catalogo.length < 50) break;
        }
      }
    }

    console.log(
      `[seed] rodada ${rodadas}: total=${seeds.length} porCategoria=${JSON.stringify(porCategoria)}`,
    );

    if (progressoNaRodada === 0) break;
  }


  const comSeller = seeds.filter((s) => s.sellerId).length;
  const comCatalogo = seeds.filter((s) => s.catalogProductId).length;
  const comGtin = seeds.filter((s) => s.gtin).length;
  const comMarca = seeds.filter((s) => s.brand).length;
  const comPrecoOriginal = seeds.filter((s) => s.price > 0).length;

  console.log("\n=== SEEDS ML REAIS (products/search + products/{id}/items) ===");
  console.log(`ML_SEEDS=${seeds.length}`);
  console.log(`ML_REQUESTS_TOTAL=${requests}`);
  console.log(`ML_REQUESTS_SEARCH=${requestsSearch}`);
  console.log(`ML_REQUESTS_CATALOG_ITEMS=${requestsItems}`);
  console.log(`ML_CATALOG_SONDED=${catalogoSondado}`);
  console.log(`ML_CATALOG_WITH_ITEMS=${catalogoComItens}`);
  console.log(
    `ML_CATALOG_YIELD=${catalogoSondado ? ((catalogoComItens / catalogoSondado) * 100).toFixed(1) : "0"}%`,
  );
  console.log(`ML_SEEDS_WITH_CATALOG=${comCatalogo}`);
  console.log(`ML_SEEDS_WITH_SELLER=${comSeller}`);
  console.log(`ML_SEEDS_WITH_GTIN=${comGtin}`);
  console.log(`ML_SEEDS_WITH_BRAND=${comMarca}`);
  console.log(`ML_SEEDS_WITH_VALID_PRICE=${comPrecoOriginal}`);
  const categoriasComSeed = Object.keys(porCategoria).filter(
    (k) => (porCategoria[k] ?? 0) > 0,
  );
  console.log(`ML_CATEGORIES=${categoriasComSeed.length}/9`);
  console.log(`ML_CATEGORY_BALANCE=${JSON.stringify(
    Object.fromEntries(
      categoriasComSeed
        .map((k) => [k, porCategoria[k]])
        .sort((a, b) => (b[1] as number) - (a[1] as number)),
    ),
  )}`);
  const maior = Math.max(0, ...categoriasComSeed.map((k) => porCategoria[k] ?? 0));
  console.log(
    `ML_DOMINANT_CATEGORY_SHARE=${seeds.length ? ((maior / seeds.length) * 100).toFixed(1) : "0"}%`,
  );
  console.log("POR_CATEGORIA=" + JSON.stringify(porCategoria));

  console.log("\n=== DETALHE TSV ===");
  for (const seed of seeds) {
    console.log(
      [
        seed.itemId,
        seed.categoryId,
        String(seed.price),
        seed.catalogProductId ?? "-",
        seed.sellerId ?? "-",
        seed.gtin ?? "-",
        seed.brand ?? "-",
        seed.title.replace(/\s+/g, " ").slice(0, 100),
      ].join("\t"),
    );
  }

  if (arquivoSaida) {
    writeFileSync(arquivoSaida, `${JSON.stringify(seeds, null, 2)}\n`, "utf8");
    console.log(`\n[seed] seeds salvos em ${arquivoSaida}`);
  }
}

void main();