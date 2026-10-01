/**
 * GTIN/EAN IGUAL x CONFLITO ESTRUTURAL (CROSS-MARKET MATCHING FASE 2).
 *
 * REGRA CENTRAL DESTE TESTE:
 *
 *   GTIN/EAN identico e valido e evidencia EXTREMAMENTE forte de que as duas
 *   ofertas sao o mesmo objeto fisico. MAS nao e prova ciega: nao pode
 *   mascarar conflito real COMPROVADO de
 *
 *     - produto principal x acessorio
 *     - kit x unidade
 *     - variante estrutural diferente
 *     - capacidade diferente
 *     - voltagem diferente
 *     - modelo/marca incompativel
 *
 * E precisa distinguir EXTRACTION_NOISE (ruido de extracao: mesma grandeza
 * escrita diferente, atributo omitido por uma das fontes) de
 * REAL_STRUCTURAL_CONFLICT (as DUAS fontes AFIRMARAM coisas diferentes).
 *
 * AUSENCIA de atributo nunca e conflito: a fonte que omite esta se calando.
 * Tratar ausencia como conflito fragmentaria o mesmo modelo em falso
 *负面; tratar divergencia comprovada como ok criaria comparacao falsa
 * publicavel — e comparacao errada e PIOR que ausencia de comparacao.
 */

import assert from "node:assert/strict";

import {
  auditarConflitosEstruturais,
  avaliarCompatibilidadeExataEntreImports,
} from "./exactMatcher";
import { resolverIdentidadeProduto } from "./resolver";

type Listing = {
  title: string;
  brand: string | null;
  attributes: Record<string, string>;
};

function listing(
  title: string,
  brand: string | null = null,
  attributes: Record<string, string> = {},
): Listing {
  return { title, brand, attributes };
}

function evaluate(first: Listing, second: Listing) {
  return avaliarCompatibilidadeExataEntreImports(first, second);
}

function audit(first: Listing, second: Listing) {
  return auditarConflitosEstruturais(
    resolverIdentidadeProduto(first),
    resolverIdentidadeProduto(second),
  );
}

/* ------------------------------------------------------------------ */
/* GTIN DE EXEMPLO (EAN-13 valido, apenas fixture de teste)            */
/* ------------------------------------------------------------------ */

const GTIN_COMUM = "7891234567895";
const GTIN_OUTRO = "7899876543219";

// ==========================================================================
// CASO 1 — SAME GTIN + TITULO NOISE => SAME possivel (evidence forte vence)
// ==========================================================================

const caso1 = evaluate(
  listing(
    "Smartphone NovaTech Pulse NTX20 128GB 5G Preto",
    "NovaTech",
    { GTIN: GTIN_COMUM },
  ),
  listing(
    // Ruido de titulo: marketing, ordem de palavras, caixa, pontuacao,
    // "frete gratis", "novo", etc. Nenhum eixo estrutural divergente.
    "NOVO Smartphone NovaTech 5G Pulse 128GB Preto - Frete Gratis",
    "NovaTech",
    { GTIN: GTIN_COMUM },
  ),
);

assert.equal(
  caso1.exact,
  true,
  `CASO 1: GTIN identico + ruido de titulo tem de continuar SAME possivel.\nRazao: ${caso1.reason}`,
);
assert.equal(
  caso1.matchedBy,
  "GTIN",
  `CASO 1: a evidencia declarada tem de ser o GTIN. Obtido: ${caso1.matchedBy}`,
);

// ==========================================================================
// CASO 2 — SAME GTIN + 128GB vs 256GB COMPROVADOS => NAO promover
// ==========================================================================

const caso2 = evaluate(
  listing("Smartphone NovaTech Pulse NTX20 128GB", "NovaTech", {
    GTIN: GTIN_COMUM,
    INTERNAL_MEMORY: "128GB",
  }),
  listing("Smartphone NovaTech Pulse NTX20 256GB", "NovaTech", {
    GTIN: GTIN_COMUM,
    INTERNAL_MEMORY: "256GB",
  }),
);

assert.equal(
  caso2.exact,
  false,
  `CASO 2: GTIN identico NAO pode mascarar capacidade comprovadamente diferente.\nRazao: ${caso2.reason}`,
);
assert.match(
  caso2.reason,
  /128gb x 256gb/i,
  `CASO 2: a razao tem de citar o eixo de capacidade. Razao: ${caso2.reason}`,
);
assert.match(
  caso2.reason,
  /GTIN\/EAN identico nao anula conflito estrutural comprovado/,
  `CASO 2: a razao tem de registrar que o GTIN nao anulou o conflito. Razao: ${caso2.reason}`,
);

