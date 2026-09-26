/**
 * CATALOG_ARCHITECTURE_V1 — SAFE URL CONTRACT TEST (FASE R).
 *
 * Uma URL vinda de fonte externa NUNCA escolhe o esquema persistido. Estes
 * testes travam o comportamento fail-closed do filtro.
 */
import assert from "node:assert/strict";
import {
  filterSafeExternalUrls,
  isSafeExternalUrl,
  toSafeExternalUrl,
  SAFE_URL_SCHEMES,
} from "./safeUrl";

function main() {
  /* --- Esquemas aceitos ------------------------------------------------- */
  assert.deepEqual([...SAFE_URL_SCHEMES], ["http:", "https:"]);

  for (const url of [
    "https://shopee.com.br/item/123",
    "http://exemplo.com/produto",
    "https://exemplo.com.br/oferta?utm=1#top",
  ]) {
    const result = toSafeExternalUrl(url);
    assert.equal(result.ok, true, `deveria aceitar ${url}`);
    assert.equal(result.reason, null);
    assert.ok(result.url !== null && result.url.startsWith(url.slice(0, 8)));
  }

  /* --- Esquemas perigosos (FASE R) -------------------------------------- */
  const dangerous = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "blob:https://exemplo.com/1234",
    "about:blank",
  ];
  for (const url of dangerous) {
    const result = toSafeExternalUrl(url);
    assert.equal(result.ok, false, `deveria REJEITAR ${url}`);
    assert.equal(result.url, null, `nada e persistido para ${url}`);
    assert.equal(result.reason, "UNSAFE_SCHEME", `motivo para ${url}`);
  }

  /* --- Esquema ofuscado com byte de controle/somente espaco -------------- */
  {
    const tab = String.fromCharCode(9);
    const newline = String.fromCharCode(10);
    const nullByte = String.fromCharCode(0);
    for (const url of [
      `jav${tab}ascript:alert(1)`,
      `jav${newline}ascript:alert(1)`,
      `${nullByte}javascript:alert(1)`,
      `java${String.fromCharCode(32)}script:alert(1)`,
    ]) {
      assert.equal(
        isSafeExternalUrl(url),
        false,
        `esquema ofuscado nao pode passar: ${JSON.stringify(url)}`,
      );
    }
  }

  /* --- Credenciais embebidas -------------------------------------------- */
  {
    const result = toSafeExternalUrl("https://user:senha@exemplo.com/x");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "EMBEDDED_CREDENTIALS");
  }

  /* --- Hosts locais ------------------------------------------------------ */
  for (const url of [
    "http://localhost:3000/x",
    "https://127.0.0.1/x",
    "http://0.0.0.0/x",
  ]) {
    const result = toSafeExternalUrl(url);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "LOCAL_HOST");
  }

  /* --- Entradas invalidas ------------------------------------------------ */
  assert.equal(toSafeExternalUrl("").reason, "EMPTY");
  assert.equal(toSafeExternalUrl("   ").reason, "EMPTY");
  assert.equal(toSafeExternalUrl(null).reason, "NOT_A_STRING");
  assert.equal(toSafeExternalUrl(123).reason, "NOT_A_STRING");
  assert.equal(toSafeExternalUrl({}).reason, "NOT_A_STRING");
  assert.equal(toSafeExternalUrl("/caminho/relativo").reason, "MALFORMED_URL");

  /* --- Filtro de array: descarta, deduplica e preserva ordem -------------- */
  {
    const input = [
      "https://a.com/1",
      "javascript:alert(1)",
      "https://a.com/1",
      "https://b.com/2",
      "data:text/html,x",
      "https://c.com/3",
    ];
    assert.deepEqual(filterSafeExternalUrls(input), [
      "https://a.com/1",
      "https://b.com/2",
      "https://c.com/3",
    ]);
    assert.deepEqual(filterSafeExternalUrls(null), []);
    assert.deepEqual(filterSafeExternalUrls("nao-e-array"), []);
  }

  console.log("safeUrl.test.ts PASS");
}

main();
