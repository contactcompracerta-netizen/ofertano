/**
 * VALIDAÇÃO ESTRITA DE ALVO — Mercado Livre.
 *
 * POR QUE ISTO EXISTE
 *
 * `MarketplaceOffer` não representa um produto: representa um ANÚNCIO —
 * marketplace + seller + preço. O catálogo `/p/MLB{catalogId}` pode ser
 * exatamente o mesmo produto físico e mesmo assim ser um anúncio diferente,
 * com outro preço e outro vendedor. Publicar o preço de uma oferta apontando
 * para o link de outra é errar duas vezes: o preço mente e a comissão vai
 * para o seller errado.
 *
 * A validação anterior aceitava TRÊS marcadores: o `expectedItemId` original,
 * o `catalogId` resolvido e o `itemId` resolvido. Com o catálogo aceito
 * sozinho, um link de catálogo validava sem jamais mencionar o anúncio da
 * oferta. Medido em produção: 12 das 22 ofertas ML têm
 * `externalId != catalogId`, então essa porta estava aberta em mais da metade
 * do backlog.
 *
 * O NOVO CONTRATO
 *
 *   Se `expectedItemId` existe, o link só é válido quando o destino prova o
 *   MESMO MLB daquela oferta. `CATALOG_ID_ONLY` nunca basta.
 *
 * `WRONG_PRODUCT=0` continua insuficiente como critério: ele mede se o
 * produto físico é o certo, e não diz nada sobre qual anúncio foi monetizado.
 * Por isso existe `WRONG_OFFER_TARGET`.
 *
 * Este módulo é PURO: sem rede, sem Chrome, sem login. É a parte que precisa
 * de teste determinístico, e a lógica não deveria estar atrás de um navegador.
 */

/** Uma evidência de que a URL do link aponta para o anúncio esperado. */
export type TargetEvidence =
  /** MLB aparece na path/query como identificador de anúncio. */
  | { kind: "ITEM_ID"; mlb: string; via: string }
  /** `pdp_filters` do catálogo com `item_id:<MLB>`. */
  | { kind: "PDP_FILTER_ITEM_ID"; mlb: string; via: string };

export type StrictTargetVerdict =
  | { ok: true; evidence: TargetEvidence[] }
  | { ok: false; reason: string; catalogOnly: boolean };

function normalizarMlb(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const limpo = valor.trim().toUpperCase().replace(/_/g, "-");
  if (!/^MLB-?\d{5,}$/.test(limpo)) return null;
  return limpo.startsWith("MLB-") ? limpo : `MLB-${limpo.slice(3)}`;
}

/**
 * MLB de ANÚNCIO na URL.
 *
 * A distinção entre "página de catálogo" e "permalink de anúncio" NÃO é
 * "a path contém /p/". Um permalink real do ML tem as duas coisas:
 *
 *   /Notebook-X/MLB-7681144154-apple-...-p/MLB25263382
 *
 * O `/MLB-<id>` com HÍFEN no slug é o anúncio; o `/p/MLB<id>` sem hífen no
 * sufixo é o catálogo que o hospeda. Rejeitar toda URL que contenha `/p/`
 * descartaria o formato correto e deixaria passar só a página de catálogo —
 * exatamente o inverso do que a validação estrita precisa.
 *
 * Então a forma de catálogo é reconhecida pelo formato INTEIRO do pathname
 * (`/p/MLB<digits>` e nada mais), não pela presença do segmento.
 */
export function extractExactItemMlId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  // Parâmetro explícito é a prova mais direta de anúncio.
  for (const chave of ["item_id", "wid", "itemId"]) {
    const normalizado = normalizarMlb(u.searchParams.get(chave));
    if (normalizado) return normalizado;
  }

  const path = decodeURIComponent(u.pathname);

  // Catálogo isolado: só o segmento /p/, sem slug de anúncio.
  if (/^\/p\/MLB-?\d+\/?$/i.test(path)) return null;

  // Slug de anúncio. O hífen é o que o ML usa aqui; o sufixo /p/MLB<id>
  // do catálogo não tem hífen e, sozinho, não prova anúncio.
  const slug = path.match(/\/MLB-(\d{5,})\b/i);
  if (slug) return normalizarMlb(`MLB-${slug[1]}`);

  const solto = path.match(/(?:^|\/)MLB-?(\d{5,})\b/i);
  if (solto) return normalizarMlb(`MLB${solto[1]}`);

  return null;
}

/** MLB do catálogo na forma `/p/MLB...`. */
export function extractCatalogMlId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  // O sufixo de catálogo aparece como `/p/MLB<id>` na página de catálogo e como
  // `-p/MLB<id>` no fim do permalink de anúncio. Ambos precisam ser lidos: o
  // segundo é o que revela que um link "de anúncio" também é página de catálogo.
  const m = decodeURIComponent(u.pathname).match(/(?:\/|-)p\/(MLB-?\d+)/i);
  return m ? normalizarMlb(m[1]) : null;
}

/**
 * Todos os `item_id:` presentes num filtro do catálogo.
 *
 * Usado para o diagnóstico, não para aprovar: quando o filtro traz um MLB
 * DIFERENTE do esperado, o destino aponta para outro anúncio da mesma
 * página — o modo de falha que `WRONG_PRODUCT` não enxerga, porque o produto
 * físico é o mesmo.
 */
export function extrairItemIdsDosFiltros(filtro: string): string[] {
  const out: string[] = [];
  for (const m of filtro.matchAll(/item_id:\s*(?:MLB-?)?(\d{5,})\b/gi)) {
    const normalizado = normalizarMlb(`MLB${m[1]}`);
    if (normalizado && !out.includes(normalizado)) out.push(normalizado);
  }
  return out;
}

