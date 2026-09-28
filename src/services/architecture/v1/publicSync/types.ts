/**
 * CATALOG_ARCHITECTURE_V1 — MARKETPLACE PUBLIC SYNC V1 (FASE 9).
 *
 * Contratos do writer PÚBLICO de marketplace.
 *
 * PRINCÍPIO DE EXTENSIBILIDADE (FASE 9.9):
 *   o core NÃO conhece nome de marketplace. Não existe
 *   `if (marketplaceId === "shopee")` neste módulo. Adicionar uma fonte nova
 *   = criar conector + config + adapter de link de compra.
 *
 * PRINCÍPIO DE AUTORIA (FASE 9.4):
 *   o writer é ATTACH-ONLY. Ele NUNCA cria Product. Uma listing isolada de
 *   marketplace não pode, sozinha, dar origem a um produto single-store.
 *   O Product sempre pré-existe e é resolvido pelo índice de
 *   CandidateBlockingKey.
 *
 * PRINCÍPIO DE RESPOSTA (FASE 9.5 / 9.6):
 *   aceitação SOMENTE com `confidence === EXACT` e `hardConflicts.length === 0`
 *   sobre exatamente UM Product. Dois EXACT = AMBIGUOUS_EXACT = não publica.
 *   `productId` da verdade NUNCA é entregue ao gerador de candidatos.
 */

import type { MarketplaceConnector } from "../types/connector";
import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";
import type { IdentityDecisionV1 } from "../identity/identityConfidence";
import type { BlockingKeyType } from "../identity/candidateGeneration";

/* ------------------------------------------------------------------ */
/* LINKS DE COMPRA (FASE 9.7)                                          */
/* ------------------------------------------------------------------ */

/**
 * Par de links de compra extraídos do payload bruto.
 * NUNCA inventados, NUNCA concatenados por string.
 */
export interface PurchaseLinkSet {
  /** `offerLink` da fonte: link de afiliado. */
  affiliateLink: string | null;
  /** `productLink` da fonte: URL do produto. */
  sourceUrl: string | null;
}

/**
 * Adapter de extração de link. É o ÚNICO ponto onde uma peculiaridade de
 * fonte entra no writer: cada conector declara como ler seus próprios campos
 * de link a partir do payload bruto que preservou.
 */
export interface PurchaseLinkSource {
  /**
   * Lê os links de compra do payload bruto preservado pela coleta.
   * DEVE devolver apenas o que a fonte forneceu — nunca montar URL.
   */
  extract(rawPayload: unknown): PurchaseLinkSet;
}

/* ------------------------------------------------------------------ */
/* IDENTIDADE (FASE 9.5)                                               */
/* ------------------------------------------------------------------ */

export type ProbeIdentityOutcome =
  | "EXACT_UNIQUE"
  | "AMBIGUOUS_EXACT"
  | "REVIEW"
  | "REJECT"
  | "NO_CANDIDATES"
  | "NO_EXACT";

/**
 * Resultado da resolução de identidade de UMA listing.
 * `winnerProductId` só é preenchido em EXACT_UNIQUE.
 */
export interface ProbeIdentityResultV1 {
  marketplaceId: string;
  externalListingId: string;
  /** chaves de bloqueio derivadas da listing (diagnóstico). */
  blockingKeys: Array<{ type: BlockingKeyType; normalizedValue: string }>;
  /** nº de ProductIds distintos devolvidos pelo índice. */
  candidateCount: number;
  /** pares avaliados pela IdentityPolicy. */
  evaluatedPairs: number;
  /** decisions com confidence EXACT. */
  exactProductIds: string[];
  reviewCount: number;
  rejectCount: number;
  hardConflictCount: number;
  outcome: ProbeIdentityOutcome;
  /** EXATAMENTE 1 Product, sem hard conflict. null caso contrário. */
  winnerProductId: string | null;
  /** decisão vencedora, para auditoria. */
  decision: IdentityDecisionV1 | null;
}

/* ------------------------------------------------------------------ */
/* OFERTA (FASE 9.10 / 9.11)                                           */
/* ------------------------------------------------------------------ */

/** Oferta canônica derivada de uma listing aceita. */
export interface PublicOfferDraftV1 {
  marketplaceId: string;
  productId: string;
  externalId: string;
  title: string | null;
  seller: string | null;
  image: string | null;
  price: number;
  sourceUrl: string | null;
  affiliateLink: string | null;
  available: boolean;
  matchStatus: "EXACT";
  discoverySource: "API";
}

/* ------------------------------------------------------------------ */
/* CONFIG (FASE 9.9)                                                   */
/* ------------------------------------------------------------------ */

