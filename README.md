# Ofertano

Comparador de preços multiloja. Coleta anúncios de vários marketplaces
(Mercado Livre, Shopee, Amazon, Magalu, AliExpress, …), resolve a identidade
real de cada produto, agrupa anúncios do mesmo produto em um **produto de
catálogo** canônico e publica ofertas comparáveis com link de compra válido.

O ponto central do projeto: **produto de catálogo não é oferta**. Uma oferta
sempre nasce de um anúncio real (listing) de um marketplace, nunca de outro
produto do catálogo.

---

## Stack

| Camada | Tecnologia |
| --- | --- |
| App | Next.js 16 (App Router) + React 19 |
| Banco | PostgreSQL (Supabase) via Prisma 7 com driver adapter (`@prisma/adapter-pg`) |
| Estilo | Tailwind CSS 4 |
| Deploy | Vercel (crons em `vercel.json`) + GitHub Actions (fila de importação) |
| Runtime | Node.js 24 |

---

## Arquitetura principal

O catálogo segue a **Catalog Architecture V1** (ADR em
`docs/architecture/CATALOG_ARCHITECTURE_V1.md`). O núcleo é **agnóstico de
marketplace**: nenhuma regra central usa nome exibido, domínio, URL ou
vendedor. Adicionar o marketplace nº 50 não altera matching, publicação,
busca ou histórico de preço.

Dois conceitos sustentam o modelo:

- **`marketplaceId`** — identidade canônica interna em `lowercase_snake`
  (`mercado_livre`, `shopee`, `magazine_luiza`, …). Declarada em um único
  lugar: `src/services/architecture/v1/marketplaceRegistry.ts`.
- **`NormalizedListingV1`** — contrato único de listing normalizada. Semântica
  de ausência: `null` = vazio reportado pela fonte; `UNKNOWN` = não coletado.

E dois hashes decidem o trabalho, de forma determinística:

| Hash | Cobre | Muda ⇒ |
| --- | --- | --- |
| `catalogHash` | parcela estrutural (título, brand, model, GTIN, MPN, variantes, specs) | collection path |
| `offerHash` | parcela comercial (preço, pix, estoque, disponibilidade, parcelas, promoção) | fast offer path |

`catalogHash == offerHash` e hashes iguais nos dois ⇒ **NOOP idempotente**: sem
matching, sem gravação de histórico, sem requisição desnecessária. A
idempotência de fonte é `(marketplaceId, externalListingId)`.

---

## Fluxo de dados

```
marketplace
   │  conector (MarketplaceConnector → NormalizedListingV1)
   ▼
ingestão V1  ──►  RAW          raw listing preservado + payloadVersion (re-parse possível)
   │              normalization
   ▼
identidade / matching          GTIN/EAN/MPN/hash de identidade; blocking keys; hard conflicts
   │                           (texto sozinho NUNCA produz match EXACT)
   ▼
catálogo canônico              Product de catálogo (identidade, categoria, especificações)
   │
   ▼
ofertas                        MarketplaceOffer — uma por anúncio real, com sourceUrl/affiliateLink
   │
   ▼
publicação                     PublicationEligibility (2+ marketplaces distintos) + freshness
   │
   ▼
catálogo público / busca        Home, busca, página de produto, comparação, admin
```

Caminhos de código:

| Etapa | Onde |
| --- | --- |
| Conectores | `src/services/architecture/v1/connectors/` |
| Pipeline de ingestão | `src/services/architecture/v1/ingestion/` |
| Identidade / matching | `src/services/architecture/v1/identity/`, `.../matching/` |
| Public sync / oferta | `src/services/architecture/v1/publicSync/` |
| Elegibilidade de publicação | `src/services/architecture/v1/publication/publicationEligibility.ts` |
| Cutover (shadow → produção) | `src/services/architecture/v1/cutover/` |
| Busca pública | `src/services/search/` |
| Legado multistore | `src/services/multistore-v2/` |

---

## Invariantes

Estas regras são **fail-closed**: a ausência de uma variável de ambiente
mantém o sistema no estado seguro. A ativação exige o literal `"true"`
(`src/lib/featureFlags.ts` → `isExplicitlyEnabled`).

