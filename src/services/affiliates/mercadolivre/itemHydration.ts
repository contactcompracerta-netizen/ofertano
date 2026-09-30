/**
 * HIDRATAÇÃO DO ANÚNCIO EXATO.
 *
 * POR QUE ISSO EXISTE
 *
 * As 22 ofertas ML em produção guardam `sourceUrl` de CATÁLOGO (`/p/MLB...`),
 * e em 12 delas o `externalId` do anúncio difere do `catalogId`. Gerar o link
 * de afiliado a partir dessa URL produz um link que não identifica o anúncio
 * da oferta — o preço e o vendedor exibidos seriam os de outro anúncio do
 * mesmo produto. `WRONG_PRODUCT=0` não pega isso, porque o produto está certo.
 *
 * A correção é pedir ao ML o permalink do ANÚNCIO, não o do catálogo:
 *
 *   externalId -> getItem(externalId) -> permalink
 *
 * O cliente oficial já existe (`getItem`, com fallback multiget) e é
 * reutilizado. Nenhum cliente novo é criado: um segundo cliente da API do ML
 * divergiria em cabeçalhos, User-Agent, retry e timeouts, e essa divergência
 * só apareceria em produção.
 *
 * Falha de hidratação NÃO é motivo para gerar com a URL de catálogo. Gerar
 * com o catálogo "degraded" é exatamente o caminho que produz link de anúncio
 * errado; então a falha precisa ser explícita e retentável.
 */
import { getItem } from "@/services/importers/mercadolivre/api";
import { isOfficialMercadoLivreUrl } from "./generator";

export const AFFILIATE_INPUT_MODE_EXACT_ITEM = "EXACT_ITEM_PERMALINK" as const;
export type AffiliateInputMode = typeof AFFILIATE_INPUT_MODE_EXACT_ITEM;

export type ItemHydrationResult =
  | {
      ok: true;
      inputMode: AffiliateInputMode;
      /** Permalink oficial do anúncio. */
      permalink: string;
      itemId: string;
      /** MLB do catálogo, quando o anúncio pertence a um. */
      catalogId: string | null;
      /** A permalink realmente é do anúncio hydration resolvido? */
      provaDoAnuncio: boolean;
    }
  | {
      ok: false;
      inputMode: AffiliateInputMode;
      status: "ITEM_HYDRATION_FAILED";
      reason: string;
      /** `RETRY` para erro transitório; `NO_RETRY` para dado ausente. */
      disposition: "RETRY" | "NO_RETRY";
    };

/** `MLB1234567` / `MLB-1234567` -> forma canônica. */
export function canonicalizarMlb(valor: string): string {
  const limpo = valor.trim().toUpperCase().replace(/_/g, "-");
  const digitos = limpo.replace(/^MLB-?/, "");
  return `MLB-${digitos}`;
}

/**
 * MLB na forma que a API aceita.
 *
 * MEDIDO: `GET /items/MLB-7681144154` -> 404 `resource not found`, sem `id`
 * no corpo. `GET /items/MLB7681144154` -> 403 `access_denied`, COM `id` no
 * corpo. A API não reconhece a forma com hífen; o hífen pertence ao namespace
 * do PERMALINK (`/MLB-7681144154-...-p/MLB25263382`), não ao do recurso.
 *
 * Enviar a forma canônica para a API produz 404 garantido — que é
 * indistinguível de "anúncio não existe" e mascara negação de permissão como
 * dado ausente. Por isso as duas formas são funções separadas.
 */
export function mlbParaApi(valor: string): string {
  return `MLB${canonicalizarMlb(valor).replace("MLB-", "")}`;
}

/**
 * A permalink devolvida pela API é mesmo do anúncio pedido?
 *
 * O ML às vezes devolve o permalink de catálogo quando o anúncio já migrou
 * para um produto com página própria. Nesse caso o `id` do item e o MLB da
 * permalink divergem, e usar a permalink seria voltar ao problema original.
 */