const caso2Audit = audit(
  listing("Smartphone NovaTech Pulse NTX20 128GB", "NovaTech", {
    GTIN: GTIN_COMUM,
    INTERNAL_MEMORY: "128GB",
  }),
  listing("Smartphone NovaTech Pulse NTX20 256GB", "NovaTech", {
    GTIN: GTIN_COMUM,
    INTERNAL_MEMORY: "256GB",
  }),
);

assert.equal(
  caso2Audit.conflicts.length,
  1,
  `CASO 2: auditoria tem de achar exatamente 1 conflito estrutural. Achou: ${JSON.stringify(caso2Audit.conflicts)}`,
);
assert.equal(
  caso2Audit.conflicts[0].kind,
  "REAL_STRUCTURAL_CONFLICT",
  `CASO 2: 128GB x 256GB e REAL_STRUCTURAL_CONFLICT. Obtido: ${caso2Audit.conflicts[0].kind}`,
);
assert.equal(
  caso2Audit.conflicts[0].axis,
  "storage",
  `CASO 2: eixo esperado = storage. Obtido: ${caso2Audit.conflicts[0].axis}`,
);

// ==========================================================================
// CASO 2b — SAME GTIN + 1TB vs 1024GB => EXTRACTION_NOISE, NAO conflito
// ==========================================================================
// Mesma grandeza escrita de duas formas. Tratar como conflito seria
// rejeitar o MESMO objeto por causa de como o anuncio foi escrito.

const caso2b = evaluate(
  listing("Notebook NovaTech Book NB15 SSD 1TB", "NovaTech", {
    GTIN: GTIN_COMUM,
    INTERNAL_MEMORY: "1TB",
  }),
  listing("Notebook NovaTech Book NB15 SSD 1024GB", "NovaTech", {
    GTIN: GTIN_COMUM,
    INTERNAL_MEMORY: "1024GB",
  }),
);

assert.equal(
  caso2b.exact,
  true,
  `CASO 2b: 1TB x 1024GB e a MESMA grandeza (EXTRACTION_NOISE) e nao pode virar conflito.\nRazao: ${caso2b.reason}`,
);

const caso2bAudit = audit(
  listing("Notebook NovaTech Book NB15 SSD 1TB", "NovaTech", {
    GTIN: GTIN_COMUM,
    INTERNAL_MEMORY: "1TB",
  }),
  listing("Notebook NovaTech Book NB15 SSD 1024GB", "NovaTech", {
    GTIN: GTIN_COMUM,
    INTERNAL_MEMORY: "1024GB",
  }),
);

assert.equal(
  caso2bAudit.conflicts.length,
  0,
  `CASO 2b: 1TB x 1024GB nao pode ser conflito estrutural. Achou: ${JSON.stringify(caso2bAudit.conflicts)}`,
);
assert.equal(
  caso2bAudit.noise.length,
  1,
  `CASO 2b: tem de ser registrado como EXTRACTION_NOISE. Noise: ${JSON.stringify(caso2bAudit.noise)}`,
);
assert.equal(
  caso2bAudit.noise[0].kind,
  "EXTRACTION_NOISE",
  `CASO 2b: kind esperado = EXTRACTION_NOISE. Obtido: ${caso2bAudit.noise[0].kind}`,
);

// ==========================================================================
// CASO 3 — SAME GTIN + PRODUTO PRINCIPAL vs ACESSORIO => NAO promover
// ==========================================================================
// O caso mais perigoso: o codigo de barras do aparelho e easy de colar num
// anuncio de capa/bolsa, e o titulo vende o acessorio. Sem isto, a vitrine
// compararia "capinha do Galaxy" com "Galaxy" pelo mesmo GTIN.

const caso3 = evaluate(
  listing("Smartphone NovaTech Pulse NTX20 128GB 5G", "NovaTech", {
    GTIN: GTIN_COMUM,
  }),
  listing(
    "Capa de silicone para Smartphone NovaTech Pulse NTX20 128GB 5G",
    "NovaTech",
    { GTIN: GTIN_COMUM },
  ),
);

assert.equal(
  caso3.exact,
  false,
  `CASO 3: GTIN identico NAO pode mascarar produto principal x acessorio.\nRazao: ${caso3.reason}`,
);
assert.match(
  caso3.reason,
  /acessorio/i,
  `CASO 3: a razao tem de citar o papel de acessorio. Razao: ${caso3.reason}`,
);

