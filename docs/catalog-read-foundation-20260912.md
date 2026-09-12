# Catalog Read Foundation

## Arquivos criados
- src/services/catalog-search/index.ts
- src/services/catalog-search/searchCatalogLocal.test.ts

## Contrato
A nova API local apenas lê o catálogo persistido e retorna resultados prontos para comparação ou único marketplace, sem chamar discovery, importação, persistência ou qualquer marketplace externo.

Exemplo:

const local = await searchCatalogLocal(query);

Resultado:
- query
- normalizedQuery
- source: "LOCAL_CATALOG"
- hits: [{ product, kind, marketplaceCount, lowestPrice, relevanceScore }]
- total
- elapsedMs

## Invariantes
- read-only
- sem chamadas de rede externa
- sem create/update/delete no Prisma
- query mínima e filtro explícito
- catálogo continua filtrado por active, price > 0, image válida e publicationStatus não draft/archive
- marketplaceCount é calculado por marketplace distinto com oferta válida
- kind = COMPARABLE quando marketplaceCount >= 2; otherwise SINGLE_MARKETPLACE
- a relevância reutiliza buildQueryIntent + scoreQueryRelevance + normalizeCandidate

## O que não mudou
- a busca pública híbrida permanece em searchCatalogOrDiscover
- o modo público atual continua hybrid/default
- discovery, acquisition e persistência continuam fora do novo módulo
- schema e migrations não foram alterados

## Como testar
1. npx tsx src/services/catalog-search/searchCatalogLocal.test.ts
2. npx tsx src/services/search/publicSearchMultiloja.test.ts
3. npm test
4. npm run check:encoding
5. npm run build
6. git diff --check

## Próxima etapa recomendada
- mover o pipeline de fallback local para uma decisão explícita de hit/miss antes do discovery live
- preparar uma interface de catálogo para query hit/miss sem alterar o contrato público atual
