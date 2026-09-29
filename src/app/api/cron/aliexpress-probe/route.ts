/**
 * FASE 12 — PROBE FORENSE DA API ALIEXPRESS (READ ONLY, sem escrita).
 *
 * POR QUE ISTO EXISTE
 *
 * As capabilities declaradas pelo conector (`variants: false`, `gtin: false`,
 * `stock: false`, ...) são afirmações. Este endpoint é o que as MEDE contra a
 * API real, e existe porque uma silêncio de coleta é indistinguível de uma
 * coleta morta: um canário que devolve `LISTINGS_COLLECTED=0` com
 * `ERROR=null` passa verde tanto se a API estiver respondendo e os filtros
 * descartando tudo, quanto se a credencial estiver revogada. Só olhando o
 * payload real dá para separar os dois.
 *
 * O QUE ELE FAZ
 *
 *   ?product_id=<id>  chama `buscarProdutoApi` (productdetail.get) e reporta
 *                     a PRESENÇA/AUSÊNCIA de cada campo pedido, inclusive os
 *                     que a FASE 12 precisa investigar: `sku_id`,
 *                     `promotion_link`, `product_detail_url`. É a medida que
 *                     decide se `product_id` pode ser identidade de família.
 *
 *   ?keyword=<texto>  chama `buscarAliExpress` (product.query) e reporta
 *                     `searchOutcome`, `scanned` e quantos candidatos cada
 *                     filtro legado eliminou.
 *
 * SEGURANÇA
 *
 *   - Exige `Authorization: Bearer $CRON_SECRET`. Sem isso, 401.
 *   - Nenhum valor de credencial (`ALIEXPRESS_APP_KEY`/`_SECRET`) é lido ou
 *     impresso: o endpoint só reporta se estão *presentes*.
 *   - URLs são redigidas para host + forma, nunca o valor completo: um
 *     `promotion_link` carrega token de afiliado e `pdp_npi` carrega preço
 *     contextual. O que interessa para a forense é "o campo existe? em que
 *     host?", não o conteúdo.
 *   - Não escreve em Product, Oferta, RawListing nem em qualquer tabela.
 */
import { NextResponse } from "next/server";

import { buscarAliExpress } from "@/services/discovery/aliexpress";
import { buscarProdutoApi } from "@/services/importers/aliexpress/api";

export const dynamic = "force-dynamic";

/** Campos cuja presença/ausência a FASE 12 precisa medir. */
const CAMPOS_MEDIDOS = [
  "product_id",
  "product_title",
  "product_main_image_url",
  "product_small_image_urls",
  "product_detail_url",
  "promotion_link",
  "target_sale_price",
  "target_sale_price_currency",
  "target_original_price",
  "sale_price",
  "original_price",
  "first_level_category_name",
  "second_level_category_name",
  "shop_id",
  "shop_name",
  "sku_id",
  "lastest_volume",
  "evaluate_rate",
  "discount",
  "commission_rate",
  "tax_rate",
] as const;

/** Ausência de estoque/frete/GTIN é o que faz `capabilities` ser `false`. */
const CAMPOS_AUSENTES_ESPERADOS = [
  "stock",
  "stock_quantity",
  "quantity",
  "shipping",
  "shipping_fee",
  "delivery_time",
  "gtin",
  "ean",
  "upc",
  "brand",
  "manufacturer_model",
  "mpn",
] as const;

/**
 * Redige uma URL para host + assinatura de forma.
 * Nunca devolve o valor completo: `promotion_link` tem token de afiliado e
 * `product_detail_url` pode carregar `pdp_npi` com preço.
 */
function urlRedigida(valor: unknown): {
  presente: boolean;
  host: string | null;
  assinatura: string | null;
} {
  if (typeof valor !== "string" || valor.trim() === "") {
    return { presente: false, host: null, assinatura: null };
  }
  const bruto = valor.trim();
  try {
    const url = new URL(bruto);
    const chaves = [...url.searchParams.keys()].sort();
    return {
      presente: true,
      host: url.hostname.toLowerCase(),
      assinatura:
        chaves.length > 0
          ? `${url.pathname}?${chaves.map((k) => `${k}=<redacted>`).join("&")}`
          : url.pathname,
    };
  } catch {
    // Não é URL: reporta só que havia string, sem devolver o conteúdo.
    return { presente: true, host: null, assinatura: "<nao-parseavel>" };
  }
}

