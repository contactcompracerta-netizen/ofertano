# FASE 8 — SEGUNDO MARKETPLACE REAL (ONBOARDING UNIVERSAL + SHADOW V1 + CROSS-MARKET MATCHING)

> Status: **PASS**
> Segundo marketplace: **shopee** (`SECOND_MARKETPLACE_ID=shopee`)
> Modo: **SHADOW ONLY** — não authoritative, não public, não altera a superfície pública.

---

## 1. Seleção da fonte (FASE B / C) — auditada, não presumida

A escolha NÃO partiu de suposição. Todas as fontes com credencial/configuração
existente foram auditadas com chamada real e sem imprimir segredos.

| Fonte | Credencial presente | Chamada real | Dados | Veredito |
|---|---|---|---|---|
| **Shopee** | `SHOPEE_AFFILIATE_APP_ID` + `SHOPEE_AFFILIATE_SECRET` | HTTP **200** | **3 → 25 itens reais** | **SELECIONADA** |
| AliExpress | `ALIEXPRESS_APP_KEY` + `ALIEXPRESS_APP_SECRET` | HTTP 200 | **0 itens** (`EMPTY_RESULT`) | não utilizável |
| Magazine Luiza | `MAGAZINE_LUIZA_BUILD_ID` | — | sem endpoint oficial de catálogo no código | não utilizável |
| Amazon | sem credencial no `.env` | — | — | não utilizável |

**Fonte oficial utilizada:** GraphQL oficial de afiliados
`https://open-api.affiliate.shopee.com.br/graphql` (assinatura `SHA256`).
Nenhum scraping. Nenhuma integração fabricada.

Conclusão: `AUTHORIZED_SOURCE=YES`, `REAL_DATA_AVAILABLE=YES`,
`CREDENTIALS_VALID=YES`, `SHADOW_CAPTURE_POSSIBLE=YES`.

---

## 2. Capacidades declaradas — só o que a fonte REALMENTE expõe

Derivadas do payload `productOfferV2` que a API devolve:

| Capacidade | Valor | Motivo |
|---|---|---|
| `catalog` | **true** | `productName`, `productCatIds`, `imageUrl`, `shopName` |
| `inventory` | **true** | `price`, `priceMin`, `priceMax`, `priceDiscountRate` |
| `stock` | **false** | a API de afiliados não devolve estoque |
| `shipping` | **false** | não devolve frete/peso |
| `seller` | **true** | `shopId`, `shopName` |
| `variants` | **false** | `productOfferV2` não expõe eixos de variação |
| `gtin` | **false** | não expõe GTIN/EAN/UPC |
| `incrementalUpdates` | **false** | GraphQL é por palavra-chave, sem delta |
| `fullSnapshot` | **true** | pagina por cursor até o fim |
| `webhook` | **false** | consulta por polling |
| `pixPrice` | **false** | preço PIX é específico do ML |

Ausência real vira `UNKNOWN`/`null`. **Nada foi inventado**: `gtin: []`
(fonte reportou nenhum), `stock: UNKNOWN` (não `0`), `variant.*: UNKNOWN`.

---

## 3. REGRA CRÍTICA — a shadow NÃO publica (FASE J)

`SHADOW_SOURCE_PUBLICATION_WEIGHT=0`

Enquanto a Shopee estiver na allowlist da shadow:

```
Mercado Livre (público) + Shopee (SHADOW)  =  1 marketplace público
```

Comprovado em três camadas, todas com teste:

1. `countPublicMarketplacesWithWeight()` → `1`
2. `hasPublicMultiStore()` (funil público real: Home, produto, sitemap,
   favoritos, categorias) → `false` — produto auto-criado **não ativa**
3. `evaluatePublicationEligibility()` → `eligible=false`,
   `publicMarketplaceCount=1`, motivo `INSUFFICIENT_PUBLIC_MULTISTORE`

A vem do **registry + allowlist da shadow**, não de `if marketplace === "SHOPEE"`.
Adicionar o marketplace nº 3 não altera nenhum desses arquivos.

### Decisão de projeto que vale registrar

Um marketplace **não registrado** mantém o peso legado (`1`), e **não** é
rebaixado para `0`. Motivo: a extensibilidade da Architecture V1 (FASE E/X) é
contrato — um `marketplaceId` dinâmico precisa fluir pelo pipeline sem mexer no
núcleo. Rebaixar "desconhecido" quebraria `extensibility.test.ts` e
`multiMarketplaceContract.test.ts` (e de fato quebrou, na primeira versão).

Sendo assim, shadow **não é inferida**: é decisão operacional **explícita**
(allowlist). Para que ela não possa ser "esquecida", o readiness exige
`assertSecondMarketplaceIsShadow()` — fora da allowlist, é erro, não detalhe.

