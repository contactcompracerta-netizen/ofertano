/**
 * TESTE DO AI IDENTITY RESOLVER (§11 / §12 / §13).
 *
 * Este arquivo existe porque o §21 da missao exige uma verificacao que nao
 * existia no checkout. Cada caso abaixo e uma armadilha concreta que o
 * resolver tem de fechar:
 *
 *  1. contrato estrito: texto solto, `confidence` como texto, `verdict`
 *     inventado e campo faltando TODOS viram UNCERTAIN — nunca SAME
 *  2. conflito duro do motor nao e anulavel pela IA
 *  3. a IA so e consultada onde o motor pediu ajuda
 *  4. cache por (seed, candidato, policyVersion) e invalidado por troca de
 *     politica
 *  5. `wouldPromoteToSame` nunca vira publicacao
 *
 * Sem provider de rede: usa ReplayAiProvider. Nenhuma chamada real de IA.
 */
import assert from "node:assert/strict";

import {
  AiMemoryCache,
  ReplayAiProvider,
  aiCacheKey,
  avaliarElegibilidadeAi,
  consultarAiShadow,
  fingerprintListing,
  validarVereditoAi,
  type AiIdentityProvider,
} from "./aiIdentityResolver";
import { evaluateIdentityConfidence } from "./identityConfidence";
import { buildFakeListing } from "../fake/fakeConnectors";
import type { NormalizedMarketplaceListingV1 } from "../types/normalizedListingV1";

function listing(
  marketplaceId: string,
  externalListingId: string,
  title: string,
): NormalizedMarketplaceListingV1 {
  return buildFakeListing({
    marketplaceId,
    externalListingId,
    identity: { gtin: [], brand: null, manufacturerModel: null, model: null, mpn: null },
    catalog: { title, category: null },
    variant: { storage: null, memory: null, voltage: null, size: null },
    commerce: { price: 1000 },
  });
}

const seedPrint = fingerprintListing({
  marketplaceId: "mercado_livre",
  externalListingId: "MLB1",
  catalog: { title: "Batedeira Electrolux EKM30" },
  identity: { brand: "Electrolux", model: null, gtin: ["7896347181877"] },
});
const candPrint = fingerprintListing({
  marketplaceId: "shopee",
  externalListingId: "SHP1",
  catalog: { title: "Batedeira Planetária Electrolux EKM30 5L" },
  identity: { brand: null, model: null, gtin: [] },
});

const PROMPT = () => "prompt";
const VEREDITO_BOM = JSON.stringify({
  verdict: "SAME",
  confidence: 0.82,
  matchingEvidence: ["modelo EKM30 nos dois titulos", "mesma capacidade 5L"],
  conflicts: [],
  normalizedIdentity: { brand: "Electrolux", model: "EKM30", gtin: [], variant: { capacity: "5L" } },
});

/**
 * Provider que conta quantas vezes foi realmente chamado pelo resolver.
 * E o que prova que o cache e o gate funcionam, em vez de so parecerem.
 */
class ContagemProvider implements AiIdentityProvider {
  readonly nome = "CONTAGEM";
  chamadas = 0;
  private readonly respostas: string[];
  private indice = 0;
  constructor(respostas: string[]) {
    this.respostas = respostas;
  }
  async complete(): Promise<string> {
    this.chamadas += 1;
    const resposta = this.respostas[Math.min(this.indice, this.respostas.length - 1)];
    this.indice += 1;
    return resposta;
  }
}

