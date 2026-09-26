/**
 * CATALOG_ARCHITECTURE_V1 — FASE 7.2: MÁQUINA DE ESTADOS DO AUTOPILOT.
 *
 * Prova pura (sem banco, sem rede, sem relógio real) das regras que decidem a
 * progressão 1 -> 5 -> 25 -> 100. Aqui não há mock de "o sistema funciona":
 * `decideAutopilot` é a função que o cron e o operador executam, e cada
 * cenário abaixo é o comportamento exigido pela missão.
 *
 * Invariantes provados aqui:
 *   A) WAITING_1 -> VALIDATING_1 -> WAITING_5 (tempo NÃO promove sozinho).
 *   B) 5 -> 25 e 25 -> 100 pela MESMA regra, sem atalho.
 *   C) 100 -> COMPLETED e NUNCA acima de 100.
 *   D) violação crítica -> TRIP imediato, sem esperar cooldown.
 *   E) PAUSED e TRIPPED não promovem; TRIPPED não se fecha sozinho.
 *   F) budget esgotado não é violação: esgota, e o próximo degrau continua
 *      esperando evidência REAL.
 *   G) replay não é amostra: 100 execuções da MESMA listing não promovem.
 *   H) tempo é necessário e nunca suficiente.
 *   I) o alvo do degrau é função pura do estado (impossível pular 1 -> 25).
 *   J) rejeição de guarda (FASE J) não é erro crítico nem bloqueio.
 *   K) probes externos nunca geram decisão destrutiva.
 */
import assert from "node:assert/strict";

import {
  AUTOPILOT_LADDER,
  AUTOPILOT_MAX_EVIDENCE_COMMITS,
  AUTOPILOT_MAX_STAGE,
  AUTOPILOT_MIN_DISTINCT_LISTINGS,
  AUTOPILOT_MIN_OBSERVATION_MS,
  AUTOPILOT_POLICY_BLOCK_CODES,
  AUTOPILOT_STATES,
  decideAutopilot,
  isTerminalState,
  nextStageOf,
  requiredDistinctListings,
  requiredEvidenceCommits,
  stageOfState,
  validatingStateForStage,
  waitingStateForStage,
  type AutopilotGates,
  type AutopilotState,
} from "./autopilot";

const evidence: string[] = [];
function check(name: string, fn: () => void): void {
  fn();
  evidence.push(name);
}

/** Gates 100% verdes, do jeito que um estágio real se aproxima. */
function greenGates(over: Partial<AutopilotGates> = {}): AutopilotGates {
  return {
    usedWrites: 1,
    maxWrites: 1,
    v1Committed: 1,
    uniqueExternalListings: 1,
    doubleWrites: 0,
    duplicates: 0,
    identityCorruption: 0,
    unexpectedParityDifferences: 0,
    globalBudgetViolations: 0,
    systemCriticalErrors: 0,
    policyBlocked: 0,
    autoActiveLt2: 0,
    breakerState: "CLOSED",
    ...over,
  };
}

const T0 = Date.UTC(2026, 8, 26, 6, 0, 0);
const COOLDOWN = AUTOPILOT_MIN_OBSERVATION_MS;

/* ========================================================================== */
/* A) A ESCADA É FIXA E O ESTÁGIO É DEDUZÍVEL DO ESTADO                        */
/* ========================================================================== */

check("A1 escada fixa 1,5,25,100", () => {
  assert.deepEqual([...AUTOPILOT_LADDER], [1, 5, 25, 100]);
  assert.equal(AUTOPILOT_MAX_STAGE, 100);
});

check("A2 todo estado da missao existe e e deduplicado", () => {
  const expected = [
    "WAITING_1",
    "VALIDATING_1",
    "WAITING_5",
    "VALIDATING_5",
    "WAITING_25",
    "VALIDATING_25",
    "WAITING_100",
    "VALIDATING_100",
    "COMPLETED",
    "PAUSED",
    "TRIPPED",
  ];
  assert.deepEqual([...AUTOPILOT_STATES].sort(), [...expected].sort());
});