export function permalinkProvaAnuncio(
  permalink: string,
  itemIdEsperado: string,
): boolean {
  const esperado = canonicalizarMlb(itemIdEsperado);
  const semHifen = esperado.replace("MLB-", "");

  // item_id / wid explícitos
  try {
    const u = new URL(permalink);
    for (const chave of ["item_id", "wid", "itemId"]) {
      const v = u.searchParams.get(chave);
      if (!v) continue;
      const canon = canonicalizarMlb(v);
      if (canon === esperado) return true;
    }
    // pdp_filters do catálogo identifying o anúncio
    for (const chave of ["pdp_filters", "pdpFilters"]) {
      const bruto = u.searchParams.get(chave);
      if (!bruto && chave === "pdp_filters") continue;
      const alvo = bruto ?? "";
      if (new RegExp(`item_id:\\s*(?:MLB-?)?${semHifen}\\b`, "i").test(alvo)) {
        return true;
      }
    }
    // Slug `/MLB-<id>-` do anúncio
    if (new RegExp(`/MLB-${semHifen}\\b`, "i").test(decodeURIComponent(u.pathname))) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

export type HydrateItemFn = (itemId: string) => Promise<{ id?: string; permalink?: string; catalog_product_id?: string | null } | null>;

export async function hydrateExactItemPermalink(
  itemId: string,
  deps: { getItem?: HydrateItemFn } = {},
): Promise<ItemHydrationResult> {
  const esperado = canonicalizarMlb(itemId);

  // 9+ dígitos: é a menor largura observada para MLB de ANÚNCIO. IDs mais
  // curtos (catalogIds têm 8) não são anúncios, e tratá-los como tais
  // Mandaria o Link Builder para o lugar errado com toda a confiança do fluxo.
  if (!/^MLB-\d{9,}$/.test(esperado)) {
    return {
      ok: false,
      inputMode: AFFILIATE_INPUT_MODE_EXACT_ITEM,
      status: "ITEM_HYDRATION_FAILED",
      reason: `externalId não é um MLB utilizável: ${itemId}`,
      disposition: "NO_RETRY",
    };
  }

  const fn = deps.getItem ?? (getItem as unknown as HydrateItemFn);

  // A API recebe a forma SEM hífen. `esperado` (com hífen) é a forma do
  // permalink e a forma de comparação; confundi-las dá 404 falso.
  const paraApi = mlbParaApi(esperado);

  let item: Awaited<ReturnType<HydrateItemFn>>;
  try {
    item = await fn(paraApi);
  } catch (err) {
    const mensagem = (err as Error)?.message ?? "erro desconhecido";

    // Negação de permissão não é falha transitória: o ML respondeu, e a
    // resposta é "não". Marcar RETRY aqui faz o backfill re-enfileirar a
    // mesma oferta para sempre, e — pior — a oferta fica indistinguível de um
    // erro de rede que o tempo resolveria.
    if (/access_denied|forbidden/i.test(mensagem)) {
      return {
        ok: false,
        inputMode: AFFILIATE_INPUT_MODE_EXACT_ITEM,
        status: "ITEM_HYDRATION_FAILED",
        reason:
          `Mercado Livre recusou ler ${esperado} para esta credencial ` +
          `(${mensagem.slice(0, 200)}). Repetir não muda a resposta.`,
        disposition: "NO_RETRY",
      };
    }

    // Erro de rede/5xx/429: o anúncio pode existir. Retentar.
    return {
      ok: false,
      inputMode: AFFILIATE_INPUT_MODE_EXACT_ITEM,
      status: "ITEM_HYDRATION_FAILED",
      reason: `Falha de rede ao hidratar ${esperado}: ${mensagem}`,
      disposition: "RETRY",
    };
  }

  if (!item || typeof item !== "object") {
    return {
      ok: false,
      inputMode: AFFILIATE_INPUT_MODE_EXACT_ITEM,
      status: "ITEM_HYDRATION_FAILED",
      reason: `getItem(${esperado}) não retornou anúncio.`,
      disposition: "RETRY",
    };
  }

  // O item veio com outro id: a resposta não é sobre o que pedimos.
  if (item.id && canonicalizarMlb(item.id) !== esperado) {
    return {
      ok: false,
      inputMode: AFFILIATE_INPUT_MODE_EXACT_ITEM,
      status: "ITEM_HYDRATION_FAILED",
      reason: `getItem(${esperado}) respondeu com id ${item.id}. Resposta descartada.`,
      disposition: "RETRY",
    };
  }

  const permalink = item.permalink?.trim();
  if (!permalink) {
    return {
      ok: false,
      inputMode: AFFILIATE_INPUT_MODE_EXACT_ITEM,
      status: "ITEM_HYDRATION_FAILED",
      reason: `Anúncio ${esperado} sem permalink na resposta da API.`,
      disposition: "RETRY",
    };
  }

  if (!isOfficialMercadoLivreUrl(permalink)) {
    return {
      ok: false,
      inputMode: AFFILIATE_INPUT_MODE_EXACT_ITEM,
      status: "ITEM_HYDRATION_FAILED",
      reason: `Permalink de ${esperado} não está em domínio oficial do Mercado Livre.`,
      disposition: "NO_RETRY",
    };
  }

  if (!permalinkProvaAnuncio(permalink, esperado)) {
    // Não é falha da infra: a API devolveu o link do catálogo, que é
    // exatamente o que a validação estrita proíbe. Não é retentável.
    return {
      ok: false,
      inputMode: AFFILIATE_INPUT_MODE_EXACT_ITEM,
      status: "ITEM_HYDRATION_FAILED",
      reason:
        `Permalink de ${esperado} não identifica o anúncio ` +
        `(provável página de catálogo). Nada foi gravado.`,
      disposition: "NO_RETRY",
    };
  }

  return {
    ok: true,
    inputMode: AFFILIATE_INPUT_MODE_EXACT_ITEM,
    permalink,
    itemId: esperado,
    // Canonicalizado: a API devolve `MLB25263382`, o resto do código usa
    // `MLB-25263382`. Comparar as duas formas em string seria uma classe de
    // bug silencioso (falso "divergente" ou falso "igual").
    catalogId: item.catalog_product_id?.trim()
      ? canonicalizarMlb(item.catalog_product_id)
      : null,
    provaDoAnuncio: true,
  };
}
