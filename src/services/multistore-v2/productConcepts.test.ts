import assert from "node:assert/strict";

import { buildQueryCore } from "./queryCore";
import { extractSanitizedIdentity } from "./sanitizedIdentity";
import {
  classifyProductConcept,
  matchesConceptLexeme,
} from "./productConcepts";

assert.equal(classifyProductConcept("Camisa Termica Protecao UV 50").id, "apparel");
assert.equal(classifyProductConcept("Camisas Termicas Protecao UV 50").id, "apparel");
assert.equal(classifyProductConcept("Controle remoto").id, "remote");
assert.equal(classifyProductConcept("Controles remotos").id, "remote");
assert.equal(classifyProductConcept("motor eletrico").id, "UNKNOWN");
assert.equal(matchesConceptLexeme("camisas", "camisa"), true);
assert.equal(matchesConceptLexeme("camisola", "camisa"), false);

const query = extractSanitizedIdentity("KIT 4 Camisa Termica Protecao UV 50+");
const core = buildQueryCore("KIT 4 Camisa Termica Protecao UV 50+");
assert.equal(query.strongIdentity.bundleQuantity, 4);
assert.equal(core.brand, null);
assert.equal(core.modelTokens[0], "uv50");

console.log("product concepts: singular/plural regressions passed");