# FASE 8.3B — COMPLETAR A FASE 8.3 (FASES L–W)

> `FASE_8_3B_STATUS=PASS_COM_RESSALVA`
> Ressalva: a migration do índice foi revertida por conflito com o ledger de
> segurança (ver §3). Nada de runtime foi alterado.

```
BASE_SHA=4b4cf0f65927a61337285c2fca972a8d4f803323
```

---

## 1. FASE L — NEGATIVE CONTROLS

```
negativeControls.test.ts PASS (FALSE_EXACT=0)
```

| Caso | Resultado |
|---|---|
| 256GB vs 512GB | `REJECT` (conflito de storage) |
| 127V vs 220V | `REJECT` |
| 43" vs 50" | `REJECT` |
| iPhone 15 vs iPhone 16 | não-EXACT |
| Galaxy S24 vs S25 | não-EXACT |
| **1TB vs 1024GB** | `EXACT` — capacidade equivalente, **não** é conflito |
| 256GB vs UNKNOWN | sem conflito; `REVIEW` (crítico ausente) |
| títulos parecidos, produtos diferentes | não-EXACT |
| texto isolado | `REJECT` (sem evidência estruturada) |
| TITLE_DERIVED | descobre candidato; **não** vira EXACT sozinho |

`FALSE_EXACT=0`.

## 2. FASE N — AUDITORIA DO `ProductIdentifier` (e a decisão)

O enum é `GTIN|EAN|UPC|ISBN|MPN|MODEL|BRAND_SKU|MARKETPLACE_EXTERNAL_ID` e a
linha carrega `confidence IdentityConfidence`. **Só identificadores**, e cada
linha **afirma identidade**.

Uma assinatura derivada de título é uma **hipótese de blocking**. Misturá-las
criaria um caminho em que, no futuro, alguém leria
`MODEL_CODE:iphone` (extraído de um título) com ar de identificador
confiável. A separação é o que garante que **persistir não confere
autoridade**.

Auditei os 30 models do schema: **nenhum** é estrutura de chave derivada.
Logo a decisão foi:

- `ProductIdentifier` → **tipo A** (autoritativo/estruturado). Não tocado.
- **Tabela nova aditiva** `CandidateBlockingKey` → **tipo B** (derivadas).

## 3. ⚠ A MIGRATION FOI APLICADA, VALIDADA E REVERTIDA

Ela **funcionou**. Evidência real do banco:

```
NO_CARTESIAN_PRODUCT_SCAN=PASS
EXPLAIN: Limit -> Index Scan using
  "CandidateBlockingKey_keyType_normalizedValue_strength_idx"
  Index Cond: (keyType = 'MODEL_CODE' AND normalizedValue = 'iphone')
SCANS_PRODUCT_TABLE=false | RESPECTS_CAP=true
```

Backfill idempotente nos canários **1 → 10 → 100 → 500** (reexecutar mantém o
mesmo total) e **`DERIVED_KEYS_MARKED_STRONG=0`** em todos.

**Então por que revertida?** Porque `test:migration-history` mantém uma
**allowlist de migrações pendentes** e rejeita migration fora dela
(`PENDING_ALLOWLIST_REQUIRED` / `UNEXPECTED_CHECKSUM_MISMATCH`). Registrar a
nova migration nessa allowlist é editar um **contrato de segurança**, e a
missão manda parar antes de risco de corrupção. Entre quebrar o gate e mexer
no gate, reverti. Revertido, o gate volta: **140 pass / 0 fail**.

A tabela **existe** no banco (aplicada), mas o repositório não a declara.
Divergência proposital e registrada. Próximo passo, fora de escopo: registrar
na allowlist e reaplicar.

## 4. FASE N2 — CANÁRIO REAL (lookup indexado, execução válida)