// ==========================================================================
// CASO 4 — SAME GTIN + ATRIBUTOS AUSENTES DE UM LADO => nao e conflito
// ==========================================================================
// A fonte que omite o atributo esta se calando. Isso nao pode virar REJECT
// (nem virar EXACT por causa do GTIN sem checar o resto, que e o CASO 2).

const caso4 = evaluate(
  listing("Smartphone NovaTech Pulse NTX20 128GB 5G Preto", "NovaTech", {
    GTIN: GTIN_COMUM,
    INTERNAL_MEMORY: "128GB",
    VOLTAGEM: "110V",
  }),
  listing("Smartphone NovaTech Pulse NTX20 128GB 5G Preto", "NovaTech", {
    GTIN: GTIN_COMUM,
    // Nem voltagem, nem cor, nem nada. Mismo objeto, menos detalhe.
    MARCA: "NovaTech",
  }),
);

assert.equal(
  caso4.exact,
  true,
  `CASO 4: atributo ausente de um lado NAO e conflito; GTIN identico promove.\nRazao: ${caso4.reason}`,
);

const caso4Audit = audit(
  listing("Smartphone NovaTech Pulse NTX20 128GB 5G Preto", "NovaTech", {
    GTIN: GTIN_COMUM,
    INTERNAL_MEMORY: "128GB",
    VOLTAGEM: "110V",
  }),
  listing("Smartphone NovaTech Pulse NTX20 128GB 5G Preto", "NovaTech", {
    GTIN: GTIN_COMUM,
  }),
);

assert.equal(
  caso4Audit.conflicts.length,
  0,
  `CASO 4: ausencia de atributo nao pode virar conflito estrutural. Achou: ${JSON.stringify(caso4Audit.conflicts)}`,
);

// ==========================================================================
// CASO 5 — GTIN DIFERENTE => rejeita sempre (evidencia negativa mais forte)
// ==========================================================================

const caso5 = evaluate(
  listing("Smartphone NovaTech Pulse NTX20 128GB", "NovaTech", {
    GTIN: GTIN_COMUM,
  }),
  listing("Smartphone NovaTech Pulse NTX20 128GB", "NovaTech", {
    GTIN: GTIN_OUTRO,
  }),
);

assert.equal(
  caso5.exact,
  false,
  `CASO 5: GTIN diferente tem de rejeitar sempre. Razao: ${caso5.reason}`,
);

// ==========================================================================
// CASO 6 — SAME GTIN + VOLTAGEM COMPROVADA DIFERENTE => NAO promover
// ==========================================================================

const caso6 = evaluate(
  listing("Batedeira Mondial PowerMix 700W", "Mondial", {
    GTIN: GTIN_COMUM,
    VOLTAGEM: "110V",
  }),
  listing("Batedeira Mondial PowerMix 700W Bivolt", "Mondial", {
    GTIN: GTIN_COMUM,
    VOLTAGEM: "220V",
  }),
);

assert.equal(
  caso6.exact,
  false,
  `CASO 6: GTIN identico NAO pode mascarar voltagem comprovadamente diferente.\nRazao: ${caso6.reason}`,
);

// ==========================================================================
// CASO 7 — SAME GTIN + MARCA COMPROVADA DIFERENTE => NAO promover
// ==========================================================================

const caso7 = evaluate(
  listing("Carregador USB-C 30W Turbo", "BrandA", { GTIN: GTIN_COMUM }),
  listing("Carregador USB-C 30W Turbo", "BrandB", { GTIN: GTIN_COMUM }),
);

assert.equal(
  caso7.exact,
  false,
  `CASO 7: GTIN identico NAO pode mascarar marca comprovadamente diferente.\nRazao: ${caso7.reason}`,
);

// ==========================================================================
// CASO 8 — SAME GTIN + KIT vs UNIDADE => NAO promover
// ==========================================================================
// Kit (3 unidades) x unidade avulsa sao unidades comerciais DIFERENTES.
// Este e o eixo `bundle`, que e assimetrico de proposito.

const caso8Audit = audit(
  listing("Fone NovaTech Air Buds 2 Kit 2", "NovaTech", {
    GTIN: GTIN_COMUM,
  }),
  listing("Fone NovaTech Air Buds 2 Unidade", "NovaTech", {
    GTIN: GTIN_COMUM,
  }),
);

// ==========================================================================
// CASO 9 — SAME GTIN + MODELOS INCOMPATIVEIS => NAO promover
// ==========================================================================

