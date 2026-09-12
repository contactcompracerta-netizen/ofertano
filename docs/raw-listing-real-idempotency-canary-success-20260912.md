# RawMarketplaceListing: Real Idempotency Canary Success

**Date:** 2026-09-12
**Project:** Ofertano
**Branch:** `feature/search-e2e-final-20260910`
**Checkpoint:** `bd38682`

## Summary

The first real idempotency proof for `RawMarketplaceListing` completed successfully.
The same marketplace listing was persisted twice using the same marketplace and
external ID. The first execution created one row, while the second execution
updated that existing row. No duplicate row was created.

The runtime used the official Prisma singleton from
[`src/lib/prisma.ts`](../src/lib/prisma.ts). No ad-hoc `PrismaClient` or
`PrismaPg` instance was created.

## Architecture and mission context

`RawMarketplaceListing` is the raw-ingestion representation keyed by the
compound identity `(marketplace, externalId)`. It preserves marketplace data
before and alongside canonical product linking. The database uniqueness
constraint for this identity and the repository upsert path are the core
idempotency mechanisms.

This proof follows:

- **49K:** proved a single real canary lifecycle from an empty baseline to one
  raw listing and back to an empty baseline after cleanup.
- **49M-A:** added the separate, read-only
  `evaluateRawListingRealIdempotencyCanaryPrecheck()` gate. The gate requires
  exactly one marketplace, exactly one valid external ID, exactly two writes,
  dual-write disabled before activation, a known baseline, rollback and abort
  criteria, and healthy metrics. The existing single-canary gate remains
  restricted to `maxWrites=1`.

This document records the resulting real two-write proof from 49M.

## Authorized target

```text
TARGET_MARKETPLACE=MERCADO_LIVRE
TARGET_EXTERNAL_ID=MLB7184373436
TARGET_PRODUCT_ID=48fabfff-c918-4265-b26a-6573006620f6
```

The legacy `MarketplaceOffer` was found for the target and its related product
matched `TARGET_PRODUCT_ID=48fabfff-c918-4265-b26a-6573006620f6`. The normalized
listing was built from the real legacy offer and product data; no synthetic
listing fields were introduced.

## Safety gates and baseline

```text
RAW_LISTING_COUNT_BEFORE=0
TARGET_RAW_BEFORE_COUNT=0
LEGACY_LISTING_FOUND=YES
LEGACY_PRODUCT_MATCH=YES
READINESS_BEFORE=READY
IDEMPOTENCY_PRECHECK_BEFORE=READY
METRICS_RESET_BEFORE=PASS
```

The process-local configuration kept the kill switch off before activation:

```text
RAW_LISTING_DUAL_WRITE_ENABLED=false
RAW_LISTING_CANARY_MARKETPLACES=MERCADO_LIVRE
RAW_LISTING_CANARY_EXTERNAL_IDS=MLB7184373436
RAW_LISTING_CANARY_MAX_WRITES=2
```

A single shared counter was used for the two authorized calls:

```text
counter.current: 0 -> 1 -> 2
```

## Primary idempotency evidence

The decisive result was:

```text
FIRST_WRITE_STATUS=CREATED
SECOND_WRITE_STATUS=UPDATED
FIRST_RAW_ID=cmtyvaqbg0000ebdh4ds42dax
SECOND_RAW_ID=cmtyvaqbg0000ebdh4ds42dax
SAME_RAW_ID=YES
TARGET_KEY_COUNT_AFTER_SECOND=1
```

This proves that the second ingestion reused the existing
`RawMarketplaceListing` rather than creating a duplicate.

### Database delta

| Point in lifecycle | Total rows | Target rows |
| --- | ---: | ---: |
| Before first write | 0 | 0 |
| After first write | 1 | 1 |
| After second write | 1 | 1 |
| After cleanup | 0 | 0 |

```text
RAW_LISTING_COUNT_AFTER_FIRST=1
TARGET_RAW_COUNT_AFTER_FIRST=1
RAW_LISTING_COUNT_AFTER_SECOND=1
TARGET_RAW_COUNT_AFTER_SECOND=1
```

The target remained valid after the second execution:

```text
TARGET_MARKETPLACE_VALID=YES
TARGET_EXTERNAL_ID_VALID=YES
TARGET_PRODUCT_LINK_VALID=YES
TARGET_SOURCE_URL_VALID=YES
TARGET_DATA_VALID=YES
```

## Metrics

```text
CANARY_COUNTER_AFTER_SECOND=2
ATTEMPTED_AFTER_SECOND=2
WRITE_SUCCESS_AFTER_SECOND=2
WRITE_FAILED_AFTER_SECOND=0
SKIPPED_DISABLED=0
SKIPPED_DRY_RUN=0
SKIPPED_MARKETPLACE=0
SKIPPED_EXTERNAL_ID=0
SKIPPED_LIMIT=0
SKIPPED_INVALID_EXTERNAL_ID=0
```

No third execution was performed.

## Cleanup and final state

Cleanup was guarded by an exact target count:

```text
TARGET_BEFORE_DELETE_COUNT=1
TARGET_DELETED_COUNT=1
RAW_LISTING_COUNT_FINAL=0
TARGET_RAW_FINAL_COUNT=0
BASELINE_RESTORED=YES
DATABASE_RESIDUAL_TEST_DATA=NO
FLAG_LEFT_ENABLED=NO
KILL_SWITCH_CONFIRMED=YES
```

The final read-only verification confirmed that the database returned to its
original zero-row baseline.

## Validation

All required post-cleanup checks passed:

```text
catalog-listings=PASS
catalog-ingestion=PASS
full test run 1=PASS
full test run 2=PASS
Prisma validate=PASS
Prisma generate=PASS
encoding=PASS
build=PASS
diff-check=PASS
```

## Limitations

This result proves real idempotency for one listing, one marketplace, and two
sequential executions. It does **not** authorize general rollout. The
following scenarios remain unproven in runtime conditions:

- several listings executed simultaneously;
- multiple marketplaces;
- concurrent writes;
- high load;
- retry after a database error;
- recovery after a timeout;
- continuous operation;
- global rollout.

## Next steps

The recommended next phase is a **controlled multi-listing canary / bounded
batch readiness** exercise with explicit limits, observability, rollback, and
cleanup criteria. That phase was not executed as part of this mission.