---

## 4. Identidade da listing (FASE G)

`UNIQUE(marketplaceId, externalListingId)`.

- `externalListingId` = `itemId` da Shopee.
- O mesmo `externalListingId` em marketplaces diferentes = **2 listings**
  (provado no contract test).
- Seller SKU, URL e GTIN **nunca** identificam listing.

---

## 5. Matching cross-market (FASE K / L / M)

Ordem obrigatória, nunca invertida:

1. **Candidate generation por evidência** — GTIN, brand+model, MPN,
   manufacturerModel. **Nunca** comparação contra o catálogo inteiro.
2. **Hard conflicts** — derrotam similaridade textual alta.
3. **Similaridade textual** — só depois dos conflitos.

| Caso | Resultado |
|---|---|
| 256 GB ≠ 512 GB | `REJECT` |
| 127 V ≠ 220 V | `REJECT` |
| 43" ≠ 50" | `REJECT` |
| modelo A ≠ modelo B | `REJECT` |
| GTIN igual + variante igual | `EXACT` |
| GTIN diferente, texto idêntico | `REJECT` |
| sem evidência alguma | `REJECT` (fail-closed) |

**Bug real encontrado e corrigido durante a validação:** a extração de medidas
agregava armazenamento + voltagem num único conjunto de tokens. `"256GB 127V"`
vs `"512GB 127V"` Sharing `127V` e passava como `EXACT`. Agora as medidas são
comparadas **por eixo**; o conflito de armazenamento passa a ser detectado.

---

## 6. Canário shadow real (FASE H / I) — progressão 1 → 5 → 25

Executado contra a API oficial, `concurrency=1`, teto de 25.

| MAX_WRITES | RAW total | RAW únicos | Escritas | NOOP | OFFER_ONLY | STRUCTURAL | Duplicatas | Replay fails |
|---|---|---|---|---|---|---|---|---|
| 1 | 25 | 25 | 1 | 0 | 0 | 1 | 0 | 0 |
| 5 | 25 | 25 | 5 | 0 | 0 | 5 | 0 | 0 |
| **25** | **25** | **25** | **25** | 0 | 0 | **25** | **0** | **0** |

- `RAW_INVALID_ROWS=0`, `SECRET_LEAKS=0`, `UNEXPECTED_SYSTEM_ERRORS=0`
- `SECOND_MARKETPLACE_SHADOW_READY=YES` (≥10 listagens reais distintas)
- Amostras reais, todas com `stock=UNKNOWN` e `gtin=0` — a ausência da fonte
  aparece como ausência, não como valor inventado.

---

## 7. Hashes, replay e idempotência (FASE O / P)

- payload idêntico → `NOOP` (zero duplicata)
- só preço → `OFFER_ONLY` (`catalogHash` inalterado, sem matching pesado)
- mudança estrutural → `STRUCTURAL`
- replay do mesmo raw, 2× → `NOOP`, zero `RawMarketplaceListing` duplicada
- hashes determinísticos e insensíveis à ordem das chaves

O conector expõe `rawPayloadFor(externalListingId)`: é o bruto **da fonte**,
não a listing já normalizada. Sem isso o replay mediria uma limitação do stub
em vez do pipeline.

---

## 8. Segurança dos links (FASE R)

Allowlist de esquemas: **só `http`/`https`**. Rejeitados:
`javascript:`, `data:`, `file:`, `vbscript:`, `blob:`, `about:`, URL relativa,
credenciais embebidas (`user:pass@`) e hosts locais.

Esquema ofuscado é barrado porque a limpeza de bytes de controle/espaço é feita
**por código de caractere**, antes do parse — `jav<TAB>ascript:` não passa.

---

## 9. Evidência real multi-marketplace (FASE S)

O banco real tem **4 produtos** com ofertas válidas em ≥2 marketplaces:

| Produto | Marketplaces |
|---|---|
| Fone de Ouvido Sem Fio Xiaomi Redmi Buds 6 Play Bluetooth | ML, Shopee, Magazine Luiza |
| Carregador iPhone 20W Fonte Turbo Tipo C | ML, Shopee |
| Fone de Ouvido Bluetooth Sem Fio Bateria Longa Duração | ML, Magazine Luiza |
| Mouse Sem Fio Logitech M170 Cinza [F133] | Magazine Luiza, Shopee |

`REAL_CROSS_MARKET_PRODUCT_MATCHES=4` — **dois deles com Mercado Livre + Shopee**.
Isso é a evidência de que um mesmo produto canônico já aparece em
marketplaceIds distintos, via caminho **legado**. A Shopee nova segue
`SHADOW` e não altera produto público nenhum.

