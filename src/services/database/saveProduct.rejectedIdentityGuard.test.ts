import assert from "node:assert/strict";

import {
  aplicarGuardaRejeicaoIdentidade,
} from "./saveProduct";
import { buildPriceMonitorCandidateWhere } from "../priceMonitor/processPriceMonitor";
import { isUsablePublicOffer } from "../publicVisibility/multiStoreVisibility";

/*
 * Guarda de identidade REJECTED — testes de regressao.
 *
 * REJECTED e um estado persistente contra atualizacoes automaticas:
 * preco, estoque, disponibilidade ou redescoberta nunca promovem
 * REJECTED -> EXACT sozinhos. Somente revalidacao explicita
 * (`revalidateRejected`, ex.: comparacao manual) pode reverter.
 *
 * Sem banco: exercita a funcao pura usada pelo upsert do saveProduct
 * (caminho comum de Price Monitor e On Demand), o seletor do monitor
 * e a regra oficial de visibilidade. Nenhum teste aqui escreve no DB.
 */

const MOTIVO = "LEGACY_IDENTITY_CONTAMINATION";

// CASO 1 — PRICE MONITOR: oferta REJECTED recebe novo preco.
// O monitor nao seleciona REJECTED (estrategia A) e, mesmo que a
// oferta chegue ao saveProduct, o upsert preserva REJECTED.
const whereMonitor = buildPriceMonitorCandidateWhere(
  new Date("2026-09-06T12:00:00.000Z"),
) as unknown as Record<string, unknown>;
assert.deepEqual(
  (whereMonitor.matchStatus as Record<string, unknown>),
  { not: "REJECTED" },
  "monitor exclui REJECTED da selecao",
);
assert.equal(
  whereMonitor.active,
  true,
  "monitor mantem filtro active",
);

const caso1 = aplicarGuardaRejeicaoIdentidade({
  ofertaAtualMatchStatus: "REJECTED",
  ofertaAtualMatchScore: 1,
  ofertaAtualReviewReason: MOTIVO,
  calculadoMatchStatus: "EXACT",
  calculadoMatchScore: 1,
  calculadoReviewReason: MOTIVO,
});
assert.equal(caso1.matchStatus, "REJECTED", "monitor preserva REJECTED");
assert.equal(caso1.matchScore, 1, "monitor preserva matchScore");
assert.equal(
  caso1.reviewReason,
  MOTIVO,
  "monitor preserva reviewReason",
);
console.log("PRICE_MONITOR_REJECTED_PRESERVED=PASS");

// CASO 2 — ON DEMAND EXISTENTE: mesmo marketplace+externalId
// redescoberto (verifiedExactMatch sem revalidacao explicita).
const caso2 = aplicarGuardaRejeicaoIdentidade({
  ofertaAtualMatchStatus: "REJECTED",
  ofertaAtualMatchScore: 1,
  ofertaAtualReviewReason: MOTIVO,
  calculadoMatchStatus: "EXACT",
  calculadoMatchScore: 1,
  calculadoReviewReason: MOTIVO,
  revalidateRejected: undefined,
});
assert.equal(
  caso2.matchStatus,
  "REJECTED",
  "redescoberta mantem REJECTED",
);
console.log("ON_DEMAND_REJECTED_PRESERVED=PASS");

// CASO 3 — EXACT NORMAL: atualizacao legitima de preco continua EXACT.
const caso3 = aplicarGuardaRejeicaoIdentidade({
  ofertaAtualMatchStatus: "EXACT",
  ofertaAtualMatchScore: 1,
  ofertaAtualReviewReason: null,
  calculadoMatchStatus: "EXACT",
  calculadoMatchScore: 1,
  calculadoReviewReason: null,
});
assert.equal(caso3.matchStatus, "EXACT", "EXACT continua EXACT");
assert.equal(caso3.matchScore, 1, "score EXACT intacto");
console.log("EXACT_UPDATE_UNAFFECTED=PASS");

// CASO 4 — NOVA OFERTA EXACT: sem linha existente, verificacao atual
// de identidade pode criar EXACT.
const caso4 = aplicarGuardaRejeicaoIdentidade({
  ofertaAtualMatchStatus: undefined,
  ofertaAtualMatchScore: null,
  ofertaAtualReviewReason: null,
  calculadoMatchStatus: "EXACT",
  calculadoMatchScore: 1,
  calculadoReviewReason: null,
});
assert.equal(
  caso4.matchStatus,
  "EXACT",
  "nova oferta verificada pode nascer EXACT",
);
console.log("NEW_VERIFIED_EXACT_STILL_WORKS=PASS");

// CASO 5 — VISIBILIDADE: REJECTED nao e utilizavel no publico.
assert.equal(
  isUsablePublicOffer({
    marketplace: "MERCADO_LIVRE",
    active: true,
    available: true,
    status: "ACTIVE",
    matchStatus: "REJECTED",
    price: 14.51,
  }),
  false,
  "REJECTED fora da visibilidade publica",
);
assert.equal(
  isUsablePublicOffer({
    marketplace: "MERCADO_LIVRE",
    active: true,
    available: true,
    status: "ACTIVE",
    matchStatus: "EXACT",
    price: 14.51,
  }),
  true,
  "EXACT segue utilizavel",
);
console.log("REJECTED_PUBLIC_VISIBILITY=PASS");