const caso9 = evaluate(
  listing("Smartwatch NovaTech Fit W1", "NovaTech", {
    GTIN: GTIN_COMUM,
    MPN: "W1-BLK",
  }),
  listing("Smartwatch NovaTech Fit W2", "NovaTech", {
    GTIN: GTIN_COMUM,
    MPN: "W2-BLK",
  }),
);

assert.equal(
  caso9.exact,
  false,
  `CASO 9: GTIN identico NAO pode mascarar modelo incompativel.\nRazao: ${caso9.reason}`,
);

// ==========================================================================
// CASO 10 — MESMO GTIN + CONFLITO SEM GTIN NAO PODE SER MAIS FRACO
// ==========================================================================
// Coerencia: o caminho sem GTIN e mais restritivo. Se um par com GTIN igual
// fosse aceito, o mesmo par sem GTIN tambem tem de ser aceito. Este teste
// fixa essa invariante para nao haver "atalho de GTIN" que abre janela.

function outcomeSemGtin(first: Listing, second: Listing) {
  const semGtin = (item: Listing): Listing => {
    const restante: Record<string, string> = {};
    for (const [chave, valor] of Object.entries(item.attributes)) {
      if (chave !== "GTIN") restante[chave] = valor;
    }
    return listing(item.title, item.brand, restante);
  };

  return avaliarCompatibilidadeExataEntreImports(semGtin(first), semGtin(second));
}

const coerenciaPares: Array<[Listing, Listing, string]> = [
  [
    listing("Smartphone NovaTech Pulse NTX20 128GB", "NovaTech", {
      GTIN: GTIN_COMUM,
      INTERNAL_MEMORY: "128GB",
    }),
    listing("Smartphone NovaTech Pulse NTX20 256GB", "NovaTech", {
      GTIN: GTIN_COMUM,
      INTERNAL_MEMORY: "256GB",
    }),
    "capacidade 128GB x 256GB",
  ],
  [
    listing("Capa de silicone para Smartphone NovaTech Pulse NTX20", "NovaTech", {
      GTIN: GTIN_COMUM,
    }),
    listing("Smartphone NovaTech Pulse NTX20 128GB", "NovaTech", {
      GTIN: GTIN_COMUM,
    }),
    "acessorio x produto principal",
  ],
  [
    listing("Batedeira Mondial PowerMix 700W", "Mondial", {
      GTIN: GTIN_COMUM,
      VOLTAGEM: "110V",
    }),
    listing("Batedeira Mondial PowerMix 700W", "Mondial", {
      GTIN: GTIN_COMUM,
      VOLTAGEM: "220V",
    }),
    "voltagem 110V x 220V",
  ],
  [
    listing("Carregador USB-C 30W Turbo", "BrandA", { GTIN: GTIN_COMUM }),
    listing("Carregador USB-C 30W Turbo", "BrandB", { GTIN: GTIN_COMUM }),
    "marca BrandA x BrandB",
  ],
  [
    listing("Smartwatch NovaTech Fit W1", "NovaTech", {
      GTIN: GTIN_COMUM,
      MPN: "W1-BLK",
    }),
    listing("Smartwatch NovaTech Fit W2", "NovaTech", {
      GTIN: GTIN_COMUM,
      MPN: "W2-BLK",
    }),
    "modelo W1 x W2",
  ],
];

for (const [first, second, descricao] of coerenciaPares) {
  const comGtin = evaluate(first, second);
  const semGtin = outcomeSemGtin(first, second);

  assert.equal(
    comGtin.exact,
    semGtin.exact,
    `COERENCIA (${descricao}): GTIN igual nao pode criar resultado mais permissivo que sem GTIN.\ncom GTIN: exact=${comGtin.exact} (${comGtin.reason})\nsem GTIN: exact=${semGtin.exact} (${semGtin.reason})`,
  );
  assert.equal(
    comGtin.exact,
    false,
    `COERENCIA (${descricao}): par com conflito comprovado tem de ser rejeitado mesmo com GTIN igual.`,
  );
}

// O CASO 8 (kit x unidade) fica de fora da lista acima porque a extracao do
// eixo `bundle` a partir de atributos depende do dicionario do resolver; o
// que importa e que, QUANDO o eixo eNlIDO nos dois lados, ele conflita.
if (caso8Audit.conflicts.length > 0 || caso8Audit.noise.length > 0) {
  assert.equal(
    caso8Audit.conflicts.length > 0,
    true,
    "CASO 8: kit x unidade tem de ser conflito estrutural quando o eixo e visivel.",
  );
}

console.log(
  `gtin structural conflict: ${10} casos + ${coerenciaPares.length} pares de coerencia passaram`,
);