check("A3 stageOfState extrai o estagio; terminais nao tem estagio", () => {
  for (const stage of AUTOPILOT_LADDER) {
    assert.equal(stageOfState(waitingStateForStage(stage)), stage);
    assert.equal(stageOfState(validatingStateForStage(stage)), stage);
  }
  assert.equal(stageOfState("COMPLETED"), null);
  assert.equal(stageOfState("PAUSED"), null);
  assert.equal(stageOfState("TRIPPED"), null);
  assert.equal(isTerminalState("COMPLETED"), true);
  assert.equal(isTerminalState("WAITING_25"), false);
});

/* ========================================================================== */
/* I) O ALVO É FUNÇÃO PURA DO ESTADO — 1 -> 25 É ESTRUTURALMENTE IMPOSSÍVEL    */
/* ========================================================================== */

check("I1 proximo estagio segue a escada e 100 e o fim", () => {
  assert.equal(nextStageOf(1), 5);
  assert.equal(nextStageOf(5), 25);
  assert.equal(nextStageOf(25), 100);
  assert.equal(nextStageOf(100), null);
  assert.equal(nextStageOf(7), null, "estagio fora da escada nao promove");
});

check("I2 promote exatamente UM degrau, nunca dois", () => {
  for (const stage of AUTOPILOT_LADDER) {
    const from = validatingStateForStage(stage);
    const decision = decideAutopilot({
      state: from,
      stage,
      gates: greenGates({
        usedWrites: Math.max(stage, 1),
        maxWrites: stage,
        v1Committed: AUTOPILOT_MAX_EVIDENCE_COMMITS,
        uniqueExternalListings: requiredDistinctListings(stage),
      }),
      now: T0,
      cooldownUntil: T0,
      minObservationMs: COOLDOWN,
    });
    assert.equal(decision.kind, "PROMOTE", `estagio ${stage}`);
    const expectedStage = nextStageOf(stage) ?? AUTOPILOT_MAX_STAGE;
    assert.equal(decision.stageAfter, expectedStage, `estagio ${stage}`);
    // COMPLETED só sai do TETO (100). Todo degrau intermediário vai para
    // WAITING_<próximo>, porque o próximo estágio ainda precisa de evidência.
    assert.equal(
      decision.stateAfter,
      nextStageOf(stage) === null
        ? "COMPLETED"
        : waitingStateForStage(expectedStage),
      `estado pos-promocao do estagio ${stage}`,
    );
  }
});

check("I3 saindo do estagio 1 o alvo e SEMPRE 5, nunca 25 nem 100", () => {
  // A corrida que a missao proibe ("maxWrites 1 -> 25 por corrida") nao pode
  // sequer ser montada: o alvo e funcao do ESTADO, nao do teto digitado.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const decision = decideAutopilot({
      state: "VALIDATING_1",
      stage: 1,
      gates: greenGates({
        // Tetos absurdos, como se dois atores lesseem valores diferentes.
        usedWrites: 999,
        maxWrites: 999,
        v1Committed: 999,
        uniqueExternalListings: 999,
      }),
      now: T0,
      cooldownUntil: T0,
      minObservationMs: COOLDOWN,
    });
    assert.equal(decision.kind, "PROMOTE");
    assert.equal(decision.stageAfter, 5, `tentativa ${attempt}`);
  }
});

/* ========================================================================== */
/* H) TEMPO É NECESSÁRIO E NUNCA SUFICIENTE                                    */
/* ========================================================================== */

check("H1 cooldown ativo segura a promocao mesmo com evidencia perfeita", () => {
  const decision = decideAutopilot({
    state: "VALIDATING_1",
    stage: 1,
    gates: greenGates(),
    now: T0,
    cooldownUntil: T0 + COOLDOWN,
    minObservationMs: COOLDOWN,
  });
  assert.equal(decision.kind, "WAIT");
  assert.deepEqual(decision.blockers, ["cooldown"]);
  assert.match(String(decision.reason), /^cooldown-ativo:/);
});

