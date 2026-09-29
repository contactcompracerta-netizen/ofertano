/**
 * SEMÂNTICA DAS MÉTRICAS DE ROLLOUT.
 *
 * O teste que mais importa é o de não-conflação: `CATALOG_V1_GLOBAL_CUTOVER` e
 * `PUBLIC_SYNC_MODE_*` são mecanismos DIFERENTES. A regressão que este arquivo
 * trava é declarar "writer OFF" só porque o cutover global está desligado,
 * quando o public sync da fonte está autorizado.
 */
import assert from "node:assert/strict";

import {
  LEGACY_PUBLIC_MARKETPLACES,
  classifyPublicationStatus,
  countLegacyWriterEnabled,
  countMarketplacesWithPublicOffers,
  countPublicSyncWriterEnabled,
  countV1IntegratedMarketplaces,
  legacyWriterEnabled,
  rolloutRows,
} from "./rolloutStatus";
import { PUBLIC_SYNC_SUPPORTED_SOURCES } from "./publicSync/flags";

const V1 = "V1_PRIMARY_WITH_LEGACY_FALLBACK";

console.log("--- 1. public sync NÃO depende do cutover global ---");
{
  // Shopee tem default legado (não-OFF) sem nenhuma env. O public sync está
  // autorizado mesmo com o cutover global desligado — que é a configuração real
  // de produção, já que CATALOG_V1_GLOBAL_CUTOVER é NO por decisão de produto.
  const env = { CATALOG_V1_GLOBAL_CUTOVER: "NO" };
  const rows = rolloutRows(env, PUBLIC_SYNC_SUPPORTED_SOURCES);
  const shopee = rows.find((r) => r.marketplaceId === "shopee")!;

  assert.equal(shopee.publicSyncAuthorized, true, "Shopee autorizado por padrão");
  assert.equal(shopee.publicSyncMode, "V1_PRIMARY");
  assert.equal(legacyWriterEnabled(env), true, "cutover NO mantém legado ligado");
  // Public sync e legado são dimensões distintas: Shopee tem a primeira,
  // Mercado Livre tem a segunda. Nenhuma tem as duas.
  assert.equal(shopee.legacyWriter, false, "Shopee não publica pelo legado");
  assert.equal(countPublicSyncWriterEnabled(env), 1, "só Shopee no public sync");
  assert.equal(countLegacyWriterEnabled(env), 1, "só ML no legado");
}

console.log("--- 2. cutover global DESLIGA o legado, não o public sync ---");
{
  const env = { CATALOG_V1_GLOBAL_CUTOVER: "YES" };
  const rows = rolloutRows(env, PUBLIC_SYNC_SUPPORTED_SOURCES);
  const shopee = rows.find((r) => r.marketplaceId === "shopee")!;

  assert.equal(shopee.publicSyncAuthorized, true, "public sync sobrevive ao cutover");
  assert.equal(legacyWriterEnabled(env), false, "cutover YES apaga o legado");
  assert.equal(countLegacyWriterEnabled(env), 0);
  assert.equal(countPublicSyncWriterEnabled(env), 1, "intacto");
}

console.log("--- 3. env explícita por fonte continua prevalecendo ---");
{
  const env = {
    CATALOG_V1_GLOBAL_CUTOVER: "NO",
    PUBLIC_SYNC_MODE_AMAZON: V1,
  };
  assert.equal(countPublicSyncWriterEnabled(env), 2, "Shopee + Amazon");
  const rows = rolloutRows(env, PUBLIC_SYNC_SUPPORTED_SOURCES);
  const amazon = rows.find((r) => r.marketplaceId === "amazon")!;
  assert.equal(amazon.publicSyncAuthorized, true);
  assert.equal(amazon.publicSyncMode, V1);
}