function relatorioPresenca(payload: Record<string, unknown>) {
  const presentes: string[] = [];
  const vazios: string[] = [];
  for (const campo of CAMPOS_MEDIDOS) {
    const valor = payload[campo];
    if (valor === undefined || valor === null || valor === "") vazios.push(campo);
    else presentes.push(campo);
  }
  return {
    presentes: presentes.sort(),
    ausentes_ou_vazios: vazios.sort(),
    /*
     * `sku_id` é a decisão de identidade mais importante da fase. Se vier
     * preenchido, continua sendo um VALOR (uma variante), não uma lista de
     * eixos — e por isso não pode virar `externalListingId`. O relatório diz
     * explicitamente qual das duas coisas aconteceu.
     */
    sku_id: {
      presente: presentes.includes("sku_id"),
      tipo: payload.sku_id === undefined ? "ausente" : typeof payload.sku_id,
      eixos_estruturados: false,
      leitura: "valor opaco de variante; nao entra em externalListingId",
    },
    promotion_link: urlRedigida(payload.promotion_link),
    product_detail_url: urlRedigida(payload.product_detail_url),
    product_main_image_url: urlRedigida(payload.product_main_image_url),
  };
}

function ausentesNaoSolicitados(payload: Record<string, unknown>) {
  return CAMPOS_AUSENTES_ESPERADOS.filter((campo) => {
    const valor = payload[campo];
    return !(valor === undefined || valor === null || valor === "");
  });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json(
      { success: false, error: "Acesso não autorizado." },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const productId = url.searchParams.get("product_id")?.trim() || null;
  const keyword = url.searchParams.get("keyword")?.trim() || null;

  if (!productId && !keyword) {
    return NextResponse.json(
      {
        success: false,
        error: "Informe ?product_id=<id> ou ?keyword=<texto>.",
      },
      { status: 400 },
    );
  }

  // Presença de credencial SEM ler o valor.
  const credenciais = {
    ALIEXPRESS_APP_KEY: Boolean(process.env.ALIEXPRESS_APP_KEY?.trim()),
    ALIEXPRESS_APP_SECRET: Boolean(process.env.ALIEXPRESS_APP_SECRET?.trim()),
  };

  const resposta: Record<string, unknown> = {
    success: true,
    somenteLeitura: true,
    credenciaisPresentes: credenciais,
  };

  if (productId) {
    try {
      const produto = await buscarProdutoApi(productId);
      const payload = produto as unknown as Record<string, unknown>;
      resposta.productdetail = {
        ok: true,
        metodo: "aliexpress.affiliate.productdetail.get",
        campos: relatorioPresenca(payload),
        /*
         * Se algum destes aparecer, a capability declarada (`false`) está
         * errada e o conector precisa ser corrigido antes de ativar.
         */
        campos_inesperados_presentes: ausentesNaoSolicitados(payload),
        identidade: {
          gtin: null,
          brand: null,
          mpn: null,
          manufacturer_model: null,
          motivo:
            "a API nao devolve nenhum dos quatro; collectStrongEvidence nunca dispara => EXACT inalcancavel",
        },
      };
    } catch (error) {
      resposta.productdetail = {
        ok: false,
        metodo: "aliexpress.affiliate.productdetail.get",
        erro: error instanceof Error ? error.message.slice(0, 300) : "desconhecido",
      };
    }
  }

  if (keyword) {
    try {
      const resultado = await buscarAliExpress({
        query: keyword,
        normalizedQuery: keyword.toLowerCase(),
        limit: 5,
        mode: "DEFAULT",
      });
      const primeiros = resultado.candidates.slice(0, 3).map((candidato) => ({
        externalId: candidato.externalId,
        status: candidato.status,
        preco: candidato.price,
        precoAnterior: candidato.oldPrice,
        temLink: Boolean(candidato.affiliateLink),
        hostDoLink: urlRedigida(candidato.affiliateLink).host,
        hostDaFonte: urlRedigida(candidato.sourceUrl).host,
        titulo: (candidato.title ?? "").slice(0, 80),
      }));
      resposta.productquery = {
        ok: true,
        metodo: "aliexpress.affiliate.product.query",
        searchOutcome: resultado.searchOutcome ?? null,
        /*
         * `scanned` é a diferença entre "a API não devolveu nada" e
         * "a API devolveu e os filtros legados eliminaram tudo". Sem esta
         * distinção, os dois casos aparecem iguais no relatório do canário.
         */
        scanned: resultado.scanned,
        candidatos: resultado.candidates.length,
        erro: resultado.error ? resultado.error.slice(0, 300) : null,
        bloqueados: resultado.blockedSources ?? [],
        inutilizaveis: resultado.unusableSources ?? [],
        fontesTentadas: resultado.sourcesTried ?? [],
        amostra: primeiros,
      };
    } catch (error) {
      resposta.productquery = {
        ok: false,
        metodo: "aliexpress.affiliate.product.query",
        erro: error instanceof Error ? error.message.slice(0, 300) : "desconhecido",
      };
    }
  }

  return NextResponse.json(resposta);
}
