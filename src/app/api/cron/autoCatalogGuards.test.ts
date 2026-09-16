import assert from "node:assert/strict";
import test from "node:test";

import { GET as catalogPopulate } from "./catalog-populate/route";
import { GET as importQueue } from "./import-queue/route";

const request = () =>
  new Request("http://localhost/api/cron/test", {
    headers: {
      authorization: "Bearer test-secret",
    },
  });

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

test("catalog-populate skips before acquisition when disabled", async () => {
  const previousSecret = process.env.CRON_SECRET;
  const previousFlag = process.env.CATALOG_POPULATE_ENABLED;
  process.env.CRON_SECRET = "test-secret";
  delete process.env.CATALOG_POPULATE_ENABLED;

  try {
    const response = await catalogPopulate(request());
    assert.equal(response.status, 200);
    const body = await json(response);
    assert.equal(body.success, true);
    assert.equal(body.skipped, true);
    assert.equal(body.automated, true);
    assert.equal(
      body.reason,
      "CATALOG_POPULATE_ENABLED is not explicitly true.",
    );
    assert.equal(typeof body.executedAt, "string");
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
    if (previousFlag === undefined) delete process.env.CATALOG_POPULATE_ENABLED;
    else process.env.CATALOG_POPULATE_ENABLED = previousFlag;
  }
});

test("import-queue skips before processing when disabled", async () => {
  const previousSecret = process.env.CRON_SECRET;
  const previousFlag = process.env.IMPORT_QUEUE_PROCESS_ENABLED;
  process.env.CRON_SECRET = "test-secret";
  delete process.env.IMPORT_QUEUE_PROCESS_ENABLED;

  try {
    const response = await importQueue(request());
    assert.equal(response.status, 200);
    const body = await json(response);
    assert.equal(body.success, true);
    assert.equal(body.skipped, true);
    assert.equal(body.automated, true);
    assert.equal(
      body.reason,
      "IMPORT_QUEUE_PROCESS_ENABLED is not explicitly true.",
    );
  } finally {
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
    if (previousFlag === undefined) delete process.env.IMPORT_QUEUE_PROCESS_ENABLED;
    else process.env.IMPORT_QUEUE_PROCESS_ENABLED = previousFlag;
  }
});