check("H2 tempo So, sem evidencia, NAO promove", () => {
  const decision = decideAutopilot({
    state: "VALIDATING_1",
    stage: 1,
    // Tempo cumprido, mas nenhuma escrita real aconteceu.
    gates: greenGates({ usedWrites: 0, v1Committed: 0, uniqueExternalListings: 0 }),
    now: T0 + COOLDOWN * 10,
    cooldownUntil: T0,
    minObservationMs: COOLDOWN,
  });
  assert.equal(decision.kind, "WAIT");
  assert.equal(decision.stateAfter, "VALIDATING_1");
});

/* ========================================================================== */
/* A) WAITING_n -> VALIDATING_n -> WAITING_{n+1}                                */
/* ========================================================================== */

check("A4 cooldown cumprido em WAITING_n move para VALIDATING_n sem promover", () => {
  const decision = decideAutopilot({
    state: "WAITING_1",
    stage: 1,
    gates: greenGates(),
    now: T0 + COOLDOWN,
    cooldownUntil: T0,
    minObservationMs: COOLDOWN,
  });
  assert.equal(decision.kind, "WAIT", "primeiro passo inspeciona, nao promove");
  assert.equal(decision.stateAfter, "VALIDATING_1");
  assert.equal(decision.stageAfter, 1, "o estagio NAO muda ao inspecionar");
  assert.deepEqual(decision.blockers, ["inspecao"]);
});

check("A5 a sequencia completa 1 -> 5 -> 25 -> 100 -> COMPLETED", () => {
  // Simula a escada inteira: em cada estago, cooldown cumprido + evidencia
  // real suficiente. Duaspassadas por estagio (inspecionar, promover).
  const walk: Array<{ state: AutopilotState; stage: number }> = [
    { state: "WAITING_1", stage: 1 },
  ];
  const seen: string[] = [];
  for (let step = 0; step < 12; step += 1) {
    const current = walk[walk.length - 1];
    const decision = decideAutopilot({
      state: current.state,
      stage: current.stage,
      gates: greenGates({
        usedWrites: Math.max(current.stage, 1),
        maxWrites: current.stage,
        v1Committed: AUTOPILOT_MAX_EVIDENCE_COMMITS,
        uniqueExternalListings: requiredDistinctListings(current.stage),
      }),
      now: T0,
      cooldownUntil: T0,
      minObservationMs: COOLDOWN,
    });
    seen.push(`${current.state}->${decision.stateAfter}(${decision.kind})`);
    if (decision.stateAfter === current.state && decision.kind === "NOOP") {
      break;
    }
    walk.push({ state: decision.stateAfter, stage: decision.stageAfter });
    if (decision.stateAfter === "COMPLETED") {
      break;
    }
  }
  const final = walk[walk.length - 1];
  assert.equal(final.state, "COMPLETED", seen.join(" | "));
  assert.equal(final.stage, 100);
  assert.deepEqual(seen, [
    "WAITING_1->VALIDATING_1(WAIT)",
    "VALIDATING_1->WAITING_5(PROMOTE)",
    "WAITING_5->VALIDATING_5(WAIT)",
    "VALIDATING_5->WAITING_25(PROMOTE)",
    "WAITING_25->VALIDATING_25(WAIT)",
    "VALIDATING_25->WAITING_100(PROMOTE)",
    "WAITING_100->VALIDATING_100(WAIT)",
    "VALIDATING_100->COMPLETED(PROMOTE)",
  ]);
});

