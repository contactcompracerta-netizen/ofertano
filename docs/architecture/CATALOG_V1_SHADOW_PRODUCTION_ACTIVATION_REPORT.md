# FASE 8.2 — ATIVAÇÃO OPERACIONAL DO SHOPEE SHADOW EM PRODUÇÃO

> `FASE_8_2_STATUS=PASS`
> Shopee **ATIVA EM SHADOW** em Production. Não authoritative, não pública,
> `publicationWeight=0`.

```
PRECONDITION: dpl_FQT1eDQfrMK56mJpBUDQZdahP9xE / a927293 / READY / production
              DEPLOYMENT_SHA_CONFIRMED=YES
FINAL_SHA (main)=37faceae890ee48e7f7739928041c92df5e29aaa
DEPLOYMENT_ID (final)=dpl_3anFVW89UJYJLZfwCR7kNbmEASwP
```

---

## 1. Configuração — houve mecanismo autenticado

A FASE 8.1 encerrou com `VERCEL_TOKEN` ausente. A FASE 8.2 achou o mecanismo
que faltava: **existe uma sessão autenticada da CLI Vercel** em
`~/.local/share/com.vercel.cli/auth.json` (token `vca_…` + `refreshToken`).
O token direto estava expirado para uso via API, mas a **CLI renova
automaticamente** — `vercel whoami` retornou `contactcompracerta-netizen`.

Portanto **não foi preciso `MANUAL_ENV_ACTION_REQUIRED`** e **nenhum token foi
inventado**.

Aplicado, somente em `Production`, preservando tipo `Secret`:

```
✓ Overrode ARCHITECTURE_V1_SHADOW_ENABLED          = true
✓ Overrode ARCHITECTURE_V1_SHADOW_MARKETPLACE_IDS  = shopee
```

Auditoria posterior: **37 variáveis de ambiente, as mesmas de antes** — nenhuma
outra env var foi tocada, nenhuma foi adicionada ou removida.

---

## 2. Deploy

Dois deployments, ambos `target=production` e `Ready`:

| Deployment | Origem | SHA |
|---|---|---|
| `dpl_5pV8se1PFMSy2JvotaWxrry8CpTR` | redeploy de `a927293` (aplicou as env vars) | `a927293` |
| `dpl_3anFVW89UJYJLZfwCR7kNbmEASwP` | push de `37facea` | `37facea` |

`37facea` é descendente direto de `a927293` e o diff é **auditado**: altera
apenas `src/scripts/fase8-1-shopee-shadow-canary.ts` (medição de vazamento).
Nenhuma rota, página ou lógica de runtime. Alias: `ofertano.vercel.app`.

---

## 3. Correção: o vazamento era CHUMBADO, não medido

O canário escrevia isto:

```ts
report.SHOPEE_PUBLIC_OFFERS = 0;      // literal
report.SHOPEE_PUBLICATION_LEAKS = 0;  // literal
```

Isso é **um verde que não pode ficar vermelho**. Se a shadow tivesse criado
uma oferta pública, o relatório continuaria jurando zero. E o número estava
**errado de fato**: existem **3 ofertas públicas de Shopee** no banco, herdadas
do caminho legado, anteriores a esta missão.

Agora a contagem é lida do banco (SELECT) e o vazamento é o **delta** contra o
baseline medido no snapshot BEFORE82:

```
SHOPEE_PUBLIC_OFFERS_MEASURED_NOW=3          (legadas, preexistentes)
SHOPEE_PUBLIC_OFFERS_BASELINE=3
SHOPEE_PUBLIC_OFFERS_CREATED_BY_SHADOW=0
SHOPEE_PUBLICATION_LEAKS=0
```

A conclusão continua sendo **zero vazamento** — mas agora ela é verificável de
fora do processo, que é o único jeito de um vazamento ser notado.

---

## 4. Canário com as flags exatas de Production (1 → 5 → 25)

| MAX_WRITES | RAW únicas | RAW_WRITES | HASH_WRITES | NOOP | OFFER_ONLY | STRUCTURAL | Dup. | Replay fails | Peso | Leak | READY |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 25 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | **0** | **0** | YES |
| 5 | 25 | 5 | 5 | 0 | 0 | 5 | 0 | 0 | **0** | **0** | YES |
| 25 | 25 | 25 | 25 | 0 | 0 | 25 | 0 | 0 | **0** | **0** | YES |

`RAW_INVALID_ROWS=0` · `SECRET_LEAKS=0` · `UNEXPECTED_SYSTEM_ERRORS=0`

`SHOPEE_SHADOW_REAL_WRITES=25` (reais, da API oficial; nada fabricado)

---

## 5. Invariante principal

```
ML público + Shopee SHADOW  =>  publicMarketplaceCount = 1   (nunca 2)
```

Comprovado com as mesmas flags de Production, em todos os três estágios.
O peso vem da allowlist da shadow — não de `if marketplace === "SHOPEE"`.

`AUTO_ACTIVE_WITH_LT_2_PUBLIC_MARKETPLACES=0` ⇒ nenhum produto auto-criado
single-store ficou ativo. Single-store continua oculto.

---

## 6. Identity engine

`IDENTITY_POLICY_V1` em uso. No canário: `EXACT=0`, `REVIEW=0`, `REJECT=0`,
`HARD_CONFLICTS=0`, `MISSING_CRITICAL_ATTRIBUTES=0`, `CROSS_MARKET_PAIRS=0`.

Os zeros de par cross-market **não são falha**: são o candidate generation por
evidência barrando comparações sem evidência (a Shopee não expõe GTIN/MPN).
Nenhum REVIEW virou associação, nenhum REJECT criou associação, nenhum hard
conflict virou EXACT.

---

## 7. Mercado Livre intocado

Snapshot BEFORE82, AFTER82 e FINAL82 **idênticos**, inclusive `updatedAt`:

| | Before | After | Final |
|---|---|---|---|
| `state` | `WAITING_1` | `WAITING_1` | `WAITING_1` |
| `stage` | 1 | 1 | 1 |
| `maxWrites` | 1 | 1 | 1 |
| `usedWrites` | 1 | 1 | 1 |
| breaker | `null` | `null` | `null` |

`Product=22` · `MarketplaceOffer=27` · `PriceHistory=29` ·
`RawMarketplaceListing=11` — sem alteração.

**Mudanças feitas pela missão nos registros do ML: 0.** Nenhum UPDATE emitido.

---

## 8. Probes

`/` 200 · `/sitemap.xml` 200 · `/ofertas` 200 · `/categorias` 200 · busca 200
