/**
 * CATALOG_WAVE 1 - FASE N/G: sanidade das fixtures sintéticas.
 *
 * Sem segredos, cobertura dos 17 casos, parser/normalizer do adapter.
 */
import { normalizeAwinFeedItem } from "../feed/awinAdapter";
import { WAVE1_FIXTURES, fixtureSetFor, totalFixtureRows } from "./fixtures";
import { isValidGtin } from "./identity";

let passed = 0;
function ok(cond: boolean, label: string): void {
  if (!cond) {
    throw new Error(`FAIL: ${label}`);
  }
  passed += 1;
}

/* --- Cobertura dos 4 merchants ------------------------------------------ */
ok(WAVE1_FIXTURES.length === 4, "4 conjuntos de fixtures");
ok(
  WAVE1_FIXTURES.map((f) => f.merchant).join(",") ===
    "kabum,cama-in-box,olympikus,leveros",
  "merchants = Wave 1",
);
for (const set of WAVE1_FIXTURES) {
  ok(set.rows.length >= 3, `${set.merchant}: >= 3 linhas`);
  ok(set.advertiserId.startsWith("9000"), `${set.merchant}: advertiserId sintético`);
}
ok(totalFixtureRows() === 19, `19 linhas no total (got ${totalFixtureRows()})`);
ok(fixtureSetFor("kabum").rows.length === 8, "fixtureSetFor(kabum)");
ok(fixtureSetFor("leveros").rows.length === 5, "fixtureSetFor(leveros)");

/* --- FASE Q local: nenhum dado sensível nas fixtures -------------------- */
const blob = JSON.stringify(WAVE1_FIXTURES).toLowerCase();
for (const banned of [
  "apikey",
  "api_key",
  "password",
  "passwd",
  "secret",
  "authorization",
  "bearer ",
  "private_key",
  "client_secret",
  "access_token",
]) {
  ok(!blob.includes(banned), `fixture sem "${banned}"`);
}
ok(!/[?&]key=/.test(blob), "fixture sem ?key=");
ok(!blob.includes("https://api."), "fixture sem URL de API");

/* --- Casos da FASE G presentes ------------------------------------------ */
const allRows = WAVE1_FIXTURES.flatMap((f) => f.rows);
const kabum = fixtureSetFor("kabum").rows;
const cama = fixtureSetFor("cama-in-box").rows;
const olympikus = fixtureSetFor("olympikus").rows;
const leveros = fixtureSetFor("leveros").rows;

// 1) GTIN válido
const gtins = allRows.filter((r) => r.gtin).map((r) => r.gtin as string);
ok(gtins.length === 5, "5 linhas com GTIN");
for (const g of gtins) ok(isValidGtin(g), `GTIN fixture válido: ${g}`);

// 2) GTIN ausente
ok(kabum.some((r) => !r.gtin), "caso: GTIN ausente");

// 3/4) brand+model e brand+MPN
ok(kabum.some((r) => r.brand && r.model), "caso: brand+model");
ok(kabum.some((r) => r.brand && r.mpn && !r.model), "caso: brand+MPN");

// 5) preço BR e 6) preço internacional (USD)
ok(allRows.some((r) => r.currency === "BRL"), "caso: preço BR");
ok(allRows.some((r) => r.currency === "USD"), "caso: preço internacional");

// 7) imagem válida e caso de imagem ausente/inválida
ok(allRows.some((r) => (r.imageUrls ?? "").startsWith("https://")), "caso: imagem válida");
ok(allRows.some((r) => (r.imageUrls ?? "") === ""), "caso: imagem ausente");

// 8) URL válida e 9) URL inválida
ok(
  allRows.filter((r) => (r.productUrl ?? "").startsWith("https://")).length >= 18,
  "caso: URL válida (quase todas)",
);
ok(allRows.some((r) => (r.productUrl ?? "").startsWith("javascript:")), "caso: URL inválida");

// 10) externalId duplicado
const ids = allRows.map((r) => r.productId as string);
ok(new Set(ids).size === ids.length - 1, "caso: exatamente 1 externalId duplicado");

// 11) produto igual em duas lojas (mesmo GTIN em kabum e leveros)
const kabumJbl = kabum.find((r) => r.gtin === "7899875432107");
const leverosJbl = leveros.find((r) => r.gtin === "7899875432107");
ok(Boolean(kabumJbl && leverosJbl), "caso: produto igual em duas lojas (mesmo GTIN)");

// 12) produto semelhante mas diferente (Corre 3 vs Corre 4)
ok(
  olympikus.some((r) => r.model === "Corre 3") && olympikus.some((r) => r.model === "Corre 4"),
  "caso: produtos semelhantes mas diferentes",
);

// 15) cross-brand: fixtures com mesmo model, marcas diferentes
const tv = leveros.find((r) => r.model === "50UT8800");
ok(tv?.brand === "Samsung", "caso: fixture de TV Samsung (cross-brand alvo)");

// 16) GTIN conflitante: mesmo GTIN do kabum com outra marca
const conflict = leveros.find((r) => r.gtin === "4006381333931");
ok(conflict?.brand === "Genius", "caso: GTIN conflitante (Genius x Logitech)");

// 17) produto sem identidade forte
ok(
  cama.some((r) => !r.brand && !r.model && !r.mpn && !r.gtin),
  "caso: produto sem identidade forte",
);

/* --- Parser/normalizer (adapter) via fixtures ---------------------------- */
const raw1 = kabum[0];
const n1 = normalizeAwinFeedItem(raw1);
ok(n1.externalId === "KBM-1001", "parser: externalId extraído");
ok(n1.price === 249.9, `normalizer: preço BR 249,90 => ${n1.price}`);
ok(n1.currency === "BRL", "normalizer: moeda BRL");
ok(n1.brand === "Logitech", "normalizer: brand");
ok(n1.model === "G305", "normalizer: model");
ok(n1.gtin === "4006381333931", "normalizer: gtin");
ok((n1.productUrl ?? "").startsWith("https://www.kabum.com.br/"), "normalizer: URL segura");
ok(n1.imageUrls.length === 1, "normalizer: 1 imagem");

const usd = kabum.find((r) => r.currency === "USD");
const nUsd = normalizeAwinFeedItem(usd as NonNullable<typeof usd>);
ok(nUsd.currency === undefined, "normalizer: USD descartado (não vira BRL)");

const badUrl = kabum.find((r) => (r.productUrl ?? "").startsWith("javascript:"));
const nBad = normalizeAwinFeedItem(badUrl as NonNullable<typeof badUrl>);
ok(nBad.productUrl === undefined, "normalizer: javascript: descartado");

const noImg = cama.find((r) => (r.imageUrls ?? "") === "");
const nNoImg = normalizeAwinFeedItem(noImg as NonNullable<typeof noImg>);
ok(nNoImg.imageUrls.length === 0, "normalizer: imagem ausente => []");

console.log(`fixtures.test.ts PASS (${passed} asserções)`);
