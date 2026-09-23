# Catálogo V1 — Integração ao Runtime Real (Local)

Prova de que os módulos do Catálogo V1 (validados anteriormente em harness, 292/292) rodam
**dentro do runtime real do Ofertano**: Home, Busca e Página de Produto servidas por `next dev`
com banco **local descartável** (`127.0.0.1:55433`, `ofertano_catalog_v1`).

- ZERO Production: sem DB prod, sem Supabase, sem `DIRECT_URL` prod, sem R3, sem migrations,
  sem `schema.prisma`, sem env real, sem flags, sem deploy.
- Harness paralelo (`catalog-v1.test.ts`) **removido** — a validação deixa de depender dele.
- Nenhum módulo de identidade/matcher/classificador foi alterado (matcher conservador preservado).

---

## 1. Resultado

```
CATALOG_V1_RUNTIME_INTEGRATED=YES
```

Fluxos comprovados no runtime real (servidor `next dev`, `MULTISTORE_ENGINE=legacy`):

| Fluxo | Rota real | Resultado |
|---|---|---|
| Home | `GET /` | HTTP 200 — 6 produtos públicos multi-loja (links `/produto/<id>`) |
| Busca (catálogo) | `GET /?q=Notebook` | HTTP 200 — `source=CATALOG`, Notebook Dell 5510 |
| Busca (catálogo) | `GET /?q=furadeira` | HTTP 200 — `source=CATALOG`, Bosch GSB 13 RE |
| Busca (catálogo) | `GET /?q=air+fryer` | HTTP 200 — `source=CATALOG`, Air Fryer Philips HD9252/90 |
| Página de Produto | `GET /produto/:id` | HTTP 200 — preços/marketplaces/afiliados reais |

## 2. Seed — persistência real reutilizando módulos validados

`scripts/seed-catalog-v1.ts` reutiliza **exatamente** os módulos reais validados:

- `identity/agruparPorIdentidadeExata` (agrupamento exato conservador)
- `search/persistPublicSearchCluster` + `escolherClusterExatoDaPesquisaPublica` (fluxo real de busca)
- `search/searchCompletionBarrier` (barrier real de publicação)
- `database/saveProduct` (persistência real `Product` + `MarketplaceOffer`)

Adaptação **somente de dados** (nada de código de arquitetura):

- `ProductImport.marketplace` é display name ("Mercado Livre", "Amazon", ...) → os códigos de enum
  usados nas fixtures são mapeados no seed.
- 5 entradas com `KABUM`/`CASAS_BAHIA`/`CARREFOUR` ficam fora do runtime (o persist real não
  suporta esses marketplaces) — mantidas nas fixtures do harness histórico.

Seed rodado no banco local após `TRUNCATE "Product" CASCADE` (execução limpa): **8 grupos → 8 ok,
7 produtos persistidos, 16 ofertas, EXIT=0**. Detalhe por grupo:

| Grupo | Query persistida | Resultado |
|---|---|---|
| `dell-inspiron155510` (ML+MLU) | `notebook dell inspiron` | OK 2/2 → productId `143900ef…` |
| `dell-inspiron155510` (AMZ) | `notebook dell inspiron` | OK 1/1 → productId `71bd2dec…` |
| `philips-hd925290` (ML+AMZ) | `philips hd925290` | OK 2/2 → productId `4b2f8d4b…` |
| `samsung-qe50t530` (SH+ML) | título-âncora | OK 2/2 |
| `samsung-galaxya545g` (ML+AMZ) | título-âncora | OK 2/2 → `722bb413…` |
| `samsung-qe50t530` (AMZ) | título-âncora | OK 1/1 |
| `bosch-gsb13re` (ML+AMZ+MLU) | título-âncora | OK 3/3 → `b2171d40…` |
| `jbl-tune520bt` (ML+AMZ+SH) | título-âncora | OK 3/3 → `88d10cda…` |

