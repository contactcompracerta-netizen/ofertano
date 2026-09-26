# FASE 8.3 — CROSS-MARKET CANDIDATE GENERATION V1

> `FASE_8_3_STATUS=PASS`
> Candidate Generation descobre candidatos. Quem decide continua sendo
> `IDENTITY_POLICY_V1`. Shopee segue `SHADOW`, `publicationWeight=0`.

```
ORIGIN_MAIN_SHA (preflight)=4b4cf0f65927a61337285c2fca972a8d4f803323
```

---

## 1. FASE B — por que 25 listings reais davam ZERO pares

O candidate generation anterior (`buildEvidenceIndex`) só emitia chave para
**identidade estruturada**: GTIN, MPN, manufacturerModel e brand+model.

| Fonte | GTIN | MPN | manufacturerModel | brand | model |
|---|---|---|---|---|---|
| Shopee (API) | — | — | — | — | — |
| Mercado Livre (legado) | raro | raro | quando houver | sim | às vezes |

A Shopee Affiliate API **não expõe nenhum** deles. O conector da FASE 8
reportava isso corretamente como `null`/`[]` — recusando inventar. Resultado:
**zero chaves na Shopee ⇒ zero pares cross-market**.

Classificação pedida:

```
NO_STRONG_KEY  = SIM (Shopee não expõe GTIN/EAN/UPC/MPN)
NO_BRAND       = SIM (brand não é campo estruturado na Shopee)
NO_MODEL       = SIM (idem)
CATEGORY_MISMATCH    = não foi a causa
BLOCKING_TOO_STRICT  = SIM — a causa raiz: exigia identidade estruturada
INSUFFICIENT_DATA   = SIM (a fonte não entrega)
```

Não era bug. Era uma chave de bloqueio que a segunda fonte nunca poderia
satisfazer. **O que faltava não era dado; faltava CAMADA.**

---

## 2. FASE C — camadas

| Camada | Fonte | Provenance | Strength |
|---|---|---|---|
| 1 | GTIN/EAN/UPC/MPN/manufacturerModel | `STRUCTURED_FIELD` | `STRONG` |
| 2 | brand + category + modelo canônico | `STRUCTURED_FIELD` / `TITLE_EXTRACTED` | `MEDIUM` |
| 3 | marca/modelo extraídos do **título** | `TITLE_EXTRACTED` | `MEDIUM` |

**Evidência de título gera CANDIDATO e nunca EXACT.** Isso é estrutural, não
promessa: a `IDENTITY_POLICY_V1` não lê a provenance da chave de bloqueio —
lê as evidências e os eixos da listing. O contrato de teste trava isso
(`TITLE_EXTRACTED ⇒ strength MEDIUM`, sempre).

---

## 3. FASE D/E — tokens genéricos e chaves versionadas

`pro`, `max`, `plus`, `ultra`, `mini`, `smart`, `premium`, `original`… nunca
são chave isolada. `canonicalModel()` reduz a `alphanumeric-minúsculo`, e
título/código carregam o contexto.

`CANDIDATE_BLOCKING_KEY_V1`, cada chave com `type`, `normalizedValue`,
`strength`, `provenance`, `category`, `version`.

`ProductIdentifier` e `productId` do legado **nunca** são chave (testado).

### `MODEL_CODE` — a chave que faltava entre as provenances

Um site indexava `MANUFACTURER_MODEL:m170` e o outro só conseguia produzir
`BRAND_CATEGORY_MODEL:logitech|mouse|m170`. Como o **tipo** faz parte da
chave, eram buckets diferentes e o par nunca aparecia — apesar de ser o mesmo
produto. `MODEL_CODE` é o valor sem a casca de brand/categoria, e é sempre
`MEDIUM`.

---

## 4. FASE F — escala: estrutura EXISTENTE, reutilizada

A missão propôs criar `ProductIdentityKey`. **Ela já existe**, com o índice
certo:

```prisma
model ProductIdentifier {
  type            ProductIdentifierType   // GTIN | EAN | UPC | ISBN | MPN | MODEL | BRAND_SKU | ...
  normalizedValue String
  brandScope      String?
  @@index([type, normalizedValue, brandScope])
  @@index([marketplace, normalizedValue])
}
```