export interface PublicSyncConfig {
  /** marketplaceId canônico (ex.: "shopee"). */
  marketplaceId: string;
  /** conector de coleta. */
  connector: MarketplaceConnector;
  /** adapter de link de compra (única peculiaridade de fonte). */
  purchaseLinks: PurchaseLinkSource;
  /** teto de listings nesta execução. */
  maxListings: number;
  /** léxico de marcas para derivação de chaves. */
  brandLexicon: ReadonlySet<string>;
}

/* ------------------------------------------------------------------ */
/* DEPENDÊNCIAS INJETÁVEIS (testabilidade sem DB / sem rede)          */
/* ------------------------------------------------------------------ */

export interface BlockingKeyLookup {
  /**
   * Consulta INDEXADA em CandidateBlockingKey.
   * Proibido: full scan de Product, LIKE '%title%', cartesiano.
   */
  lookup(keyType: BlockingKeyType, normalizedValue: string): Promise<string[]>;
}

export interface ProductListingLoader {
  /**
   * Carrega as listings COUNTERPART de um Product para a IdentityPolicy.
   *
   * `probeMarketplaceId` é a fonte da listing em avaliação. O loader DEVE
   * devolver APENAS ofertas de marketplaces DIFERENTES desse: devolver a
   * própria oferta da fonte faria a policy responder SAME_MARKETPLACE (REJECT)
   * e o candidato seria descartado, produzindo um falso NO_EXACT. Por isso o
   * parâmetro existe — sem ele, o Product cujas ofertas EXACT incluem a fonte
   * nunca poderia ser resolvido.
   *
   * Devolve todas as counterparts utilizáveis porque a melhor decisão entre
   * elas é a que vale: um Product pode ter uma oferta em REVIEW e outra
   * corroborando em EXACT.
   */
  loadAll(
    productId: string,
    probeMarketplaceId: string,
  ): Promise<NormalizedMarketplaceListingV1[]>;
}

export type IdentityEvaluator = (
  left: NormalizedMarketplaceListingV1,
  right: NormalizedMarketplaceListingV1,
) => IdentityDecisionV1;

/* ------------------------------------------------------------------ */
/* ASSOCIAÇÃO JÁ CERTIFICADA — KNOWN BINDING (FASE 9, modelo B)        */
/* ------------------------------------------------------------------ */

/**
 * Associação JÁ CERTIFICADA entre uma listing da fonte e um Product.
 *
 * Existe para o caso em que a identidade do PRODUTO já foi resolvida e
 * persistida por um caminho certificado, e a API só precisa devolver
 * ATUALIZAÇÕES DE OFERTA (preço, disponibilidade, link) para a MESMA listing.
 *
 * Isso NAO é uma.IdentityPolicy frouxa: é o oposto. Reaproveitar a
 * associação evita re-derivar identidade a cada coleta, quando a fonte não
 * expõe o atributo estruturado que a policy exige. A distinção é rígida:
 *
 *   - `find` só responde para (marketplace, externalId) JÁ persistido, e
 *     devolve o productId que o gate central já validou;
 *   - uma listing SEM binding não ganha_product por$this canal: ela cai no
 *     caminho de descoberta e precisa de EXACT_unique.
 *
 * `matchStatus` é o status certificado armazenado. O refresh NUNCA promove um
 * status fraco para EXACT: carrega o que está gravado.
 */
export interface KnownBinding {
  productId: string;
  externalId: string;
  /** status de identidade certificado e já persistido. */
  matchStatus: string;
  /** preço vigente, para diagnóstico e freshness. */
  currentPrice: number | null;
  /** link de afiliado vigente, para preservar quando a coleta não trouxer. */
  affiliateLink: string | null;
  /** última vez que a fonte devolveu esta listing, se registrado. */
  lastSeenAt: Date | null;
}

export interface KnownBindingLookup {
  /** Associação certificada por (marketplace, externalId), ou null. */
  find(
    marketplaceId: string,
    externalListingId: string,
  ): Promise<KnownBinding | null>;
  /**
   * Todas as associações certificadas da fonte, para reportar freshness.
   * Uma binding ausente da coleta é NOT_SEEN — e NÃO desassociação, NÃO
   * delete e NÃO demotion. freshness é informação, a demotion é decisão.
   */
  listCertified(marketplaceId: string): Promise<KnownBinding[]>;
}

export interface PublicSyncDeps {
  keys: BlockingKeyLookup;
  products: ProductListingLoader;
  evaluate: IdentityEvaluator;
  /** writer canônico de oferta (injetado para teste). */
  writer: PublicOfferCommitter;
  /**
   * Associações já certificadas. Ausente => todo listing segue o caminho de
   * descoberta (fail-closed, zero escrita sem EXACT).
   */
  knownBindings?: KnownBindingLookup;
  /** relógio injetável. */
  now?: () => Date;
}