| Invariante | Estado |
| --- | --- |
| `ML_LISTING_FIRST` — nenhuma oferta nova nasce de produto de catálogo | ativo |
| `ML_CATALOG_AS_OFFER` | `0` |
| Produto de catálogo **não** é oferta, **não** conta como loja, **não** gera CTA, **não** vira `MarketplaceOffer` sozinho | ativo |
| `PRICE_MONITOR` em modo `REFRESH_ONLY` — nunca cria produto | ativo |
| `PRODUCTS_CREATED_BY_PRICE_MONITOR` | `0` |
| `GLOBAL_CUTOVER` | `NO` |
| `PUBLIC_SEARCH_PERSISTENCE_ENABLED` | desligado por default |
| `CATALOG_V1_GLOBAL_CUTOVER` | desligado por default |
| Toda publicação exige ofertas válidas em **2+ marketplaces distintos** | ativo |
| `STALE`/`EXPIRED` nunca disputam a melhor oferta | ativo |
| Texto sozinho nunca produz match `EXACT` | ativo |
| Ausência de atributo nunca é conflito; divergência só é `CONFLICT` se um lado falou de forma estruturada | ativo |

### Mercado Livre (regra especial)

Um **produto de catálogo** do Mercado Livre pode enriquecer identidade, mas
**não é oferta**: não conta como loja, não gera CTA e não vira
`MarketplaceOffer` sozinho. Só um **listing real** — `item_id` concreto,
identidade válida, URL válida, comprável conforme a política vigente — vira
oferta. Isso é o que `ML_CATALOG_AS_OFFER=0` e o gate de listing-first
protegem.

---

## Instalação e execução

Requer Node.js 24 e um PostgreSQL acessível.

```bash
npm ci                      # instala dependências (determinístico, usa o lock)
npx prisma generate         # gera o Prisma Client em node_modules/@prisma/client
npm run dev                 # http://localhost:3000
npm run build               # check:encoding + prisma generate + next build
npm start                   # serve o build de produção
```

### Ambiente