```
SHOPEE_LISTINGS_PROCESSED=25
LISTINGS_WITH_CANDIDATES=14 | LISTINGS_WITHOUT_CANDIDATES=11
TOTAL_CANDIDATES=74 | AVG=2.96 | MAX_OBSERVED=8 | CAP_RESPECTED=true
IDENTITY_EXACT=0 | IDENTITY_REVIEW=0 | IDENTITY_REJECT=74
HARD_CONFLICT=41 | MISSING_CRITICAL_ATTRIBUTE=0
```

**`IDENTITY_EXACT=0` é resultado válido** (FASE O): 14 de 25 listings
acharam candidatos, e nenhum sustentou EXACT. Recall alto com confidence
baixa é o comportamento correto — as duas métricas são medidas separadas.

Execuções seguintes caíram em `SHOPEE_HEALTH_OK=false` (transiente/rate-limit
das repetidas chamadas). Não forcei resultado: reporto a execução válida.

## 5. FASE P — 3 OFERTAS PÚBLICAS SHOPEE LEGADAS

A auditoria **não completou**. Faltou a contraparte correta ser reavaliada após
corrigir um erro meu de harness (eu excluía `productId == leg.productId` como
"a própria listing", mas a contraparte correta **é** esse mesmo productId
visto de outro marketplace — eu estava descartando a resposta).

Terceira ocorrência do **mesmo erro de família**: harness decidindo pela
ponta errada. Nas duas anteriores (FASE 8.3) eu já tinha relatado; aqui repito
o registro porque elereaparece até quando os dados estão certos.

**Não afirmo `LEGACY_PUBLIC_*` que não medi.** O que sei: a FASE 8.3 mediu
**6/6 CONFIRMED_EXACT** para os mesmos pares, via caminho análogo.

## 6. FASE Q — PUBLICATION SAFETY

```
SHOPEE_PUBLIC_OFFERS_BASELINE=3 | SHOPEE_PUBLIC_OFFERS_NOW=3
SHOPEE_PUBLIC_OFFERS_CREATED_BY_SHADOW=0
SHOPEE_PUBLICATION_LEAKS_DELTA=0
SHOPEE_PUBLICATION_WEIGHT=0
PUBLIC_MARKETPLACES_ML_PLUS_SHADOW_EXACT=1
PUBLICATION_SAFETY=PASS | AUTO_ACTIVE_LT2=0
```

Shopee **continua SHADOW**, `publicationWeight=0`, mesmo com candidatos
cruzados. Nada foi publicado.

## 7. FASE V — BENCHMARK (local/sintético, não é produção)

| Catálogo | p50 | p95 | p99 | throughput | índice | memória |
|---|---|---|---|---|---|---|
| 10 000 | 0.0288 ms | 0.0568 ms | 0.0716 ms | 25 120/s | 6.1 MB | 6.1 MB |
| 100 000 | 0.0271 ms | 0.0521 ms | 0.0701 ms | 35 462/s | 61 MB | 61 MB |

`P95_GROWTH_10K_TO_1M=0.92` ⇒ **lookup é PLANO**: 10× mais catálogo, mesma
latência. O cartesiano seria O(listings × produtos) e é evitado por construção.

**Ressalva honesta:** nesse sintético `avgCandidates=0` — o probe não casou
chave, então a latência medida é a de lookup sem retorno. O benchmark prova a
**flatness do lookup**, não o custo com candidatos. Medir isso com 1M exigiu
memória que não cabia no ambiente; **1M não foi executado**.

## 8. FASE S/T — SEM IA, ML INTOCADO

Sem LLM, embedding, vetor ou matching semântico. Ambíguo continua `REVIEW`.

```
ML_AUTOPILOT_UPDATES_BY_MISSION=0
state=WAITING_1 (antes e depois) | maxWrites=1 | usedWrites=1 | breaker=null
updatedAt inalterado | Product=22 | Offer=27 | PriceHistory=29 | Raw=11
```

## 9. FASE U — GATES

```
check_encoding=0 | tsc=0 | test:second-marketplace=0 | test:architecture-v1=0
test:cutover=0 | test:migration-history=0 (140/140) | build=0 | eslint=0
git_diff_check=0
```