---

## 10. Autopilot do Mercado Livre (FASE T) — apenas auditado

| | Antes | Depois |
|---|---|---|
| `state` | `WAITING_1` | `WAITING_1` |
| `stage` | 1 | 1 |
| `enabled` | true | true |
| `maxWrites` | 1 | 1 |
| `usedWrites` | 1 | 1 |
| breaker (`tripReason`) | null | null |

**Não pausado, não resetado, não editado.** Nenhum `UPDATE` foi emitido.
Progressão `1 → 5 → 25 → 100` do ML **inalterada**.
`CATALOG_V1_GLOBAL_CUTOVER=NO`.

---

## 11. Isolamento (FASE U)

- Shadow allowlist: `shopee` **somente**. O Mercado Livre não entra.
- Breaker, budget, ImportRun e métricas são keyed por `marketplaceId`.
- Falha da Shopee **não** toca o breaker do ML (fonte distinta, sem escrita
  compartilhada, sem mutação do estado do ML).

---

## 12. Observabilidade (FASE V)

Métricas aditivas, todas por `marketplaceId`:
`connector_collect_total`, `connector_collect_failed_total`,
`normalized_listing_total`, `raw_write_total`, `hash_noop_total`,
`hash_offer_only_total`, `hash_structural_total`, `identity_exact_total`,
`identity_review_total`, `identity_reject_total`, `cross_market_match_total`,
`hard_conflict_total`, `shadow_publication_excluded_total`.

---

## 13. Testes (FASE W / X)

`npm run test:second-marketplace` — 5 suítes, todas PASS:

- `safeUrl.test.ts`
- `crossMarketMatching.test.ts`
- `shadowWeight.test.ts`
- `fase8Metrics.test.ts`
- `shopeeConnector.contract.test.ts`

O connector novo passa pelo **mesmo contrato dos FakeConnectors**, sem nenhuma
alteração especial no core. Registrado também em `test:architecture-v1`.

Demais: `test:architecture-v1` (21/21 PASS), `test:cutover` (10/10 PASS),
`test:migration-history` (140/140 PASS), `tsc --noEmit` (0 erros),
`prisma validate` (válido), `check-encoding` (0 mojibake),
`git diff --check` (limpo), ESLint (0 problemas nos arquivos da FASE 8).

---

## 14. FASE Y — deploy

**Deploy NÃO executado: falta credencial.** O projeto Vercel está ligado
(`ofertano` / `prj_KcIMFLniTVvZGIGh1OCIkSE8SsND`), mas neste ambiente:

- `VERCEL_TOKEN` = **UNSET**
- `~/.vercel` (credencial da CLI) = **inexistente**
- CLI `vercel` não instalada no projeto

Sem token não há como autenticar, e inventar um caminho de deploy seria
pior que não deployar. O código está **pronto e empurrado** em
`origin/fase8/second-marketplace-shadow` (`01f5ab3`); basta o merge + as
variáveis de ambiente.

Sequência prevista (a mesma que o código já suporta):

1. `SECOND_MARKETPLACE_SHADOW_ENABLED=OFF` no primeiro deploy.
   Confirmar `githubCommitSha`, produção 200, `AUTO_ACTIVE_LT2=0`,
   autopilot do ML saudável.
2. Só então `ARCHITECTURE_V1_SHADOW_ENABLED=true` +
   `ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS=shopee`.

Produção **não foi tocada** e segue idêntica: probes em `/`, `/robots.txt` e
`/sitemap.xml` retornam **200**.

---

## 15. Bloqueadores

`SECOND_MARKETPLACE_BLOCKER=NONE` (a integração está completa e validada).

`DEPLOY_BLOCKER=VERCEL_TOKEN_UNAVAILABLE` — bloqueia apenas a FASE Y, e é
condição de parada prevista: credencial nova a ser fornecida pelo usuário.
Nada mais ficou pendente.

Limitação conhecida e honesta: a API de afiliados da Shopee **não expõe GTIN**,
`stock` nem eixos de variante. Por isso a identidade cross-market com o
Mercado Livre se apoia em `brand`/`model`/MPN e evidência textual, e
`REAL_CROSS_MARKET_PRODUCT_MATCHES` do *canário* é 0 — o canário roda com uma
amostra isolada da Shopee, sem o catálogo do ML carregado. A evidência real de
produto compartilhado (FASE S) vem do banco, pelo caminho legado, e é 4.

Consequência honesta: para o shadow sair de `SHADOW` e passar a contar como
multiloja pública, será preciso GTIN de fonte autorizada — não há como
sintetizá-lo sem inventar dado.
