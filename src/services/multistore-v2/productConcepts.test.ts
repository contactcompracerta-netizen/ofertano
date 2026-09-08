import assert from "node:assert/strict";

import { buildQueryCore } from "./queryCore";
import { extractSanitizedIdentity } from "./sanitizedIdentity";
import {
  classifyProductConcept,
  matchesConceptLexeme,
} from "./productConcepts";
import { inferRole } from "./normalizeCandidate";

assert.equal(classifyProductConcept("Camisa Termica Protecao UV 50").id, "apparel");
assert.equal(classifyProductConcept("Camisas Termicas Protecao UV 50").id, "apparel");
assert.equal(classifyProductConcept("Controle remoto").id, "remote");
assert.equal(classifyProductConcept("Controles remotos").id, "remote");
assert.equal(classifyProductConcept("motor eletrico").id, "UNKNOWN");
assert.equal(matchesConceptLexeme("camisas", "camisa"), true);
assert.equal(matchesConceptLexeme("camisola", "camisa"), false);

// Marca lider nao catalogada nao ancora o nucleo: o produto continua
// classificado, sem afrouxar acessorios/pecas (vocabulario de produto
// ainda ancora o nucleo na posicao inicial).
assert.equal(
  classifyProductConcept("WAP Aspirador de Po e Agua Barril GTW INOX 12 Compacto 12 Litros 1400W").id,
  "vacuum",
);
assert.equal(
  classifyProductConcept("Aspirador de Po e Agua Barril GTW INOX 12 Compacto 12 Litros 1400W").id,
  "vacuum",
);
assert.equal(
  classifyProductConcept("Saco Filtro de Pano Lavavel para Aspirador GTW 12").id,
  "consumable",
);
// Peca/acessorio com cabeca de produto no contexto ("para aspirador")
// continua com papel de reposicao, nunca MAIN.
assert.equal(inferRole("Filtro para Aspirador GTW 12"), "REPLACEMENT_PART");
assert.equal(
  inferRole("WAP Saco Filtro de Pano Lavavel para Aspirador GTW 12"),
  "REPLACEMENT_PART",
);

const query = extractSanitizedIdentity("KIT 4 Camisa Termica Protecao UV 50+");
const core = buildQueryCore("KIT 4 Camisa Termica Protecao UV 50+");
assert.equal(query.strongIdentity.bundleQuantity, 4);
assert.equal(core.brand, null);
assert.equal(core.modelTokens[0], "uv50");

console.log("product concepts: singular/plural regressions passed");