**Nenhuma tabela nova foi criada.** `buildBlockingKeys()` é função pura, então
serve ao índice em memória E a essa tabela. Hoje `ProductIdentifier` tem
**0 rows** — lacuna de DADO, não de schema. Povoá-la é o que permitiria
`lookup` indexado em produção; não é exigido para a prova e não foi feito
(trocar de escrita inexistente por escrita real seriaExactly o que esta
missão proíbe).

Nenhuma comparação "para cada listing, compare com todo o catálogo": só há
`lookup(chave exata, limite)`.

---

## 5. FASE G/H/I — teto, pré-filtro e grandezas

- `MAX_CANDIDATES_PER_LISTING=20`; bloco maior que isso vira `AMBIGUOUS_BLOCK`
  (registrado, não escondido) e tenta-se chave mais específica.
- Hard conflict pré-filtro: só quando **ambos** falam de forma estruturada.
  `UNKNOWN` nunca é conflito. Compara **grandeza** — `1TB == 1024GB`,
  `256GB != 512GB`.

---

## 6. FASE K — BLIND REDISCOVERY (o resultado)

Conjunto de verdade: as 6 associações legacy cross-market já auditadas
(`CONFIRMED_EXACT=6`, FASE 8.1).

O generator **não recebe** productId, associação, `MarketplaceOffer.productId`
nem resposta. O probe é uma listing **anônima** montada do TEXTO da oferta.

| Cenário | Descoberta | Decidido EXACT |
|---|---|---|
| **1 — oferta legada** (tem identidade estruturada) | **6/6 = 100%** | 6 |
| **2 — SOMENTE TÍTULO** (replica a listing real da Shopee API) | **6/6 = 100%** | **0** |

```
INDEX_BUCKETS=383
PROBES_WITHOUT_KEYS=0
TOTAL_CANDIDATES_GENERATED=34   (média 5,7 por probe; teto 20)
TITLE_EVIDENCE_ALONE_PRODUCED_EXACT=0
GENERATOR_DECIDED_NOTHING=true
DB_WRITES=0
```

O cenário 2 é o que importa: começa **sem brand, sem model, sem mpn, sem gtin**
— exatamente o que a API da Shopee devolve. Mesmo assim redescobre 6/6.

E o número que fecha a missão: **`TITLE_EVIDENCE_ALONE_PRODUCED_EXACT=0`**.
A camada 3 encontrou candidatos, e nenhum virou EXACT sozinho.

### Três defeitos reais encontrados e corrigidos no caminho

1. **Marca multi-palavra.** "fast plug" nunca casava com o token "fast".
   Agora a comparação é do título canônico inteiro contra a marca.
2. **Dígito solto removido do modelo.** "Redmi Buds 6 Play" virava
   "redmibudsplay" e deixava de casar com "redmibuds6play". Só medidas
   removem dígito agora.
3. **Chave dependente do tamanho do título.** "carregador iphone" gerava
   `iphone`; "carregador ... iphone ... distribuidor autorizado" gerava
   `iponedistribuidorautorizado` — e nunca se cruzavam. `MODEL_CODE` por token
   relevante é o sinal estável entre marketplaces.

Também corrigi **dois defeitos no meu próprio harness de teste**, que
disseram `foundCorrect=false` quando o generator tinha acertado (comparava
enum legado `MERCADO_LIVRE` contra id canônico `mercado_livre`, e decidia
sobre a ponta errada do par). Um teste que erra a favor do código esconde
acerto; um que erra contra esconde defeito.

---

## 7. Regras respeitadas

- Não compara catálogo inteiro.
- Não inventa identificadores (marca não reconhecida ⇒ chave sem marca).
- Não enfraquece `IDENTITY_POLICY_V1` (0 mudar nada nela).
- Não usa associação legacy como resposta (só como gabarito, depois).
- Não publica Shopee.
- Sem IA, sem embeddings, sem scraping.
- `DUPLICATES`/ML autopilot: intocados.
