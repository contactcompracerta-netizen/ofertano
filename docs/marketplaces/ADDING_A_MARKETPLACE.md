# Adding a Marketplace — Guia oficial (FASE E/X)

Como adicionar um marketplace novo ao catálogo do Ofertano **sem reescrever o
núcleo** (2 → 100 marketplaces).

## O que NÃO muda

- Nenhuma regra central (matching, publicação, busca, price history, preferência).
- Nenhuma migration obrigatória para o marketplace em si (o enum Prisma legado
  é opcional e apenas para compatibilidade — veja `MARKETPLACE_ENUM_TRANSITION.md`).
- Nenhuma flag/runtime novo além das capacidades do conector.

## Checklist

1. **Criar o conector** (`MarketplaceConnector`):
   - implementar `collect(cursor)`: snapshot/incremental alimentado por batch;
   - declarar **capacidades reais** (`gtin`, `variants`, `incrementalUpdates`,
     `fullSnapshot`, `webhook`, `pixPrice`, `stock`, `shipping`, `seller`);
   - mapear os dados da fonte para `NormalizedListingV1`
     (`types/normalizedListingV1.ts`). Semântica de ausência: `null` = vazio
     reportado; `UNKNOWN` = não coletado.
2. **(Opcional) registrar identidade de referência** no `marketplaceRegistry.ts`
   (displayName p/ observabilidade). Não usar como identidade.
3. **Persistência:** nada a fazer — o pipeline V1 grava via RawListingRepository
   com chave `(marketplaceId, externalListingId)`. Para o caminho legado, usar
   `resolveLegacyEnumValue` apenas se o marketplace já existir no enum.
4. **Fixtures e testes de contrato:**
   - fixtures determinísticas no padrão dos `FakeConnectorA/B`;
   - idempotência: entregar a mesma listing duas vezes → `NOOP`;
   - fast offer: só preço muda → `OFFER_ONLY` (hook comercial);
   - estrutural: título/GTIN muda → `STRUCTURAL`;
   - projeção multiloja: mesmo produto com outro marketplace já existente forma
     grupo único com `publicMarketplaceCount ≥ 2`;
   - publicação: ofertas válidas do novo marketplace contam no invariante
     multiloja.
5. **Executar** `npm run test:architecture-v1` (adição de evidência) e
   `npm run test` (regressão legada).

## Exemplo mínimo (marketplace dinâmico, sem tocar núcleo)

```ts
const listing = buildFakeListing({
  marketplaceId: "marketplace_novo_x",   // id dinâmico, sem enum novo
  externalListingId: "x1",
  catalog: { title: "Produto do marketplace novo", category: "Novidades" },
  commerce: { price: 149.9 },
});
const result = await processNormalizedListing(
  { repository, metrics },
  { listing, rawPayload: { id: "x1" } },
);
// result.path === "STRUCTURAL" (primeira observação)
```

Ver demonstração completa em `src/services/architecture/v1/extensibility.test.ts`.