/** Resultado do commit de UMA oferta. */
export interface OfferCommitResultV1 {
  productId: string;
  marketplaceId: string;
  externalId: string;
  /** CREATE | UPDATE | NOOP */
  action: "CREATE" | "UPDATE" | "NOOP";
  /** true quando algum campo observável mudou. */
  changed: boolean;
  /** o publication gate central foi executado para este Product. */
  publicationSynced: boolean;
  /** campos que mudaram (diagnóstico, sem valor). */
  changedFields: string[];
}

export type OfferWriteMode = "CREATE" | "REFRESH";

export interface OfferCommitContext {
  dryRun: boolean;
  /**
   * `REFRESH` atualiza uma oferta JÁ EXISTENTE no MESMO Product.
   *
   * Nesse modo o writer PRESERVA o link de afiliado e o `status` vigentes
   * quando a coleta não trouxer um link seguro. Sem essa preservação, um
   * refresh parcial apagaria um link válido e rebaixaria `ACTIVE` para
   * `PENDING_AFFILIATE` — perda de dado causada por ausência de informação,
   * que é o oposto de fail-closed.
   */
  mode: OfferWriteMode;
}

/**
 * Committer de oferta. A implementação real é o caminho canônico de banco;
 * testes injetam um dublê.
 */
export interface PublicOfferCommitter {
  commit(
    draft: PublicOfferDraftV1,
    context: OfferCommitContext,
  ): Promise<OfferCommitResultV1>;
}

/* ------------------------------------------------------------------ */
/* RELATÓRIO (FASE 9.14)                                               */
/* ------------------------------------------------------------------ */

export interface PublicSyncReportV1 {
  MODE: "DRY_RUN" | "APPLY";
  MARKETPLACE_ID: string;
  WRITER_MODE: string;
  ATTACH_ONLY: true;
  MAX_LISTINGS: number;

  LISTINGS_COLLECTED: number;
  /** chamadas de coleta (o conector avanca uma keyword por cursor). */
  COLLECT_CALLS: number;
  /** coleta falhou no meio, mas havia listings anteriores para processar. */
  COLLECT_PARTIAL: boolean;
  LISTINGS_VALID: number;
  LISTINGS_WITH_KEYS: number;
  LISTINGS_WITHOUT_KEYS: number;

  CANDIDATES: number;
  EXACT_UNIQUE: number;
  REVIEW: number;
  REJECT: number;
  HARD_CONFLICT: number;
  AMBIGUOUS_EXACT: number;
  NO_CANDIDATES: number;
  NO_EXACT: number;

  /* ---------------------------------------------------------------- */
  /* DOIS CAMINHOS (modelo B e C)                                      */
  /* ---------------------------------------------------------------- */

  /** Associações certificadas da fonte no início da execução. */
  CERTIFIED_BINDINGS: number;
  /** listings cuja externalId bateu com uma associação certificada. */
  BINDING_REFRESH_MATCHED: number;
  /** dessas, quantas realmente tinham dados de oferta a atualizar. */
  BINDING_REFRESH_WRITES: number;
  /** dessas, quantas já estavam idênticas (idempotência real). */
  BINDING_REFRESH_NOOP: number;
  /** bindings certificadas que a coleta NÃO devolveu. NÃO é desassociação. */
  BINDING_NOT_SEEN: number;
  /**
   * bindings certificadas que o teto desta execucao nao deixou refreshing.
   * Diferente de NOT_SEEN: aqui a binding existe e seria refreshavel, mas o
   * orcamento acabou. Contabilizado a parte para que um canario limitado nunca
   * pareca um catalogo completo.
   */
  BINDING_REFRESH_SKIPPED_BUDGET: number;
  /** detalhamento por binding (sem payload e sem link completo). */
  BINDING_STATUS: Array<{
    externalId: string;
    productId: string;
    certifiedMatchStatus: string;
    seen: boolean;
    previousPrice: number | null;
    refreshedPrice: number | null;
    action: "REFRESH_UPDATED" | "REFRESH_NOOP" | "NOT_SEEN";
  }>;
  /** caminho de descoberta (listings sem binding). */
  NEW_DISCOVERY_LISTINGS: number;

  MISSING_AFFILIATE_LINK: number;
  INVALID_LINK: number;

  WOULD_WRITE: number;
  WRITES: number;
  WRITES_CREATED: number;
  WRITES_UPDATED: number;
  WRITES_NOOP: number;

  /** Products criados pelo writer. Deve ser SEMPRE 0 (attach-only). */
  PRODUCTS_CREATED: number;
  /** Ofertas de marketplaces NÃO-EXACT que passaram a públicas. Deve ser 0. */
  REVIEW_PUBLISHED: number;
  REJECT_PUBLISHED: number;
  HARD_CONFLICT_PUBLISHED: number;
  AMBIGUOUS_PUBLISHED: number;

  PROBES: ProbeIdentityResultV1[];
  ERROR: string | null;
}
