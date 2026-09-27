/**
 * FASE P (FASE U) — REGRESSÃO DO HARNESS DE BLIND REDISCOVERY.
 *
 * O harness afirmava no comentário: "decide sobre o candidato realmente
 * encontrado". O código lia `gen.candidates[0]`. Só coincide quando a verdade
 * é a primeira candidata.
 *
 * Estes testes existem para provar a diferença, e a prova precisa ser o caso
 * que o código antigo erraria: `candidates[0]` INCORRETA e a verdade em
 * `candidates[1]`. Com a lista como está hoje, os dois implementações dão o
 * mesmo resultado e o teste não provaria nada.
 *
 * Nenhum teste aqui toca banco, rede ou credencial.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { selectTruthCandidate } from "./fase8-3-blind-rediscovery";

type Cand = { candidateKey: string; score?: number };

const ML = "mercado_livre:MLB1";
const MAG = "magazine_luiza:MAG1";
const TRUTH = "mercado_livre:MLB-TRUTH";

test("quando candidates[0] e INCORRETA, a verdade e a segunda e ela e escolhida", () => {
  const candidates: Cand[] = [
    { candidateKey: MAG, score: 0.99 },
    { candidateKey: TRUTH, score: 0.42 },
  ];

  const escolhida = selectTruthCandidate(candidates, [ML, TRUTH]);

  assert.ok(escolhida, "a verdade tem de ser encontrada mesmo fora da posicao 0");
  assert.equal(
    escolhida!.candidateKey,
    TRUTH,
    "a candidata avaliada e a que corresponde a verdade, nao a de maior score",
  );
  assert.notEqual(
    escolhida!.candidateKey,
    candidates[0].candidateKey,
    "isto e o que o harness antigo (candidates[0]) mediria por engano",
  );
});

test("quando a verdade e a primeira, o comportamento nao muda (6/6 continua 6/6)", () => {
  const candidates: Cand[] = [{ candidateKey: TRUTH }, { candidateKey: MAG }];

  const escolhida = selectTruthCandidate(candidates, [ML, TRUTH]);

  assert.equal(escolhida!.candidateKey, TRUTH);
  assert.equal(escolhida!.candidateKey, candidates[0].candidateKey);
});

test("a verdade pode ser qualquer uma das duas pontas do par", () => {
  const candidates: Cand[] = [{ candidateKey: MAG }, { candidateKey: ML }];

  // O par (a, b): qualquer uma das pontas é a verdade do par.
  assert.equal(selectTruthCandidate(candidates, [ML, TRUTH])!.candidateKey, ML);
  assert.equal(
    selectTruthCandidate(candidates, [TRUTH, ML])!.candidateKey,
    ML,
  );
});

test("ausencia de verdade devolve undefined em vez de devolver candidates[0]", () => {
  const candidates: Cand[] = [{ candidateKey: MAG }, { candidateKey: ML }];

  // O comportamento antigo devolvia MAG e contava como decisão tomada.
  assert.equal(selectTruthCandidate(candidates, [TRUTH]), undefined);
});

test("lista vazia nao quebra", () => {
  assert.equal(selectTruthCandidate([], [TRUTH]), undefined);
});

test("a ordem de generacao nao define a resposta", () => {
  const truth = { candidateKey: TRUTH };

  const comVerdadePrimeira = selectTruthCandidate([truth, { candidateKey: MAG }], [
    ML,
    TRUTH,
  ]);
  const comVerdadeUltima = selectTruthCandidate([{ candidateKey: MAG }, truth], [
    ML,
    TRUTH,
  ]);

  assert.equal(comVerdadePrimeira!.candidateKey, TRUTH);
  assert.equal(comVerdadeUltima!.candidateKey, TRUTH);
});
