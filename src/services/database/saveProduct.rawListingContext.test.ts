import assert from "node:assert/strict";

import type {
  RawListingPersistenceContext,
  SaveProductOptions,
} from "./saveProduct";

const rawListingContext: RawListingPersistenceContext = {
  marketplace: "MERCADO_LIVRE",
  externalId: "MLBTESTCONTEXT01",
  sourceUrl: "https://www.mercadolivre.com.br/item/MLBTESTCONTEXT01",
  title: "Produto de teste",
  price: 99.9,
  canonicalProductId: "00000000-0000-4000-8000-000000000001",
};

const options: SaveProductOptions = {
  discoverySource: "ON_DEMAND_SEARCH",
  rawListingContext,
};

assert.deepEqual(
  options.rawListingContext,
  rawListingContext,
  "raw listing context remains available in save options",
);

const legacyOptions: SaveProductOptions = {
  discoverySource: "MANUAL",
};

assert.equal(
  legacyOptions.rawListingContext,
  undefined,
  "raw listing context remains optional for existing callers",
);

assert.equal(
  Object.keys(rawListingContext).sort().join(","),
  "canonicalProductId,externalId,marketplace,price,sourceUrl,title",
  "context contains only the foundation fields",
);

console.log("SAVE_PRODUCT_RAW_CONTEXT_CONTRACT=PASS");
console.log("SAVE_PRODUCT_RAW_CONTEXT_OPTIONAL=PASS");
console.log("RAW_LISTING_WRITE_IMPLEMENTED=NO");