check("A6 COMPLETED e estavel: nao ha degrau acima de 100", () => {
  for (const stage of AUTOPILOT_LADDER) {
    const decision = decideAutopilot({
      state: "COMPLETED",
      stage,
      gates: greenGates({
        usedWrites: 99,
        maxWrites: 100,
        v1Committed: 99,
        uniqueExternalListings: 99,
      }),
      now: T0,
      cooldownUntil: T0,
      minObservationMs: COOLDOWN,
    });
    assert.equal(decision.kind, "NOOP");
    assert.equal(decision.stateAfter, "COMPLETED");
    assert.equal(decision.stageAfter, stage, "100 nao vira alvo de nova promocao");
  }
});

/* ========================================================================== */
/* D) VIOLAÇÃO CRÍTICA -> TRIP IMEDIATO                                        */
/* ========================================================================== */

check("D1 cada violacao critica tripou, com o motivo mais especifico", () => {
  const cases: Array<[Partial<AutopilotGates>, string]> = [
    [{ doubleWrites: 1 }, "DUPLICATE_UNEXPECTED"],
    [{ identityCorruption: 1 }, "IDENTITY_CORRUPTION"],
    [{ unexpectedParityDifferences: 1 }, "PARITY_DIFF_UNEXPECTED"],
    [{ globalBudgetViolations: 1 }, "WRITE_BUDGET_EXCEEDED"],
    [{ autoActiveLt2: 1 }, "PUBLICATION_VIOLATION"],
    [{ systemCriticalErrors: 1 }, "V1_ERRORS_ABOVE_LIMIT"],
  ];
  for (const [over, expectedReason] of cases) {
    const decision = decideAutopilot({
      state: "WAITING_1",
      stage: 1,
      gates: greenGates(over),
      // Cooldown ainda ATIVO: um trip não espera cooldown. Violação é violação.
      now: T0,
      cooldownUntil: T0 + COOLDOWN,
      minObservationMs: COOLDOWN,
    });
    assert.equal(decision.kind, "TRIP", JSON.stringify(over));
    assert.equal(decision.tripReason, expectedReason, JSON.stringify(over));
    assert.equal(decision.stateAfter, "TRIPPED");
  }
});

check("D2 duplicate e double-write Abujam, nao viram promocao", () => {
  const decision = decideAutopilot({
    state: "VALIDATING_25",
    stage: 25,
    gates: greenGates({
      doubleWrites: 1,
      duplicates: 1,
      usedWrites: 25,
      maxWrites: 25,
      v1Committed: 5,
      uniqueExternalListings: 3,
    }),
    now: T0,
    cooldownUntil: T0,
    minObservationMs: COOLDOWN,
  });
  assert.equal(decision.kind, "TRIP");
  assert.equal(decision.stageAfter, 25, "o estagio nao avanca no trip");
  assert.ok(decision.blockers.includes("doubleWrite=1"));
  assert.ok(decision.blockers.includes("duplicate=1"));
});

/* ========================================================================== */
/* E) PAUSED / TRIPPED / BREAKER ABERTO                                        */
/* ========================================================================== */

check("E1 TRIPPED nao promove e nao se fecha sozinho", () => {
  for (const stage of AUTOPILOT_LADDER) {
    const decision = decideAutopilot({
      state: "TRIPPED",
      stage,
      gates: greenGates({
        usedWrites: 5,
        maxWrites: stage,
        v1Committed: 5,
        uniqueExternalListings: 5,
      }),
      now: T0,
      cooldownUntil: T0,
      minObservationMs: COOLDOWN,
    });
    assert.equal(decision.kind, "NOOP");
    assert.equal(decision.stateAfter, "TRIPPED");
    assert.equal(decision.reason, "tripped-sem-fechamento-automatico");
  }
});

check("E2 PAUSED nao promove mesmo com tudo verde", () => {
  const decision = decideAutopilot({
    state: "PAUSED",
    stage: 5,
    gates: greenGates({
      usedWrites: 5,
      maxWrites: 5,
      v1Committed: 5,
      uniqueExternalListings: 2,
    }),
    now: T0 + COOLDOWN * 100,
    cooldownUntil: T0,
    minObservationMs: COOLDOWN,
  });
  assert.equal(decision.kind, "NOOP");
  assert.equal(decision.stateAfter, "PAUSED");
  assert.equal(decision.reason, "pausado-pelo-operador");
});

