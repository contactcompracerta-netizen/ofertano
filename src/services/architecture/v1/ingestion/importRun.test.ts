/**
 * CATALOG_ARCHITECTURE_V1 — IMPORT RUN / SNAPSHOT TESTS (FASE J/K, puro-lógica).
 *
 *  - startImportRun cria run RUNNING + primeiro batch RUNNING index 0;
 *  - mergeRunTotals acumula totais (retenção de QPS para 1M listings);
 *  - detectMissingListingsFromSnapshot NUNCA reconcilia snapshot incompleto
 *    (SKIP), respeita grace period e só reporta ausências após ele.
 */
import assert from "node:assert/strict";
import {
  startImportRun,
  mergeRunTotals,
  detectMissingListingsFromSnapshot,
  IMPORT_RUN_MODES,
  IMPORT_RUN_STATUS,
} from "./importRun";
import { InMemoryImportRunRepository } from "../fake/inMemoryRepositories";

async function main() {
  const repo = new InMemoryImportRunRepository();

  // --- startImportRun -----------------------------------------------------------
  {
    const { run, batch } = await startImportRun(repo, {
      source: "fake-connector-a",
      marketplaceId: "MARKET_A",
      mode: IMPORT_RUN_MODES.FULL_SNAPSHOT,
      gracePeriodMinutes: 1440,
    });
    assert.equal(run.status, IMPORT_RUN_STATUS.RUNNING);
    assert.equal(run.mode, "FULL_SNAPSHOT");
    assert.equal(run.itemsReceived, 0);
    assert.equal(batch.index, 0);
    assert.equal(batch.runId, run.id);
    assert.equal(batch.status, "RUNNING");
    assert.ok(run.startedAt, "startedAt preenchido");
    assert.equal(run.finishedAt, null);
  }

  // --- mergeRunTotals -----------------------------------------------------------
  {
    const total = mergeRunTotals(
      { received: 998, changed: 2, unchanged: 990, rejected: 3, failed: 3 },
      { received: 2, changed: 0, unchanged: 2, rejected: 0, failed: 0 },
    );
    assert.deepEqual(total, { received: 1000, changed: 2, unchanged: 992, rejected: 3, failed: 3 });
  }

  // --- detectMissingListingsFromSnapshot ---------------------------------------
  const nowIso = "2026-09-24T12:00:00.000Z";
  const finishedAt = "2026-09-24T10:00:00.000Z"; // 2h antes => dentro de grace 24h
  const oldFinishedAt = "2026-09-20T10:00:00.000Z"; // 4 dias antes => além do grace

  const previousKeys = ["k1", "k2", "k3"];
  const currentKeys = ["k1"];

  // snapshot anterior COMPLETED e dentro do grace period => SKIP (não reporta ausência)
  {
    const verdict = detectMissingListingsFromSnapshot({
      previousRun: {
        id: "r1",
        source: "fake-connector-a",
        marketplaceId: "MARKET_A",
        mode: "FULL_SNAPSHOT",
        status: "COMPLETED",
        startedAt: finishedAt,
        finishedAt,
        itemsReceived: 3,
        itemsChanged: 0,
        itemsUnchanged: 3,
        itemsRejected: 0,
        itemsFailed: 0,
        lastSeenAt: finishedAt,
        gracePeriodMinutes: 1440,
        cursor: null,
      },
      previousKeys,
      currentKeys,
      nowIso,
    });
    assert.equal(verdict.snapshotOk, true);
    assert.equal(verdict.missingCount, 0, "dentro do grace period => nenhuma ausência reportada");
    assert.deepEqual(verdict.skippedKeys, ["k2", "k3"]);
  }

  // além do grace period => ausências reportadas
  {
    const verdict = detectMissingListingsFromSnapshot({
      previousRun: {
        id: "r1",
        source: "fake-connector-a",
        marketplaceId: "MARKET_A",
        mode: "FULL_SNAPSHOT",
        status: "COMPLETED",
        startedAt: oldFinishedAt,
        finishedAt: oldFinishedAt,
        itemsReceived: 3,
        itemsChanged: 0,
        itemsUnchanged: 3,
        itemsRejected: 0,
        itemsFailed: 0,
        lastSeenAt: oldFinishedAt,
        gracePeriodMinutes: 1440,
        cursor: null,
      },
      previousKeys,
      currentKeys,
      nowIso,
    });
    assert.equal(verdict.missingCount, 2, "após grace period => ausências são candidatas");
    assert.deepEqual(verdict.missingKeys.sort(), ["k2", "k3"]);
  }

  // snapshot anterior NÃO COMPLETED (FAILED/PARTIAL) => SKIP, nunca reconhece ausência
  {
    const failedVerdict = detectMissingListingsFromSnapshot({
      previousRun: {
        id: "r1",
        source: "fake-connector-a",
        marketplaceId: "MARKET_A",
        mode: "FULL_SNAPSHOT",
        status: "FAILED",
        startedAt: oldFinishedAt,
        finishedAt: oldFinishedAt,
        itemsReceived: 3,
        itemsChanged: 0,
        itemsUnchanged: 3,
        itemsRejected: 0,
        itemsFailed: 0,
        lastSeenAt: oldFinishedAt,
        gracePeriodMinutes: 1440,
        cursor: null,
      },
      previousKeys,
      currentKeys,
      nowIso,
    });
    assert.equal(failedVerdict.snapshotOk, false, "snapshot incompleto => reconciliation SKIP");
    assert.equal(failedVerdict.missingCount, 0);
    assert.deepEqual(failedVerdict.skippedKeys.sort(), ["k2", "k3"], "sumidas ficam em skipped, não em missing");
  }

  // sem snapshot anterior => nada a reconciliar
  {
    const verdict = detectMissingListingsFromSnapshot({
      previousRun: null,
      previousKeys,
      currentKeys,
      nowIso,
    });
    assert.equal(verdict.snapshotOk, false);
    assert.equal(verdict.missingCount, 0);
    assert.deepEqual(verdict.missingKeys, []);
  }

  // grace period customizado via input
  {
    const verdict = detectMissingListingsFromSnapshot({
      previousRun: {
        id: "r1",
        source: "fake-connector-a",
        marketplaceId: "MARKET_A",
        mode: "FULL_SNAPSHOT",
        status: "COMPLETED",
        startedAt: finishedAt,
        finishedAt,
        itemsReceived: 3,
        itemsChanged: 0,
        itemsUnchanged: 3,
        itemsRejected: 0,
        itemsFailed: 0,
        lastSeenAt: finishedAt,
        gracePeriodMinutes: 1440,
        cursor: null,
      },
      previousKeys,
      currentKeys,
      nowIso,
      gracePeriodMinutes: 30,
    });
    assert.equal(verdict.missingCount, 2, "grace de 30min com 2h decorridas => ausências reportadas");
    assert.equal(verdict.gracePeriodMinutes, 30);
  }

  console.log("importRun.test.ts PASS");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});