# Catalog Shadow Evaluation — 2026-09-12

## 1. Executive Summary

This evaluation was re-run after loading the project environment correctly from `.env`. The catalog database was reachable and read-only queries succeeded, but the current local catalog remains uneven: some category searches work well, while several core product families still miss or return accessory-heavy matches.

The current snapshot shows a usable local catalog foundation for measurement, but not enough to justify local-first activation. The recommended next step is `INGESTION_FIRST` because the biggest gaps are coverage and query recall, not runtime errors.

## 2. Environment

- Project: `/home/evaldo/Projetos/ofertano`
- Branch: `feature/search-e2e-final-20260910`
- HEAD: `ac307c2979f9f4fd968576818617fc959f13f377`
- Date: `2026-09-12`
- Database env: loaded via `node --env-file=.env`
- Database check: `DATABASE_CONNECTION=OK`
- Mode: read-only, no public search changes, no external marketplace calls, no persistence

## 3. Corpus

Fixed corpus evaluated:

1. Samsung WD11M
2. lava e seca
3. chuteira society
4. chaveiro
5. aspirador
6. filtro de barro
7. filtro de óleo para motor 1.6
8. smart tv samsung
9. panela
10. notebook

Real `SearchRequest.normalizedQuery` sample: 0 distinct queries returned in the current database snapshot.

## 4. Catalog Size

Live read-only inventory from Prisma:

- Total Product: 706
- Active Product: 242
- Products with 0 valid marketplaces: 1
- Products with 1 valid marketplace: 142
- Products with 2+ valid marketplaces: 99

This indicates a relatively small but active catalog base, with most active products concentrated in single-marketplace coverage.

## 5. Offer Distribution

- Offers total: 938
- Offers active: 938
- Offers exact: 933
- Marketplace distribution:
  - MAGAZINE_LUIZA: 302
  - SHOPEE: 293
  - ALIEXPRESS: 66
  - MERCADO_LIVRE: 91
  - AMAZON: 186

## 6. Fixed Regression Corpus

Summary by query result after warm-up + 3 measurements:

- GOOD: 5
- QUESTIONABLE: 1
- WRONG: 0
- MISS: 4

Good cases:
- chuteira society
- aspirador
- filtro de barro
- smart tv samsung
- panela

Questionable case:
- notebook

Miss cases:
- Samsung WD11M
- lava e seca
- chaveiro
- filtro de óleo para motor 1.6

## 7. Real Query Sample

No real query sample was available in the current environment because the distinct `SearchRequest.normalizedQuery` count was 0.

## 8. Hit Rate

Fixed-corpus hit rate:

- Catalog hit rate: 60.00%
- Comparable hit rate: 30.00%
- Single-only rate: 30.00%
- Miss rate: 40.00%
- Error rate: 0.00%

Interpretation: the catalog is functional in a significant portion of searches, but misses remain concentrated in model-specific and accessory-heavy searches.

## 9. Comparable Rate

Comparable hits are present for the strongest category/product queries:

- aspirador
- smart tv samsung
- panela

Comparable hit count in fixed corpus: 3 of 10 queries.

## 10. Singles

Single-only hits occurred in:

- chuteira society
- filtro de barro
- notebook

This is not inherently wrong, but it shows that the current catalog is frequently single-marketplace and not yet robustly comparable in generic or accessory-heavy categories.

## 11. Miss Analysis

The misses were dominated by coverage gaps rather than runtime errors:

1. Samsung WD11M: no local product hit at all.
2. lava e seca: no relevant catalog product found.
3. chaveiro: no local hit despite being a valid broad category.
4. filtro de óleo para motor 1.6: no relevant hit.

The failure pattern suggests a combination of missing product entry and the local matcher being too strict for parts and category terms with sparse metadata.

## 12. Relevance Review

Manual review based on top results after `searchCatalogLocal`:

- `aspirador`: GOOD. Top products match the product class and model family closely.
- `smart tv samsung`: GOOD. Top product matched brand and category correctly.
- `panela`: GOOD. Generic kitchen category is represented with relevant products.
- `chuteira society`: GOOD. Product concept fits the category and the top hits are valid.
- `filtro de barro`: GOOD. It returned valid water-filter product concepts.
- `notebook`: QUESTIONABLE. The top hits returned accessory-style products instead of a core notebook product.

No obvious `WRONG` classification was observed in the fixed corpus, but the notebook case shows a relevance ceiling issue for broad electronics queries.

## 13. Latency

The local catalog was measured with warm-up + 3 executions per query, using the `elapsedMs` field from `searchCatalogLocal` as the primary metric.

Observed latency (30 samples total):

- P50: 4686 ms
- P95: 12096 ms
- P99: 12244 ms
- Max: 12244 ms

The catalog is still far above the initial target of `P95 < 500ms`, especially for generic category and large candidate queries.

## 14. Freshness

Freshness data was not used as a blocking factor because the evaluation did not include a full product-age audit, but the catalog is clearly not yet dense enough for broad local-first activation.

## 15. Data Quality Findings

1. The local catalog is heavily single-marketplace in active products: 142 products have 1 valid marketplace, while 99 have 2+.
2. Generic or accessory-heavy category queries still produce weak recall or tangential matches.
3. Several important product families are missing entirely from the local catalog (`Samsung WD11M`, `chaveiro`, `filtro de óleo para motor 1.6`).
4. Latency is still elevated for large candidate sets and some ignored categories.
5. The database currently has 0 distinct real `SearchRequest.normalizedQuery` samples, which sharply limits coverage validation from real traffic.

## 16. Coverage Gaps

1. Model-specific and part-specific queries are not present enough in the catalog.
2. Broad category searches such as `chaveiro` still yield no relevant result.
3. `Samsung WD11M` is a concrete miss and may require product ingestion or metadata normalization.
4. `lava e seca` and `filtro de óleo para motor 1.6` also show no local hit support.
5. Notebook and other electronics queries risk overmatching accessories instead of the main product category.

## 17. Readiness Decision

Decision: `INGESTION_FIRST`

Why:

- Catalog hit rate is moderate but not yet robust enough for local-first activation.
- Several key categories still miss entirely.
- Fixed-corpus wrong rate is 0, which is positive, but misses and latency are too high for pilot readiness.
- The catalog is usable as a shadow measurement layer, but not yet reliable as a local-first answer source.

## 18. Recommended Next Mission

1. Expand ingestion for missing product families and part-type queries.
2. Improve metadata normalization for model-specific and accessory-heavy terms.
3. Re-run the smoke corpus once the catalog depth is improved.
4. Measure a tighter local-first pilot only after `ERROR_RATE <= 1%`, `P95 <= 500ms`, and the fixed-corpus miss rate is materially reduced.

## Security and Scope Status

- `PUBLIC_SEARCH_MODE_CHANGED`: NO
- `SCHEMA_CHANGED`: NO
- `MIGRATION_CREATED`: NO
- `DATABASE_CHANGED`: NO
- `COMMIT_CREATED`: NO
- `PUSH_PERFORMED`: NO
- `DEPLOY_PERFORMED`: NO
- `EXTERNAL_MARKETPLACE_CALLS_FROM_SHADOW`: NO
- `DATABASE_WRITES_FROM_SHADOW`: NO