check("E3 breaker aberto e NOOP: nao promove e nao re-tripou", () => {
  const decision = decideAutopilot({
    state: "VALIDATING_5",
    stage: 5,
    gates: greenGates({
      breakerState: "OPEN",
      usedWrites: 5,
      maxWrites: 5,
      v1Committed: 5,
      uniqueExternalListings: 2,
    }),
    now: T0,
    cooldownUntil: T0,
    minObservationMs: COOLDOWN,
  });
  assert.equal(decision.kind, "NOOP");
  assert.equal(decision.reason, "breaker-aberto-aguardando-operador");
});

check("E4 estado e estagio incoerentes nao promovem (fail-safe)", () => {
  const decision = decideAutopilot({
    state: "VALIDATING_25",
    stage: 5, // par NAO casa com o estado
    gates: greenGates({ usedWrites: 5, maxWrites: 5, v1Committed: 5 }),
    now: T0,
    cooldownUntil: T0,
    minObservationMs: COOLDOWN,
  });
  assert.equal(decision.kind, "NOOP");
  assert.match(String(decision.reason), /estado-incoerente/);
});

/* ========================================================================== */
/* F) BUDGET ESGOTADO NÃO É VIOLAÇÃO                                           */
/* ========================================================================== */

check("F1 orcamento esgotado nao tripou: e o comportamento do canario", () => {
  const decision = decideAutopilot({
    state: "VALIDATING_1",
    stage: 1,
    // usedWrites == maxWrites == 1: exaustão, não violação.
    gates: greenGates({ usedWrites: 1, maxWrites: 1, v1Committed: 1 }),
    now: T0,
    cooldownUntil: T0,
    minObservationMs: COOLDOWN,
  });
  assert.equal(decision.kind, "PROMOTE");
  assert.equal(decision.blockers.length, 0);
});

check("F2 usedWrites > maxWrites e violacao e bloqueia", () => {
  const decision = decideAutopilot({
    state: "VALIDATING_1",
    stage: 1,
    gates: greenGates({ usedWrites: 2, maxWrites: 1, v1Committed: 1 }),
    now: T0,
    cooldownUntil: T0,
    minObservationMs: COOLDOWN,
  });
  assert.equal(decision.kind, "WAIT");
  assert.ok(decision.blockers.includes("usedWrites>maxWrites"));
});

/* ========================================================================== */
/* G) REPLAY NÃO É AMOSTRA (FASE L)                                            */
/* ========================================================================== */

check("G1 100 execucoes da MESMA listing nao promovem", () => {
  const decision = decideAutopilot({
    state: "VALIDATING_100",
    stage: 100,
    gates: greenGates({
      usedWrites: 100,
      maxWrites: 100,
      v1Committed: 100,
      // 100 commits, mas de UMA listing só: 1 amostra real.
      uniqueExternalListings: 1,
    }),
    now: T0,
    cooldownUntil: T0,
    minObservationMs: COOLDOWN,
  });
  assert.equal(decision.kind, "WAIT");
  assert.ok(
    decision.blockers.some((b) => b.startsWith("listingsDistintas=1<")),
    decision.blockers.join(","),
  );
});

check("G2 o piso de listagens distintas cresce e o de commits e limitado a 5", () => {
  assert.deepEqual(
    Object.entries(AUTOPILOT_MIN_DISTINCT_LISTINGS).map(([k, v]) => [Number(k), v]),
    [
      [1, 1],
      [5, 2],
      [25, 3],
      [100, 5],
    ],
  );
  assert.equal(requiredDistinctListings(1), 1);
  assert.equal(requiredDistinctListings(100), 5);
  assert.equal(requiredEvidenceCommits(1), 1);
  assert.equal(requiredEvidenceCommits(5), 5);
  assert.equal(requiredEvidenceCommits(25), 5, "25 e teto, nao meta");
  assert.equal(requiredEvidenceCommits(100), 5, "100 e teto, nao meta");
  assert.equal(AUTOPILOT_MAX_EVIDENCE_COMMITS, 5);
});

