/**
 * FASE 12 (fechamento) — CONTRASTE DAS CONTAGENS DE ROLLOUT.
 *
 * O teste que mais importa aqui é o negativo: provar que "integrado" NÃO vira
 * "público". Uma contagem única que somasse as duas é como o número
 * "CATALOG_V1_PUBLIC_MARKETPLACES=5" apareceu quando Amazon e AliExpress não
 * tinham uma única oferta publicada.
 */
import assert from "node:assert/strict";

import {
  countMarketplacesWithPublicOffers,
  countV1IntegratedMarketplaces,
  countWriterEnabledMarketplaces,
  rolloutRows,
} from "./rolloutStatus";
import { PUBLIC_SYNC_SUPPORTED_SOURCES } from "./publicSync/flags";

const V1 = "V1_PRIMARY_WITH_LEGACY_FALLBACK";

console.log("--- 1. contagens respondem a COISAS diferentes ---");
{
  const integrado = countV1IntegratedMarketplaces();
  const writerLigado = countWriterEnabledMarketplaces({});
  // Nenhuma env => Amazon/Magalu/AliExpress OFF, Shopee legado ligado.
  assert.equal(integrado, 4, "quatro conectores V1 no allowlist");
  assert.equal(writerLigado, 0, "sem CUTOVER global, nenhum writer escreve");

  // Integrados > writer-ligado: prova que os dois números não são o mesmo.
  assert.ok(integrado > writerLigado, "integrado e writer-enabled divergem");
}

console.log("--- 2. writer habilitado exige CUTOVER global + env explicita ---");
{
  const semCutover = countWriterEnabledMarketplaces({
    PUBLIC_SYNC_MODE_SHOPEE: V1,
  });
  assert.equal(semCutover, 0, "CUTOVER ausente trava ate o legado");

  const comCutover = countWriterEnabledMarketplaces(
    { CATALOG_V1_GLOBAL_CUTOVER: "YES", PUBLIC_SYNC_MODE_SHOPEE: V1 },
  );
  assert.equal(comCutover, 1, "com cutover, so a env explicita liga");
}

console.log("--- 3. ALIEXPRESS: integrado e desligado, naosome da lista ---");
{
  const rows = rolloutRows({}, PUBLIC_SYNC_SUPPORTED_SOURCES);
  const ae = rows.find((r) => r.marketplaceId === "aliexpress");

  assert.ok(ae, "AliExpress continua integrado (nao foi desinstalado)");
  assert.equal(ae!.v1Integrated, true);
  assert.equal(ae!.writerEnabled, false);
  assert.equal(ae!.runtimeMode, "OFF", "default OFF e o invariante");
  assert.equal(ae!.legacyEnumValue, "ALIEXPRESS");
}

console.log("--- 4. contagem PUBLICA vem so do banco ---");
{
  // Amazon e AliExpress: integrados, zero oferta.
  const ofertas = { MERCADO_LIVRE: 22, AMAZON: 0, ALIEXPRESS: 0 };
  assert.equal(countMarketplacesWithPublicOffers(ofertas), 1);

  // Shopee/Magalu presentes, AliExpress continua fora.
  const ofertas2 = { MERCADO_LIVRE: 22, SHOPEE: 3, ALIEXPRESS: 0 };
  assert.equal(countMarketplacesWithPublicOffers(ofertas2), 2);

  // Integrados que nao publicam NAO entram na contagem publica.
  assert.notEqual(
    countMarketplacesWithPublicOffers(ofertas2),
    countV1IntegratedMarketplaces(),
    "publico nunca deve herdar a contagem de integrado",
  );
}

console.log("--- 5. filtro de visibilidade retira do publico ---");
{
  const ofertas = { MERCADO_LIVRE: 22, SHOPEE: 3 };
  const soML = countMarketplacesWithPublicOffers(ofertas, (m) => m === "MERCADO_LIVRE");
  assert.equal(soML, 1, "filtro aplica antes de contar");
}

console.log("rolloutStatus.test.ts PASS");
