/**
 * CATALOG_WAVE 1 - FASE N/D: staging + idempotência.
 */
import {
  InMemoryStagingStore,
  buildStagingRecord,
  stagingKey,
} from "./staging";
import type { StagingRecord, ReasonCode } from "./types";

let passed = 0;
function ok(cond: boolean, label: string): void {
  if (!cond) {
    throw new Error(`FAIL: ${label}`);
  }
  passed += 1;
}

async function main(): Promise<void> {
  /* --- buildStagingRecord: 3 camadas de identidade ---------------------- */
  const reasons: ReasonCode[] = ["NEW_PRODUCT_CANDIDATE"];
  const record = buildStagingRecord({
    merchant: "kabum",
    externalId: "KBM-1001",
    title: "Mouse Gamer Logitech G305",
    price: 249.9,
    currency: "BRL",
    validationStatus: "VALID",
    identityLevel: "A",
    matchCandidateProductId: null,
    matchConfidence: null,
    decision: "CREATE_PRODUCT",
    reasonCodes: reasons,
    brand: "Logitech",
    gtin: "4006381333931",
  });

  ok(record.source === "AWIN", "source = AWIN");
  ok(record.affiliateNetwork === "AWIN", "affiliateNetwork = AWIN");
  ok(record.merchant === "kabum", "merchant = kabum");
  ok(record.externalId === "KBM-1001", "externalId preservado");
  ok(record.price === 249.9, "preço preservado");
  ok(record.currency === "BRL", "moeda BRL");
  ok(record.validationStatus === "VALID", "validationStatus");
  ok(record.identityLevel === "A", "identityLevel");
  ok(record.decision === "CREATE_PRODUCT", "decision");
  ok(record.matchCandidateProductId === null, "sem candidato");
  ok(record.matchConfidence === null, "sem confiança");
  ok(record.description === undefined, "description opcional ausente");

  /* reasonCodes copiados (mutação do original não afeta o registro) */
  reasons.push("AUTO_MATCH");
  ok(record.reasonCodes.length === 1, "reasonCodes clonados no build");

  /* --- stagingKey -------------------------------------------------------- */
  ok(
    stagingKey("AWIN", "kabum", "KBM-1001") === "AWIN|kabum|KBM-1001",
    "chave canônica source|merchant|externalId",
  );

  /* --- Store: idempotência ----------------------------------------------- */
  const store = new InMemoryStagingStore();
  ok((await store.count()) === 0, "store vazia");

  await store.upsert(record);
  ok((await store.count()) === 1, "1ª upsert => 1 linha");

  const updated: StagingRecord = buildStagingRecord({
    merchant: "kabum",
    externalId: "KBM-1001",
    title: "Mouse Gamer Logitech G305 (atualizado)",
    price: 199.9,
    currency: "BRL",
    validationStatus: "VALID",
    identityLevel: "A",
    matchCandidateProductId: "prod-x",
    matchConfidence: 0.99,
    decision: "MATCH_PRODUCT",
    reasonCodes: ["MATCH_GTIN_EXACT"],
  });
  await store.upsert(updated);
  ok(
    (await store.count()) === 1,
    "2ª upsert mesma chave => continua 1 linha (idempotente)",
  );

  const fetched = await store.get("AWIN", "kabum", "KBM-1001");
  ok(fetched !== null, "get encontra a linha");
  ok(fetched?.decision === "MATCH_PRODUCT", "upsert sobrescreve decisão");
  ok(fetched?.price === 199.9, "upsert sobrescreve preço");
  ok(fetched?.matchCandidateProductId === "prod-x", "upsert sobrescreve candidato");

  /* Mesmo externalId em outro merchant => linha distinta (cross-store) */
  await store.upsert({ ...updated, merchant: "leveros" });
  ok(
    (await store.count()) === 2,
    "merchant diferente => 2ª linha (produto igual em 2 lojas)",
  );

  /* Chave desconhecida */
  ok(
    (await store.get("AWIN", "olympikus", "NOPE")) === null,
    "get de chave ausente => null",
  );

  /* all() devolve ambas */
  const all = await store.all();
  ok(all.length === 2, "all() devolve 2 linhas");

  console.log(`staging.test.ts PASS (${passed} asserções)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
