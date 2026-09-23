# Catálogo V1 — Test Fixtures

Fixtures de dados para a integração do Catálogo V1 ao runtime real do Ofertano.

## Objetivo

Fornecer os dados (`ProductImport[]`) que alimentam a prova de integração no **runtime real**
(Home / Busca / Página de Produto) através de `scripts/seed-catalog-v1.ts`, que reutiliza os
módulos reais do pipeline:

- Identity Matching (identity/)
- Persistência de busca (search/persistPublicSearchCluster + searchCompletionBarrier)
- Persistência real (database/saveProduct)

A validação **não** depende mais do harness paralelo `catalog-v1.test.ts` (removido); a prova é
o fluxo servido por `next dev` — ver `RUNTIME_INTEGRATION_REPORT.md` na raiz do repositório.

## Regras

- **NÃO** substitui o banco de produção
- **NÃO** altera `src/lib/prisma.ts` (byte-identical ao main)
- **NÃO** altera `prisma/schema.prisma` ou migrations
- **NÃO** cria fallback de runtime
- **NÃO** ativa feature flags
- Dados são **TEST FIXTURES**, não catálogo production

## Estrutura

- `data.ts` — 21 entradas (6 produtos canônicos × 3-4 lojas), 7 marketplaces
- `VALIDATION_REPORT.md` — relatório histórico da validação em harness (292/292)
- `catalog-v1.test.ts` — **removido** (o harness paralelo deixou de ser dependência de validação)

## Marketplace Coverage

- MERCADO_LIVRE, AMAZON, SHOPEE, KABUM, MAGAZINE_LUIZA, CASAS_BAHIA, CARREFOUR
- No runtime real: KABUM / CASAS_BAHIA / CARREFOUR não existem no persist → fora da integração
  (16 de 21 entradas entram no seed)

## Produtos Canônicos

1. Smart TV 50" 4K Samsung QE50T530
2. Notebook Dell Inspiron 15 5510
3. Air Fryer Philips HD9252/90
4. Furadeira Bosch GSB 13 RE
5. Fone JBL Tune 520BT
6. Smartphone Samsung Galaxy A54 5G

## Validação (prova atual — runtime real)

```bash
# Seed local (banco descartável 127.0.0.1:55433)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55433/ofertano_catalog_v1 \
npx tsx scripts/seed-catalog-v1.ts

# Fluxos reais servidos
# Home   -> GET /              (produtos multi-loja públicos)
# Busca  -> GET /?q=Notebook   (source=CATALOG)
# Produto-> GET /produto/:id   (preços + marketplaces + afiliados)
```

Resultado: `CATALOG_V1_RUNTIME_INTEGRATED=YES` — ver `RUNTIME_INTEGRATION_REPORT.md`.

A validação antiga em harness (292/292) está registrada em `VALIDATION_REPORT.md` como
referência histórica; o harness não é mais executado nem é dependência.