// CASO 6 — REVIEW REASON: razao de rejeicao nao e substituida por
// mensagem operacional ("Aguardando link...") nem zerada quando ha
// link de afiliado.
const caso6a = aplicarGuardaRejeicaoIdentidade({
  ofertaAtualMatchStatus: "REJECTED",
  ofertaAtualMatchScore: 1,
  ofertaAtualReviewReason: MOTIVO,
  calculadoMatchStatus: "EXACT",
  calculadoMatchScore: 1,
  calculadoReviewReason: "Aguardando link individual de afiliado.",
});
assert.equal(
  caso6a.reviewReason,
  MOTIVO,
  "motivo de rejeicao nao vira mensagem operacional",
);

const caso6b = aplicarGuardaRejeicaoIdentidade({
  ofertaAtualMatchStatus: "REJECTED",
  ofertaAtualMatchScore: 1,
  ofertaAtualReviewReason: MOTIVO,
  calculadoMatchStatus: "EXACT",
  calculadoMatchScore: 1,
  calculadoReviewReason: null,
});
assert.equal(
  caso6b.reviewReason,
  MOTIVO,
  "motivo de rejeicao nao e zerado",
);
console.log("REJECTED_REVIEW_REASON_PRESERVED=PASS");

// CASO 7 — RECUPERACAO EXPLICITA: com `revalidateRejected` (comparacao
// manual), REJECTED -> EXACT continua possivel somente nesse caminho.
const caso7 = aplicarGuardaRejeicaoIdentidade({
  ofertaAtualMatchStatus: "REJECTED",
  ofertaAtualMatchScore: 1,
  ofertaAtualReviewReason: MOTIVO,
  calculadoMatchStatus: "EXACT",
  calculadoMatchScore: 1,
  calculadoReviewReason: null,
  revalidateRejected: true,
});
assert.equal(
  caso7.matchStatus,
  "EXACT",
  "revalidacao explicita pode reverter REJECTED",
);
console.log("EXPLICIT_REVALIDATION=PASS");

// SECAO 13 — SIMULACAO DO CASO REAL (in-memory, sem escrita no banco):
// os 4 IDs contaminados partem de EXACT/score 1, viram REJECTED na
// limpeza simulada e depois sofrem update de Price Monitor e
// redescoberta On Demand. Ambos devem manter REJECTED.
const OFERTAS_CONTAMINADAS = [
  {
    id: "cmt6ig9sn000604l5d7sw6k7w",
    reviewReason: null as string | null,
  },
  {
    id: "cmt6ig8lf000404l533n6ou3s",
    reviewReason: null as string | null,
  },
  {
    id: "cmt6igeux000e04l5vn8q8ohh",
    reviewReason: "Aguardando link individual de afiliado.",
  },
  {
    id: "cmt6igcdp000a04l59qlbyo21",
    reviewReason: "Aguardando link individual de afiliado.",
  },
];

for (const oferta of OFERTAS_CONTAMINADAS) {
  // Estado pos-limpeza simulada.
  const rejeitada = {
    matchStatus: "REJECTED",
    matchScore: 1,
    reviewReason: MOTIVO,
  };

  // Update de Price Monitor (novo preco, oferta encontrada por codigo).
  const aposMonitor = aplicarGuardaRejeicaoIdentidade({
    ofertaAtualMatchStatus: rejeitada.matchStatus,
    ofertaAtualMatchScore: rejeitada.matchScore,
    ofertaAtualReviewReason: rejeitada.reviewReason,
    calculadoMatchStatus: "EXACT",
    calculadoMatchScore: 1,
    calculadoReviewReason: oferta.reviewReason ?? MOTIVO,
  });
  assert.equal(
    aposMonitor.matchStatus,
    "REJECTED",
    `REJECTED_AFTER_PRICE_MONITOR ${oferta.id}`,
  );

  // Redescoberta On Demand (mesmo marketplace+externalId).
  const aposOnDemand = aplicarGuardaRejeicaoIdentidade({
    ofertaAtualMatchStatus: rejeitada.matchStatus,
    ofertaAtualMatchScore: rejeitada.matchScore,
    ofertaAtualReviewReason: rejeitada.reviewReason,
    calculadoMatchStatus: "EXACT",
    calculadoMatchScore: 1,
    calculadoReviewReason: oferta.reviewReason ?? MOTIVO,
  });
  assert.equal(
    aposOnDemand.matchStatus,
    "REJECTED",
    `REJECTED_AFTER_ON_DEMAND ${oferta.id}`,
  );

  console.log(`REAL_OFFER_SIMULATION ${oferta.id} REJECTED_KEPT=PASS`);
}

console.log("rejectedIdentityGuard: todos os casos passaram");
