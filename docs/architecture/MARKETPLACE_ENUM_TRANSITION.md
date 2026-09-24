# Marketplace Enum Transition — do enum Prisma para `marketplaceId` (FASE X)

## Objetivo

Eliminar a dependência do núcleo em nomes de marketplace (valores do enum
Prisma `Marketplace`) sem nenhuma migration destrutiva. O destino é: o núcleo
conhece apenas `marketplaceId` canônico (string, lowercase_snake) e
capacidades de conector.

## Estado atual

- Schema: `enum Marketplace` com 9 valores, usado em colunas como
  `RawMarketplaceListing.marketplace`.
- Registry V1 (`src/services/architecture/v1/marketplaceRegistry.ts`) mapeia
  `marketplaceId` → `legacyEnumValue` para **todos** os 9, permitindo coexistência.
- `resolveLegacyEnumValue(marketplaceId)` → enum legado (p/ escrita no banco).
- `resolveMarketplaceIdFromLegacyEnum(enum)` → marketplaceId (p/ leitura no banco).

## Estratégia (totalmente aditiva)

1. **Fase shadow (esta missão):** nada muda no schema nem no runtime. O registry
   existe para que qualquer novo código use `marketplaceId`; quem escreve no banco
   resolve o enum via `resolveLegacyEnumValue`, quem lê resolve o id via
   `resolveMarketplaceIdFromLegacyEnum`. Nenhum novo marketplace precisa do enum.
2. **Fase transição:** novos marketplaces entram **somente** por marketplaceId
   (sem valor novo no enum). O código legado que ainda espera enum mantém os 9
   atuais. Colunas novas/ajustes futuros passam a persistir marketplaceId string.
3. **Fase weaning:** quando nenhum caminho legado depender do enum, avalia-se
   (em missão separada e exclusivamente via migration aditiva + backfill de
   dados) a substituição por coluna `marketplaceId String` e retirada do enum —
   **nunca** antes de 100% dos pontos de escrita/leitura migrarem.

## Regras de convivência

- `MarketplaceListingMarket` (helper legado com 5 valores) **não** é a verdade;
  o enum do banco (9) é. A V1 suporta os 9 via registry e aceita marketplaceId
  dinâmico (testado em `extensibility.test.ts`).
- Nunca remover um valor do enum (`DESTRUCTIVE_MIGRATION=NO`).
- Nunca usar `displayName` como identidade; ele é cosmético
  (`resolveDisplayName`).
- Núcleo proibido de hardcodar nomes: qualquer `if (marketplaceId === "...")`
  em regra central é violação desta política.

## Evidência

- `extensibility.test.ts`: marketplace novo (`marketplace_novo_x`) passa pelo
  pipeline, persistência, métricas e projeção sem tocar o núcleo.
- `MARKETPLACE_REGISTRY_V1` cobre os 9 valores do enum atual.