/**
 * Coleta as evidências de anúncio na URL de destino.
 *
 * `pdp_filters` é a prova mais forte para página de catálogo: carrega
 * `item_id:<MLB>` e identifica o anúncio exato dentro do catálogo. Sem ele, a
 * página é o catálogo inteiro, e catálogo não é anúncio.
 */
export function collectTargetEvidence(
  destino: string,
  expectedItemId: string,
): TargetEvidence[] {
  const esperado = normalizarMlb(expectedItemId);
  if (!esperado) return [];

  const evidencia: TargetEvidence[] = [];
  let u: URL;
  try {
    u = new URL(destino);
  } catch {
    return [];
  }

  // 1) MLB de anúncio na path (fora da forma /p/).
  const mlbPath = extractExactItemMlId(destino);
  if (mlbPath === esperado) {
    evidencia.push({ kind: "ITEM_ID", mlb: mlbPath, via: "path/item_id" });
  }

  // 2) pdp_filters do catálogo carregando o item_id esperado.
  //
  // Esta é a única prova que aceita a página de catálogo: `pdp_filters`
  // identifica QUAL anúncio dentro do catálogo. Sem ele, `/p/MLB...` é o
  // catálogo inteiro — todos os sellers, todos os preços — e não o anúncio
  // que esta oferta representa.
  for (const chave of ["pdp_filters", "pdpFilters"]) {
    const bruto = u.searchParams.get(chave);
    if (!bruto) continue;
    const decodificado = (() => {
      try {
        return decodeURIComponent(bruto);
      } catch {
        return bruto;
      }
    })();

    const presentes = extrairItemIdsDosFiltros(decodificado);
    if (presentes.includes(esperado)) {
      evidencia.push({
        kind: "PDP_FILTER_ITEM_ID",
        mlb: esperado,
        via: chave,
      });
    }
  }

  return evidencia;
}

/**
 * Veredito estrito. Retorna `ok:false` com `catalogOnly:true` quando a única
 * pista é o catálogo — o caso que a validação anterior deixava passar.
 */
export function validateExactOfferTarget(
  destino: string,
  expectedItemId: string | null | undefined,
): StrictTargetVerdict {
  const esperado = normalizarMlb(expectedItemId);

  if (!esperado) {
    return {
      ok: false,
      reason: "Oferta sem externalId: não há MLB de anúncio para provar o alvo.",
      catalogOnly: false,
    };
  }

  if (!destino?.trim()) {
    return {
      ok: false,
      reason: "Link de afiliado vazio.",
      catalogOnly: false,
    };
  }

  // Guarda de forma: nada de fallback genérico nem URL comum.
  let u: URL;
  try {
    u = new URL(destino);
  } catch {
    return {
      ok: false,
      reason: "Link de afiliado não é URL parseável.",
      catalogOnly: false,
    };
  }

  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const ehMeliLa = host === "meli.la" || host.endsWith(".meli.la");
  const ehMl =
    host === "mercadolivre.com.br" ||
    host.endsWith(".mercadolivre.com.br") ||
    host === "mercadolibre.com" ||
    host.endsWith(".mercadolibre.com");

  if (!ehMeliLa && !ehMl) {
    return {
      ok: false,
      reason: `Host não é oficial Mercado Livre: ${host}.`,
      catalogOnly: false,
    };
  }

  // Fallback genérico: nunca é alvo de anúncio.
  if (ehMeliLa && u.pathname.replace(/\/+$/, "").toLowerCase() === "/1i7te2c") {
    return {
      ok: false,
      reason: "Fallback genérico meli.la/1i7Te2C não identifica anúncio.",
      catalogOnly: false,
    };
  }

  const evidence = collectTargetEvidence(destino, esperado);
  if (evidence.length > 0) {
    return { ok: true, evidence };
  }

  // Diagnóstico: o destino menciona anúncios, mas não o esperado. É o modo de
  // falha mais perigoso dos dois — mesmo produto, mesmo catálogo, anúncio
  // ERRADO. O preço e o seller exibidos seriam os de outra oferta.
  //
  // Duas fontes de "outro anúncio": o slug do permalink (que é o caso comum —
  // permalink de anúncio aponta para o anúncio que ele nomeia) e o
  // `item_id` dentro de `pdp_filters`.
  const citados: string[] = [];
  for (const c of [extractExactItemMlId(destino), ...extrairItemIdsDosFiltros(u.search)]) {
    if (c && !citados.includes(c)) citados.push(c);
  }
  const outros = citados.filter((c) => c !== esperado);
  if (outros.length > 0) {
    return {
      ok: false,
      reason:
        `Destino aponta para outro anúncio (${outros.join(", ")}); ` +
        `a oferta é ${esperado}. Mesmo produto, anúncio diferente — ` +
        `o preço e o vendedor não seriam os da oferta.`,
      catalogOnly: false,
    };
  }

  const catalogo = extractCatalogMlId(destino);
  if (catalogo) {
    // Mesmo MLB em /p/ ou MLB diferente: em ambos os casos, o destino é a
    // página do catálogo. Catálogo não é anúncio.
    return {
      ok: false,
      reason:
        catalogo === esperado
          ? `Destino é a página de catálogo ${catalogo} sem o item_id do ` +
            `anúncio ${esperado}. CATALOG_ID_ONLY não é validação suficiente.`
          : `Destino aponta para catálogo ${catalogo}; o anúncio da oferta é ` +
            `${esperado}. Não corresponde.`,
      catalogOnly: true,
    };
  }

  return {
    ok: false,
    reason:
      `Destino não carrega evidência do anúncio ${esperado}. ` +
      `CATALOG_ID_ONLY não é aceito.`,
    catalogOnly: false,
  };
}
