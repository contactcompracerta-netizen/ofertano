/**
 * CATALOG_ARCHITECTURE_V1 — PARITY ENGINE TESTS.
 *
 * Prova de paridade entre o gate legado e o gate V1 para a MESMA observação.
 * Classes: PARITY_MATCH, V1_MORE_PERMISSIVE_THAN_LEGACY (bloqueia),
 * PUBLICATION_UNEXPLAINED_MISMATCH (readiness=0), EXPLAINED_BY_MANUAL_*,
 * SKIP_PARTIAL_VIEW (nunca fabrica mismatch com visão parcial).
 */
import assert from "node:assert/strict";
import {
  aggregateParityVerdicts,
  classifyShadowParity,
  evaluateShadowReadiness,
} from "./parityEngine";

const legacyNaoPublicadoAuto: Parameters<typeof classifyShadowParity>[0]["legacy"] = {
  autoCreated: true,
  active: false,
  publicationStatus: "DRAFT",
};

const legacyPublicadoAuto: Parameters<typeof classifyShadowParity>[0]["legacy"] = {
  autoCreated: true,
  active: true,
  publicationStatus: "LIVE_COMPLETE",
};

const legacyNaoPublicadoManual: Parameters<typeof classifyShadowParity>[0]["legacy"] = {
  autoCreated: false,
  active: false,
  publicationStatus: "DRAFT",
};

// --- PARITY_MATCH: ambos publicam / ambos não publicam ----------------------
{
  const ambosNao = classifyShadowParity({
    legacy: legacyNaoPublicadoAuto,
    v1Eligible: false,
    v1ReasonCodes: ["INSUFFICIENT_PUBLIC_MULTISTORE"],
  });
  assert.equal(ambosNao.code, "PARITY_MATCH");
  assert.equal(ambosNao.match, true);
  assert.equal(ambosNao.explained, true);

  const ambosSim = classifyShadowParity({
    legacy: legacyPublicadoAuto,
    v1Eligible: true,
  });
  assert.equal(ambosSim.code, "PARITY_MATCH");
  assert.equal(ambosSim.unexpectedMismatch, false);
}

// --- V1_MORE_PERMISSIVE_THAN_LEGACY: auto-criado publicado pelo V1 ----------
{
  const verdict = classifyShadowParity({
    legacy: legacyNaoPublicadoAuto,
    v1Eligible: true,
    v1ReasonCodes: [],
    partialView: false,
  });
  assert.equal(verdict.code, "V1_MORE_PERMISSIVE_THAN_LEGACY");
  assert.equal(verdict.v1MorePermissiveThanLegacy, true, "bloqueia readiness");
  assert.equal(verdict.explained, false);
  assert.equal(verdict.match, false);
}

// --- Manual em DRAFT: divergência explicada por decisão operacional ---------
{
  const verdict = classifyShadowParity({
    legacy: legacyNaoPublicadoManual,
    v1Eligible: true,
    v1ReasonCodes: ["MANUAL_PRODUCT"],
  });
  assert.equal(verdict.code, "EXPLAINED_BY_MANUAL_DRAFT");
  assert.equal(verdict.explained, true);
  assert.equal(
    verdict.v1MorePermissiveThanLegacy,
    false,
    "manual DRAFT não bloqueia readiness",
  );
}

// --- PUBLICATION_UNEXPLAINED_MISMATCH: legado publicou, V1 negou ------------
{
  const verdict = classifyShadowParity({
    legacy: legacyPublicadoAuto,
    v1Eligible: false,
    v1ReasonCodes: ["INSUFFICIENT_PUBLIC_MULTISTORE"],
    partialView: false,
  });
  assert.equal(verdict.code, "PUBLICATION_UNEXPLAINED_MISMATCH");
  assert.equal(verdict.unexpectedMismatch, true);
  assert.equal(verdict.match, false);
}

// --- SKIP_PARTIAL_VIEW: nunca inventa mismatch com visão parcial -------------
{
  const verdict = classifyShadowParity({
    legacy: legacyPublicadoAuto,
    v1Eligible: false,
    v1ReasonCodes: ["INSUFFICIENT_PUBLIC_MULTISTORE"],
    partialView: true,
  });
  assert.equal(verdict.code, "SKIP_PARTIAL_VIEW");
  assert.equal(verdict.unexpectedMismatch, false);
  assert.equal(verdict.v1MorePermissiveThanLegacy, false);
  assert.equal(verdict.explained, true);
}

// --- Aggregado ----------------------------------------------------------------
{
  const agg = aggregateParityVerdicts([
    classifyShadowParity({ legacy: legacyNaoPublicadoAuto, v1Eligible: false }),
    classifyShadowParity({ legacy: legacyNaoPublicadoAuto, v1Eligible: true, partialView: false }),
    classifyShadowParity({ legacy: legacyPublicadoAuto, v1Eligible: false, partialView: false }),
    classifyShadowParity({ legacy: legacyPublicadoAuto, v1Eligible: false, partialView: true }),
  ]);
  assert.equal(agg.total, 4);
  assert.equal(agg.match, 1);
  assert.equal(agg.v1MorePermissiveThanLegacy, 1);
  assert.equal(agg.unexpectedMismatch, 1);
  assert.equal(agg.skippedPartialView, 1);
}

// --- Readiness ---------------------------------------------------------------
{
  const ok = evaluateShadowReadiness({
    realWrites: 5,
    unexpectedMismatch: 0,
    v1MorePermissiveThanLegacy: 0,
    writeFailed: 0,
  });
  assert.equal(ok.ready, true);
  assert.deepEqual(ok.reasonCodes, []);

  const semEscrita = evaluateShadowReadiness({
    realWrites: 0,
    unexpectedMismatch: 0,
    v1MorePermissiveThanLegacy: 0,
    writeFailed: 0,
  });
  assert.equal(semEscrita.ready, false, "sem escrita real => NO");
  assert.ok(semEscrita.reasonCodes.includes("NO_REAL_SHADOW_WRITES"));

  const permissivo = evaluateShadowReadiness({
    realWrites: 3,
    unexpectedMismatch: 0,
    v1MorePermissiveThanLegacy: 1,
    writeFailed: 0,
  });
  assert.equal(permissivo.ready, false, "V1 mais permissivo => bloqueia");
  assert.ok(permissivo.reasonCodes.includes("V1_MORE_PERMISSIVE_THAN_LEGACY"));

  const mismatch = evaluateShadowReadiness({
    realWrites: 3,
    unexpectedMismatch: 2,
    v1MorePermissiveThanLegacy: 0,
    writeFailed: 0,
  });
  assert.equal(mismatch.ready, false, "mismatch inexplicado => bloqueia");
  assert.ok(mismatch.reasonCodes.includes("PUBLICATION_UNEXPLAINED_MISMATCH_NOT_ZERO"));

  const falha = evaluateShadowReadiness({
    realWrites: 3,
    unexpectedMismatch: 0,
    v1MorePermissiveThanLegacy: 0,
    writeFailed: 1,
  });
  assert.equal(falha.ready, false, "falha de escrita => bloqueia");
  assert.ok(falha.reasonCodes.includes("SHADOW_WRITE_FAILED"));
}

console.log("shadow/parityEngine.test.ts PASS");