Copie `.env.local` a partir do ambiente alvo. Nunca versione este arquivo —
`.env*` já está no `.gitignore`. As variáveis que o build exige são
`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

Variáveis relevantes (todas opcionais e **fail-closed** quando ausentes):

| Variável | Efeito |
| --- | --- |
| `ARCHITECTURE_V1_INGESTION_ENABLED` | liga a ingestão V1 |
| `ARCHITECTURE_V1_HASH_PERSISTENCE_ENABLED` | liga a persistência de `catalogHash`/`offerHash`/`payloadVersion` |
| `CATALOG_V1_GLOBAL_CUTOVER` | cutover global do catálogo |
| `PUBLIC_SEARCH_PERSISTENCE_ENABLED` | persistir clusters descobertos na busca |
| `CATALOG_POPULATE_ENABLED` | popular o catálogo a partir de buscas |
| `IMPORT_QUEUE_PROCESS_ENABLED` | processar a fila de importação |
| `RAW_LISTING_DUAL_WRITE_ENABLED` | escrita dupla de raw listing |
| `AUTOPILOT_ENABLED` | piloto automático de canário |
| `CRON_SECRET` | autenticação dos endpoints `/api/cron/*` |

### Crons

`vercel.json` agenda price monitor, populate de catálogo, fila de importação,
monitor de regressão, social diário, piloto de cutover e sync por marketplace.
O GitHub Actions (`processar-fila-multiloja.yml`) chama
`/api/cron/import-queue` a cada 5 minutos com `Authorization: Bearer $CRON_SECRET`.

---

## Testes

```bash
npm test                        # suíte principal (regressão legada)
npm run test:architecture-v1    # pipeline, hash duplo, idempotência, conectores
npm run test:cutover            # flags e política de cutover
npm run test:migration-history  # ledger de migrations e equivalência de schema
npm run test:listing-first      # listing-first e refresh-only
npm run test:second-marketplace # segurança e matching cross-market
npm run test:phase-p            # invariantes de reconciliação de publicação
npm run test:commerce           # fundação de commerce-intelligence
npx tsc --noEmit                # tipos
npm run build                   # build de produção
```

Scripts operacionais:

```bash
npm run catalog:monitor                    # monitor de regressão do catálogo
npm run db:bootstrap:fresh                 # bootstrap de banco descartável local
npm run db:bootstrap:fresh:check           # só classifica (read-only)
npm run ml-affiliate:daemon                # daemon de links de afiliado ML
npm run ml-affiliate:worker                # worker de fila de afiliados
```

---

## Regras de migrations

1. **Nunca** editar uma migration já aplicada. A ledger
   (`_prisma_migrations`) é a verdade; divergência de checksum aborta.
2. Migrations são **aditivas** por padrão: coluna nullable ou tabela nova.
   `DROP`/`DELETE` destrutivo exige decisão explícita e registrada.
3. A cadeia histórica **não roda** em um PostgreSQL vazio: a migration
   `20260905120000_price_alerts` depende de objetos legados que não existem
   no schema atual. Para banco novo use o bootstrap versionado
   (`npm run db:bootstrap:fresh`), não `migrate deploy` do zero. Detalhes em
   `scripts/bootstrap/README.md`.
4. O bootstrap só aceita host `127.0.0.1` e banco na allowlist descartável.
5. Não regenerar `scripts/bootstrap/initial-schema.sql` ao adicionar migration
   forward — os checksums de baseline são fixos; adicione em `forwardMigrations`
   e atualize apenas `currentSchemaSHA256`.
6. Produção tem objetos legados fora do modelo Prisma runtime. A certificação
   de equivalência exata é `docs/production-schema-equivalence.md`, com o
   inventário de evidência em
   `docs/evidence/production-equivalence/diff-inventory.json`.
7. Verificar a ledger antes e depois:
   `npm run test:migration-history`.

---

## Como criar um conector novo

Guia oficial: `docs/marketplaces/ADDING_A_MARKETPLACE.md`. Resumo:

1. Implementar o `MarketplaceConnector` em
   `src/services/architecture/v1/connectors/`.
2. Declarar **capacidades reais** (`gtin`, `variants`, `stock`, `seller`,
   `pixPrice`, `incrementalUpdates`, …) — nunca capacidade aspiracional.
3. Mapear a fonte para `NormalizedListingV1`, respeitando a semântica de
   ausência (`null` = vazio reportado; `UNKNOWN` = não coletado).
4. Registrar o `marketplaceId` em `marketplaceRegistry.ts` apenas para nome de
   exibição e valor de enum legado. **Identidade nunca vem do registry.**
5. Escrever fixtures determinísticas no padrão dos `FakeConnectorA/B` e testes
   de contrato: idempotência (duas entregas ⇒ `NOOP`), fast offer (só preço ⇒
   `OFFER_ONLY`), estrutural (título/GTIN muda ⇒ `STRUCTURAL`), e projeção
   multiloja (2+ marketplaces formam um grupo único).
6. Rodar `npm run test:architecture-v1` e `npm test`.

Nenhuma regra central, migration obrigatória ou flag de runtime precisa mudar
para suportar o marketplace novo.

---

## Estrutura de diretórios

| Caminho | Conteúdo |
| --- | --- |
| `src/app/` | rotas, páginas e API (App Router) |
| `src/components/` | componentes React |
| `src/services/` | domínio: conectores, identidade, catálogo, busca, publicação |
| `src/lib/` | utilitários e clientes compartilhados (`prisma`, flags, sessão) |
| `src/scripts/` | scripts operacionais e de gate |
| `scripts/` | ferramentas de bootstrap, migration-history e afiliados |
| `prisma/` | schema, migrations e bootstrap versionado |
| `docs/` | ADRs, runbooks e documentação de arquitetura |
| `docs/evidence/` | evidências de auditoria (ver o README local) |
| `.agents/` | skills e ferramentas de agentes autônomos |

---

## Segurança

- Nenhum segredo é versionado. `.env*` está no `.gitignore`.
- Credenciais de marketplace (Shopee, Amazon, AliExpress, Mercado Livre) vêm
  de variáveis de ambiente.
- Os endpoints `/api/cron/*` exigem `Authorization: Bearer $CRON_SECRET`.
- Tokens de canário são armazenados apenas como digest SHA-256; o texto
  claro nunca é persistido nem logado.