/* ========================================================================== */
/* J) REJEIÇÃO DE GUARDA NÃO É FALHA CRÍTICA                                   */
/* ========================================================================== */

check("J1 policyBlocked alto nao tripou nem bloqueia", () => {
  const decision = decideAutopilot({
    state: "VALIDATING_5",
    stage: 5,
    gates: greenGates({
      usedWrites: 5,
      maxWrites: 5,
      v1Committed: 5,
      uniqueExternalListings: 2,
      policyBlocked: 17,
    }),
    now: T0,
    cooldownUntil: T0,
    minObservationMs: COOLDOWN,
  });
  assert.equal(decision.kind, "PROMOTE");
});

check("J2 os codigos de guarda sao os da FASE 7.1 e nada mais", () => {
  assert.deepEqual([...AUTOPILOT_POLICY_BLOCK_CODES], [
    "POLICY_NOT_READY",
    "MULTISTORE_NOT_READY",
    "IDENTITY_REVIEW",
    "IDENTITY_REJECT",
    "INVALID_DATA",
  ]);
  for (const code of AUTOPILOT_POLICY_BLOCK_CODES) {
    assert.ok(!code.includes("UNEXPECTED"), code);
  }
});

/* ========================================================================== */
/* K) PROBES EXTERNOS NUNCA GERAM DECISÃO DESTRUTIVA                           */
/* ========================================================================== */

check("K1 probes nao entram em decideAutopilot: a assinatura nao as recebe", () => {
  // `decideAutopilot` recebe apenas `gates` derivado do ledger/rollout. Não
  // existe parâmetro de probe: por construção, HTTP externo não pode virar
  // TRIP nem bloqueio de promoção.
  const decision = decideAutopilot({
    state: "VALIDATING_1",
    stage: 1,
    gates: greenGates(),
    now: T0,
    cooldownUntil: T0,
    minObservationMs: COOLDOWN,
  });
  assert.equal(decision.kind, "PROMOTE");
});

/* ========================================================================== */
/* DETERMINISMO — a mesma entrada dá sempre a mesma decisão                    */
/* ========================================================================== */

check("Z1 decisao e pura: mesma entrada, mesma saida", () => {
  const input = {
    state: "VALIDATING_25" as AutopilotState,
    stage: 25,
    gates: greenGates({
      usedWrites: 25,
      maxWrites: 25,
      v1Committed: 4,
      uniqueExternalListings: 3,
    }),
    now: T0,
    cooldownUntil: T0,
    minObservationMs: COOLDOWN,
  };
  const first = decideAutopilot(input);
  const second = decideAutopilot(input);
  assert.deepEqual(first, second);
  assert.equal(first.kind, "WAIT", "falta 1 commit de evidencia real");
  assert.ok(first.blockers.includes("v1Committed=4<5"));
});

/* -------------------------------------------------------------------------- */

console.log("");
console.log("=== CATALOG_V1 AUTOPILOT — MAQUINA DE ESTADOS (FASE 7.2) ===");
for (const item of evidence) {
  console.log(`  ok  ${item}`);
}
console.log(`AUTOPILOT_STATE_MACHINE=PASS (${evidence.length} verificacoes)`);
console.log("ESCADA=1,5,25,100 (100=TETO)");
console.log("COOLDOWN_MS=" + AUTOPILOT_MIN_OBSERVATION_MS);
console.log("PISO_LISTINGS_DISTINTAS=" + JSON.stringify(AUTOPILOT_MIN_DISTINCT_LISTINGS));
console.log("MAX_EVIDENCIA_COMMITS=" + AUTOPILOT_MAX_EVIDENCE_COMMITS);
console.log("CATALOG_V1_GLOBAL_CUTOVER=NO");