async function main(): Promise<void> {
  /* ============================================================ 1. CONTRATO */

  console.log("[1] contrato estrito e fail-closed");

  const bom = validarVereditoAi(VEREDITO_BOM);
  assert.equal(bom.veredito?.verdict, "SAME", "veredito valido deve passar");
  assert.deepEqual(bom.violacoes, [], "veredito valido nao pode ter violacao");

  const casos: Array<{ nome: string; bruto: string; violacao: string }> = [
    { nome: "texto solto", bruto: "Sim, sao o mesmo produto.", violacao: "RESPOSTA_NAO_E_JSON" },
    { nome: "json array", bruto: "[1,2,3]", violacao: "RESPOSTA_NAO_E_OBJETO" },
    {
      nome: "verdict inventado",
      bruto: JSON.stringify({ ...JSON.parse(VEREDITO_BOM), verdict: "PROBABLY" }),
      violacao: "VERDICT_INVALIDO",
    },
    {
      nome: "confidence como texto",
      bruto: JSON.stringify({ ...JSON.parse(VEREDITO_BOM), confidence: "0.82" }),
      violacao: "CONFIDENCE_NAO_E_NUMERO",
    },
    {
      nome: "confidence fora de 0..1",
      bruto: JSON.stringify({ ...JSON.parse(VEREDITO_BOM), confidence: 82 }),
      violacao: "CONFIDENCE_FORA_DE_0_1",
    },
    {
      nome: "matchingEvidence ausente",
      bruto: JSON.stringify({
        verdict: "SAME",
        confidence: 0.9,
        conflicts: [],
        normalizedIdentity: { brand: null, model: null, gtin: [], variant: {} },
      }),
      violacao: "MATCHINGEVIDENCE_NAO_E_LISTA",
    },
    {
      nome: "conflicts com item nao texto",
      bruto: JSON.stringify({ ...JSON.parse(VEREDITO_BOM), conflicts: [{ code: "x" }] }),
      violacao: "CONFLICTS_CONTEM_ITEM_NAO_TEXTO",
    },
    {
      nome: "normalizedIdentity ausente",
      bruto: JSON.stringify({
        verdict: "SAME",
        confidence: 0.9,
        matchingEvidence: [],
        conflicts: [],
      }),
      violacao: "NORMALIZEDIDENTITY_AUSENTE",
    },
  ];

  for (const caso of casos) {
    const r = validarVereditoAi(caso.bruto);
    assert.equal(r.veredito, null, `${caso.nome}: resposta invalida nao pode virar veredito`);
    assert.ok(
      r.violacoes.includes(caso.violacao),
      `${caso.nome}: esperava ${caso.violacao}, veio ${r.violacoes.join(",")}`,
    );
    console.log(`    ok  ${caso.nome.padEnd(28)} -> ${r.violacoes[0]}`);
  }

  /* ================================================================ 2. GATE */

  console.log("[2] conflito duro do motor nao e anulavel");

  const seedHw = buildFakeListing({
    marketplaceId: "mercado_livre",
    externalListingId: "MLB-HW",
    identity: { gtin: [], brand: "Samsung", manufacturerModel: null, model: "S23", mpn: null },
    catalog: { title: "Smartphone Samsung Galaxy S23 256gb", category: "celulares" },
    variant: { storage: "256GB", memory: null, voltage: null, size: null },
    commerce: { price: 1000 },
  });
  const candHw = buildFakeListing({
    marketplaceId: "shopee",
    externalListingId: "SHP-HW",
    identity: { gtin: [], brand: "Samsung", manufacturerModel: null, model: "S23", mpn: null },
    catalog: { title: "Smartphone Samsung Galaxy S23 512gb", category: "celulares" },
    variant: { storage: "512GB", memory: null, voltage: null, size: null },
    commerce: { price: 1000 },
  });
  const decisaoHw = evaluateIdentityConfidence(seedHw, candHw);
  assert.ok(
    decisaoHw.hardConflicts.length > 0,
    "256GB x 512GB tem de produzir conflito estrutural (prova de que o gate importa)",
  );

  const providerNaoChamado = new ContagemProvider([VEREDITO_BOM]);
  const rHw = await consultarAiShadow(
    {
      seed: { marketplaceId: "mercado_livre", externalListingId: "MLB-HW" },
      candidate: { marketplaceId: "shopee", externalListingId: "SHP-HW" },
      decisaoDeterministica: decisaoHw,
      montarPrompt: PROMPT,
    },
    { provider: providerNaoChamado, cache: new AiMemoryCache() },
  );
  assert.equal(rHw.gate, "SHADOW_ONLY_SKIPPED_HARD_CONFLICT");
  assert.equal(providerNaoChamado.chamadas, 0, "IA nao pode ser chamada com conflito duro");
  assert.equal(rHw.aiVerdict, null);
  assert.equal(rHw.wouldPromoteToSame, false);
  console.log(`    ok  conflito duro -> ${rHw.gate}, chamadas=0`);

  /* ============================================== 3. CONSULTA ONDE PEDE AJUDA */

  console.log("[3] a IA so e consultada onde o motor pediu ajuda");

  const semConflito = buildFakeListing({
    marketplaceId: "mercado_livre",
    externalListingId: "MLB-OK",
    identity: { gtin: [], brand: null, manufacturerModel: null, model: null, mpn: null },
    catalog: { title: "Batedeira Electrolux EKM30", category: "eletrodomesticos" },
    variant: { storage: null, memory: null, voltage: null, size: null },
    commerce: { price: 1000 },
  });
  const semConflitoCand = buildFakeListing({
    marketplaceId: "shopee",
    externalListingId: "SHP-OK",
    identity: { gtin: [], brand: null, manufacturerModel: null, model: null, mpn: null },
    catalog: { title: "Correia Batedeira Electrolux EKM30", category: "eletrodomesticos" },
    variant: { storage: null, memory: null, voltage: null, size: null },
    commerce: { price: 1000 },
  });
  const decisaoOk = evaluateIdentityConfidence(semConflito, semConflitoCand);

  // REJECT sem conflito duro e sem "candidato forte" -> nao consulta.
  const providerRecusa = new ContagemProvider([VEREDITO_BOM]);
  const rRecusa = await consultarAiShadow(
    {
      seed: { marketplaceId: "mercado_livre", externalListingId: "MLB-OK" },
      candidate: { marketplaceId: "shopee", externalListingId: "SHP-OK" },
      decisaoDeterministica: decisaoOk,
      montarPrompt: PROMPT,
    },
    { provider: providerRecusa, cache: new AiMemoryCache() },
  );
  assert.equal(rRecusa.gate, "SHADOW_ONLY_SKIPPED_NOT_ELIGIBLE");
  assert.equal(providerRecusa.chamadas, 0);
  console.log(`    ok  REJECT sem candidato forte -> nao consultada`);

  // Com rotulo AMBIGUOUS -> consulta.
  const providerAmb = new ContagemProvider([VEREDITO_BOM]);
  const rAmb = await consultarAiShadow(
    {
      seed: { marketplaceId: "mercado_livre", externalListingId: "MLB-OK" },
      candidate: { marketplaceId: "shopee", externalListingId: "SHP-OK" },
      decisaoDeterministica: decisaoOk,
      rotuloAmbiguo: true,
      montarPrompt: PROMPT,
    },
    { provider: providerAmb, cache: new AiMemoryCache() },
  );
  assert.equal(rAmb.gate, "SHADOW_CONSULTED_AMBIGUOUS");
  assert.equal(providerAmb.chamadas, 1, "rotulo AMBIGUOUS deve consultar a IA");
  assert.equal(rAmb.aiVerdict, "SAME");
  assert.equal(rAmb.wouldPromoteToSame, true);
  console.log(`    ok  AMBIGUOUS -> consultada, veredito=${rAmb.aiVerdict}`);

  // Com candidato forte -> consulta.
  const gateForte = avaliarElegibilidadeAi(decisaoOk, { candidatoForte: true });
  assert.equal(gateForte.elegivel, true);
  console.log(`    ok  NO_EXACT + candidato forte -> ${gateForte.gate}`);

  /* ================================================================ 4. CACHE */

  console.log("[4] cache por fingerprint e politica");

  const cache = new AiMemoryCache();
  const providerCache = new ContagemProvider([VEREDITO_BOM]);
  const deps = { provider: providerCache, cache };

  const primeiro = await consultarAiShadow(
    {
      seed: { marketplaceId: "mercado_livre", externalListingId: "MLB-OK" },
      candidate: { marketplaceId: "shopee", externalListingId: "SHP-OK" },
      decisaoDeterministica: decisaoOk,
      rotuloAmbiguo: true,
      montarPrompt: PROMPT,
    },
    deps,
  );
  const segundo = await consultarAiShadow(
    {
      seed: { marketplaceId: "mercado_livre", externalListingId: "MLB-OK" },
      candidate: { marketplaceId: "shopee", externalListingId: "SHP-OK" },
      decisaoDeterministica: decisaoOk,
      rotuloAmbiguo: true,
      montarPrompt: PROMPT,
    },
    deps,
  );
  assert.equal(providerCache.chamadas, 1, "segunda consulta tem de vir do cache");
  assert.equal(primeiro.fromCache, false);
  assert.equal(segundo.fromCache, true);
  assert.equal(primeiro.cacheKey, segundo.cacheKey);
  console.log(`    ok  chamadas=1, fromCache ${primeiro.fromCache} -> ${segundo.fromCache}`);

  // Trocar a política precisa invalidar.
  const chaveV1 = aiCacheKey(seedPrint, candPrint, "IDENTITY_POLICY_V1");
  const chaveV2 = aiCacheKey(seedPrint, candPrint, "IDENTITY_POLICY_V2");
  assert.notEqual(chaveV1, chaveV2, "policy version tem que entrar na chave");
  console.log(`    ok  policy version invalida a chave`);

  // Fingerprint muda quando o título muda.
  const printA = fingerprintListing({
    marketplaceId: "shopee",
    externalListingId: "X",
    catalog: { title: "Titulo A" },
    identity: { brand: null, model: null, gtin: [] },
  });
  const printB = fingerprintListing({
    marketplaceId: "shopee",
    externalListingId: "X",
    catalog: { title: "Titulo B" },
    identity: { brand: null, model: null, gtin: [] },
  });
  assert.notEqual(printA, printB, "mudanca de titulo tem que invalidar o cache");
  console.log(`    ok  mudanca de titulo invalida o cache`);

  /* ============================================================ 5. SHADOW */

  console.log("[5] resultado invalido nunca promove a SAME");

  const providerRuim = new ContagemProvider(["nao sei, provavelmente o mesmo produto"]);
  const rRuim = await consultarAiShadow(
    {
      seed: { marketplaceId: "mercado_livre", externalListingId: "MLB-OK" },
      candidate: { marketplaceId: "shopee", externalListingId: "SHP-OK" },
      decisaoDeterministica: decisaoOk,
      rotuloAmbiguo: true,
      montarPrompt: PROMPT,
    },
    { provider: providerRuim, cache: new AiMemoryCache() },
  );
  assert.equal(rRuim.aiVerdict, null, "resposta invalida nao produz veredito");
  assert.equal(rRuim.wouldPromoteToSame, false, "resposta invalida nunca promove");
  assert.deepEqual(rRuim.contractViolations, ["RESPOSTA_NAO_E_JSON"]);
  console.log(`    ok  lixo do modelo -> ${rRuim.contractViolations.join(",")}, sem promocao`);

  // Replay provider tambem obedece contrato.
  const replay = new ReplayAiProvider({ "*": VEREDITO_BOM });
  const rReplay = await consultarAiShadow(
    {
      seed: { marketplaceId: "mercado_livre", externalListingId: "MLB-OK" },
      candidate: { marketplaceId: "shopee", externalListingId: "SHP-OK" },
      decisaoDeterministica: decisaoOk,
      rotuloAmbiguo: true,
      montarPrompt: PROMPT,
    },
    { provider: replay, cache: new AiMemoryCache() },
  );
  assert.equal(rReplay.aiVerdict, "SAME");
  console.log(`    ok  ReplayAiProvider devolve veredito valido, chamadas de rede = 0`);

  console.log("");
  console.log("AI_IDENTITY_RESOLVER_TESTS=PASS");
  console.log("AI_CALLS_REAIS=0 (provedor de replay; sem credencial de LLM no ambiente)");
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});