console.log("--- 4. valor de env INVÁLIDO falha fechado ---");
{
  const env = { CATALOG_V1_GLOBAL_CUTOVER: "NO", PUBLIC_SYNC_MODE_SHOPEE: "INVALID" };
  const rows = rolloutRows(env, PUBLIC_SYNC_SUPPORTED_SOURCES);
  const shopee = rows.find((r) => r.marketplaceId === "shopee")!;
  assert.equal(shopee.publicSyncAuthorized, false);
  assert.equal(shopee.publicSyncMode, "OFF");
  assert.equal(shopee.publicSyncDeniedReason, "RUNTIME_MODE_OFF");
}

console.log("--- 5. ALIEXPRESS: integrado, desligado, fora do público ---");
{
  const rows = rolloutRows({}, PUBLIC_SYNC_SUPPORTED_SOURCES);
  const ae = rows.find((r) => r.marketplaceId === "aliexpress")!;
  assert.ok(ae, "conector preservado");
  assert.equal(ae.v1Integrated, true);
  assert.equal(ae.publicSyncAuthorized, false);
  assert.equal(ae.publicSyncMode, "OFF", "default OFF é o invariante");
  assert.equal(ae.publicationEligible, false, "sem writer = não pode publicar");
  assert.equal(ae.legacyEnumValue, "ALIEXPRESS");
}

console.log("--- 6. 'pode publicar' ≠ 'publicou' ---");
{
  assert.equal(classifyPublicationStatus({
    publicSyncAuthorized: false, legacyWriter: false, publicOfferCount: 0,
  }), "NO_WRITER");

  // Amazon: writer ligado, zero oferta. Válido e precisa ser distinguível.
  assert.equal(classifyPublicationStatus({
    publicSyncAuthorized: true, legacyWriter: false, publicOfferCount: 0,
  }), "WRITER_ON_ZERO_OFFERS");

  assert.equal(classifyPublicationStatus({
    publicSyncAuthorized: true, legacyWriter: false, publicOfferCount: 12,
  }), "PUBLISHED");

  // ML: só legado. Também é writer real.
  assert.equal(classifyPublicationStatus({
    publicSyncAuthorized: false, legacyWriter: true, publicOfferCount: 22,
  }), "PUBLISHED");

  // REGRESSÃO QUE ESTE ESTADO EVITOU: Magalu com writer OFF mas 3 ofertas no
  // ar. "NO_WRITER" esconderia que a fonte serve catálogo estagnado.
  assert.equal(classifyPublicationStatus({
    publicSyncAuthorized: false, legacyWriter: false, publicOfferCount: 3,
  }), "PUBLISHED_NO_WRITER");
}

console.log("--- 7. contagem PUBLICA vem só do banco ---");
{
  const ofertas = { MERCADO_LIVRE: 22, AMAZON: 0, ALIEXPRESS: 0 };
  assert.equal(countMarketplacesWithPublicOffers(ofertas), 1);
  // Integrados que não publicam NÃO entram.
  assert.notEqual(
    countMarketplacesWithPublicOffers(ofertas),
    countV1IntegratedMarketplaces(),
    "público nunca herda a contagem de integrado",
  );
  // Filtro de visibilidade aplica antes de contar.
  assert.equal(
    countMarketplacesWithPublicOffers(ofertas, (m) => m === "AMAZON"),
    0,
  );
  assert.ok(LEGACY_PUBLIC_MARKETPLACES.has("mercado_livre"));

  // CONTRASTE: com o public sync de Shopee ligado e ML no legado, o número de
  // marketplaces com writer é maior que o número que TEM oferta pública.
  const env = { CATALOG_V1_GLOBAL_CUTOVER: "NO" };
  const comWriter = rolloutRows(env, PUBLIC_SYNC_SUPPORTED_SOURCES).filter(
    (r) => r.publicationEligible,
  ).length;
  assert.equal(comWriter, 1, "só Shopee tem writer, no ambiente sem env");
  assert.equal(countPublicSyncWriterEnabled(env), 1);
}

console.log("rolloutStatus.test.ts PASS");