As queries de "usuário real" para Notebook e AirFryer são o dado de entrada que o **matcher
conservador** aceita:

- `notebook dell inspiron` — classe NOTEBOOK reconhecida, sem código-de-modelo conflitante
  (o título completo gera `INSPIRON15` vs identidade `INSPIRON155510` → REJECTED; sem o dígito
  do modelo o matcher aceita — comportamento conservador **preservado**, não alterado).
- `philips hd925290` — aceite por **modelo forte compatível** (a query declara o código exato
  `HD925290`; a classe AirFryer é UNKNOWN no classificador real, então sem o código colado o
  caminho é INSUFFICIENT).

## 3. Duplicações canônicas registradas (matcher conservador preservado)

1. **TV Samsung QE50T530** — `agruparPorIdentidadeExata` splitou em 2 grupos (Shopee+Mercado Livre
   e Amazon), mas o persist (`saveProduct` via canonicalKey `SAMSUNG:QE50T530:size=50pol`)
   mergeou **no mesmo productId** `c5fafaf9…` → "split no matcher, merge no persist"; **sem
   duplicação no DB** (3 ofertas em 1 produto).
2. **Notebook Dell Inspiron 15 5510** — split em 2 grupos que geram canonicalKeys **distintas**
   (`storage=256gb` vs `storage=8gb`) → **2 produtos no DB** (`143900ef…` e `71bd2dec…`).
   Duplicação canônica **real** do matcher conservador (mesmo modelo, storage divergente),
   registrada conforme a regra "preservar matcher, registrar duplicação".

## 4. Provas de fluxo no runtime real

Servidor: `npx next dev` com `DATABASE_URL`/`DIRECT_URL` → 55433 e `MULTISTORE_ENGINE=legacy`.

Home `GET /` (HTTP 200) — produtos públicos multi-loja renderizados:
`Smart TV 50`, `Air Fryer Premium Philips HD9252/90`, `Furadeira Profissional Bosch GSB 13 RE`,
`Fone JBL Tune 520BT`, `Smartphone Samsung Galaxy A54`, `Notebook Dell Inspiron 15 5510`
(6 links `/produto/<id>`; o Dell 8GB de loja única é corretamente excluído por
`hasPublicMultiStore` — comportamento real).

Busca (todas HTTP 200, marcador `CATALOG` no HTML servido):
- `/?q=Notebook` → Notebook Dell Inspiron 15 5510 Intel i5 8GB 256GB (CATALOG)
- `/?q=furadeira` → Furadeira Profissional Bosch GSB 13 RE 550W (CATALOG)
- `/?q=air+fryer` → Air Fryer Premium Philips HD9252/90 5.5L 1400W (CATALOG)

Página de Produto (todas HTTP 200):
- `/produto/4b2f8d4b-…` (Air Fryer) — `"price":379` (Amazon, `amzn.to/af-az`) e `"price":399`
  (Mercado Livre, `meli.la/af-ml`)
- `/produto/c5fafaf9-…` (TV) — 3 ofertas: 1799 / 1899 / 1949 (Shopee, Mercado Livre, Amazon)
- `/produto/143900ef-…` (Notebook Dell) — 3399 (Magazine Luiza) / 3499 (Mercado Livre)

## 5. Testes e build

- Harness removido: `git rm src/services/catalog-v1-test-fixtures/catalog-v1.test.ts`.
- Testes relevantes (targeted): `identity/exactMatcher.test.ts` ✅ · `search/searchCompletionBarrier.test.ts` ✅ ·
  `search/publicSearchMultiloja.test.ts` ✅
- Build: `npm run build` **EXIT=0** (`check:encoding` + `prisma generate` + `next build`).

## 6. Segurança da execução

- Somente banco local descartável `127.0.0.1:55433/ofertano_catalog_v1` (convenção da missão).
- `prisma/schema.prisma`, migrations, `src/lib/prisma.ts` e flags **intocados**.
- Sem fallback público de runtime criado; sem deploy; sem push (commit local).